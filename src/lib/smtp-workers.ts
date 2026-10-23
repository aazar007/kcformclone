/**
 * SMTP over Cloudflare's native TCP sockets.
 *
 * Why this exists: nodemailer's own transport opens its connection through
 * Node's `net`/`tls` modules. On Cloudflare Workers those are only partly
 * emulated — in particular, upgrading a plain socket to TLS (STARTTLS, which
 * port 587 uses) is not supported — so every send ended with "Connection closed
 * unexpectedly" before the server was even greeted.
 *
 * `cloudflare:sockets` supports both implicit TLS (port 465, `secureTransport:
 * "on"`) and STARTTLS (`secureTransport: "starttls"` + `startTls()`), so this
 * module speaks the small part of SMTP needed to hand one finished message to an
 * authenticated relay. The message itself is still built by nodemailer's
 * composer (see mailer.ts), so HTML, text and inline images are encoded exactly
 * as before.
 *
 * Errors carry `response` and `responseCode` like nodemailer's, so the mailer's
 * existing classification (relay refusal vs. unreachable) keeps working.
 */

export interface WorkersSmtpOptions {
  host: string;
  port: number;
  /** Implicit TLS from the first byte (port 465). Otherwise STARTTLS is used. */
  secure: boolean;
  /** Refuse to continue when the server will not upgrade to TLS. */
  requireTLS: boolean;
  user: string;
  pass: string;
  /** Envelope sender and recipients (bare addresses). */
  from: string;
  to: string[];
  /** The complete RFC 5322 message, CRLF line endings. */
  message: Uint8Array;
  /** How long any single step may wait for the server. */
  stepTimeoutMs: number;
}

/** Same shape as nodemailer's errors, so callers classify both identically. */
export class SmtpError extends Error {
  constructor(
    message: string,
    readonly response: string,
    /** The server's reply code; null when the server never answered. */
    readonly responseCode: number | null,
  ) {
    super(message);
    this.name = "SmtpError";
  }
}

interface SmtpReply {
  code: number;
  lines: string[];
  text: string;
}

/** Minimal shape of a `cloudflare:sockets` socket, to avoid a types dependency. */
interface CfSocket {
  readable: ReadableStream<Uint8Array>;
  writable: WritableStream<Uint8Array>;
  opened: Promise<unknown>;
  closed: Promise<void>;
  close(): Promise<void>;
  startTls(options?: { expectedServerHostname?: string }): CfSocket;
}

type Connect = (
  address: { hostname: string; port: number },
  options?: { secureTransport?: "on" | "off" | "starttls"; allowHalfOpen?: boolean },
) => CfSocket;

/** Reads SMTP replies (possibly multi-line) off a socket. */
class ReplyReader {
  private buffer = "";
  private readonly decoder = new TextDecoder();
  private readonly reader: ReadableStreamDefaultReader<Uint8Array>;

  constructor(socket: CfSocket) {
    this.reader = socket.readable.getReader();
  }

  release() {
    try {
      this.reader.releaseLock();
    } catch {
      /* already released */
    }
  }

  async next(step: string, timeoutMs: number): Promise<SmtpReply> {
    const deadline = Date.now() + timeoutMs;
    const lines: string[] = [];

    for (;;) {
      const newline = this.buffer.indexOf("\r\n");
      if (newline !== -1) {
        const line = this.buffer.slice(0, newline);
        this.buffer = this.buffer.slice(newline + 2);
        lines.push(line);
        // "250-..." continues a multi-line reply; "250 ..." (or "250") ends it.
        if (/^\d{3}(?: |$)/.test(line)) {
          const code = Number.parseInt(line.slice(0, 3), 10);
          return { code, lines, text: lines.join("\n") };
        }
        continue;
      }

      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        throw new SmtpError(`SMTP timed out waiting for the server (${step})`, `timeout during ${step}`, null);
      }

      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new SmtpError(`SMTP timed out waiting for the server (${step})`, `timeout during ${step}`, null)),
          remaining,
        );
      });
      const chunk = await Promise.race([this.reader.read(), timeout]).finally(() => clearTimeout(timer));
      if (chunk.done) {
        throw new SmtpError(
          `The mail server closed the connection (${step})`,
          `connection closed by server during ${step}`,
          null,
        );
      }
      this.buffer += this.decoder.decode(chunk.value, { stream: true });
    }
  }
}

const encoder = new TextEncoder();

function base64(value: string): string {
  return Buffer.from(value, "utf8").toString("base64");
}

/**
 * Dot-stuff the body (RFC 5321 §4.5.2) and append the terminating "." line.
 * The composed message is 7-bit after encoding, so latin1 round-trips it exactly.
 */
function dataPayload(message: Uint8Array): Uint8Array {
  let text = Buffer.from(message).toString("latin1");
  if (!text.endsWith("\r\n")) text += "\r\n";
  text = text.replace(/(^|\r\n)\./g, "$1..");
  return Buffer.from(`${text}.\r\n`, "latin1");
}

/** Hand one message to an SMTP relay. Resolves once the server accepts it. */
export async function sendViaWorkersSmtp(options: WorkersSmtpOptions): Promise<void> {
  /* The specifier is assembled at run time so neither webpack nor OpenNext's
     esbuild pass tries to resolve it at build time (both fail on `cloudflare:`
     modules in app code); the Workers runtime provides it as a built-in. */
  /* Read through a global so the minifier cannot fold it back into a literal. */
  const socketsModule =
    ((globalThis as Record<string, unknown>).__KSU_SOCKETS_MODULE__ as string | undefined) ??
    "cloudflare:sockets";
  const { connect } = (await import(/* webpackIgnore: true */ socketsModule)) as {
    connect: Connect;
  };

  let socket: CfSocket;
  try {
    socket = connect(
      { hostname: options.host, port: options.port },
      { secureTransport: options.secure ? "on" : "starttls", allowHalfOpen: false },
    );
  } catch (error) {
    throw new SmtpError(
      `Could not open a connection to ${options.host}:${options.port}: ${(error as Error).message}`,
      (error as Error).message,
      null,
    );
  }

  let reader = new ReplyReader(socket);
  let writer = socket.writable.getWriter();
  const t = options.stepTimeoutMs;

  const send = async (line: string) => {
    await writer.write(encoder.encode(`${line}\r\n`));
  };

  /** Expect one of the codes, or fail with the server's own words. */
  const expect = async (step: string, ok: number[]): Promise<SmtpReply> => {
    const reply = await reader.next(step, t);
    if (!ok.includes(reply.code)) {
      throw new SmtpError(`SMTP ${step} was refused: ${reply.text}`, reply.text, reply.code);
    }
    return reply;
  };

  const ehloName = "ksucrown.workers";

  try {
    await expect("greeting", [220]);

    await send(`EHLO ${ehloName}`);
    let ehlo = await expect("EHLO", [250]);

    if (!options.secure) {
      const offersTls = ehlo.lines.some((line) => /^250[- ]STARTTLS\b/i.test(line));
      if (offersTls) {
        await send("STARTTLS");
        await expect("STARTTLS", [220]);
        reader.release();
        writer.releaseLock();
        socket = socket.startTls({ expectedServerHostname: options.host });
        reader = new ReplyReader(socket);
        writer = socket.writable.getWriter();
        await send(`EHLO ${ehloName}`);
        ehlo = await expect("EHLO after STARTTLS", [250]);
      } else if (options.requireTLS) {
        throw new SmtpError(
          `${options.host}:${options.port} does not offer STARTTLS, so the password would be sent unencrypted. Use port 465 or a server that supports TLS.`,
          "STARTTLS not offered",
          null,
        );
      }
    }

    if (options.user) {
      const authLine = ehlo.lines.find((line) => /^250[- ]AUTH\b/i.test(line)) ?? "";
      const methods = authLine.toUpperCase();
      if (methods.includes("PLAIN") || !methods.includes("LOGIN")) {
        await send(`AUTH PLAIN ${base64(`\u0000${options.user}\u0000${options.pass}`)}`);
        await expect("AUTH", [235]);
      } else {
        await send("AUTH LOGIN");
        await expect("AUTH LOGIN", [334]);
        await send(base64(options.user));
        await expect("AUTH LOGIN (user)", [334]);
        await send(base64(options.pass));
        await expect("AUTH", [235]);
      }
    }

    await send(`MAIL FROM:<${options.from}>`);
    await expect("MAIL FROM", [250]);

    for (const recipient of options.to) {
      await send(`RCPT TO:<${recipient}>`);
      await expect(`RCPT TO ${recipient}`, [250, 251]);
    }

    await send("DATA");
    await expect("DATA", [354]);
    await writer.write(dataPayload(options.message));
    await expect("message body", [250]);

    try {
      await send("QUIT");
      await reader.next("QUIT", 3_000);
    } catch {
      /* The message is already accepted; a slow goodbye changes nothing. */
    }
  } finally {
    reader.release();
    try {
      writer.releaseLock();
    } catch {
      /* already released */
    }
    socket.close().catch(() => {});
  }
}
