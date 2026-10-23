/**
 * Outgoing mail.
 *
 * Two kinds of message: a one-time passcode, and the confirmation a team gets
 * once it is registered. SMTP settings come from the environment so the same
 * build works against Gmail, a university relay or a transactional provider.
 *
 * When SMTP is not configured messages are written to the server log instead.
 * That keeps local development working without credentials, and is deliberately
 * refused in production — a live site that "confirms" registrations by printing
 * them to a log has confirmed nothing.
 */

import nodemailer, { type Transporter } from "nodemailer";
import { getEnv } from "./env";
import { emailCopy, emailDirection, fill, type EmailCopy } from "./email-copy";
import { DEFAULT_LANGUAGE, arabicDigits, type Language } from "./i18n";
import { OTP_TTL_MINUTES, type OtpPurpose } from "./otp";

/**
 * Which outbound mail stream a message belongs to.
 *
 * The two are worth separating because they have genuinely different needs. A
 * verification code is worthless if it is slow or filtered, so it usually wants a
 * transactional provider built for automated sending. A confirmation is a record
 * the captain may want to reply to, so it often wants the organisers' own mailbox.
 * They also fail independently — a throttle on one account must not stop the
 * other — and when one breaks, the organisers need to know *which*.
 */
export type MailChannel = "otp" | "confirmation";

/**
 * Environment prefix per channel, checked before the shared `SMTP_*` values.
 *
 * `SMTP_OTP_USER` therefore overrides `SMTP_USER` for codes only. Setting just the
 * shared `SMTP_*` values keeps both channels on one account, which is what every
 * deployment did before channels existed — so nothing has to change to keep
 * working, and going back to one account means deleting the overrides.
 */
export const CHANNEL_PREFIX: Record<MailChannel, string> = {
  otp: "SMTP_OTP_",
  confirmation: "SMTP_CONFIRMATION_",
};

/** Thrown when a channel has no SMTP host, so nothing can be sent on it. */
export class MailerNotConfiguredError extends Error {
  constructor(readonly channel: MailChannel = "otp") {
    super(
      channel === "otp"
        ? "SMTP is not configured, so no verification code can be sent."
        : "SMTP is not configured, so no confirmation email can be sent.",
    );
    this.name = "MailerNotConfiguredError";
  }
}

/**
 * The relay accepted the connection and then refused the message.
 *
 * Worth its own type because the remedy is completely different from "the
 * address is wrong": a provider throttling the sending account, or rejecting the
 * domain for authentication reasons, is a problem with *us* — and there is
 * nothing the person waiting for the email can do about it.
 */
export class MailDeliveryError extends Error {
  constructor(
    message: string,
    /** The relay's own words, kept so an operator can search for them. */
    readonly response: string,
    readonly responseCode: number | null,
  ) {
    super(message);
    this.name = "MailDeliveryError";
  }
}

/**
 * Classify a send failure.
 *
 * A 550-class reply during `DATA` means the relay took the message and then
 * refused to deliver it — which is what a provider's anti-abuse throttle looks
 * like, and is not something a retry fixes immediately.
 */
function asDeliveryError(error: unknown): MailDeliveryError {
  const candidate = error as { message?: unknown; response?: unknown; responseCode?: unknown };
  const response = typeof candidate?.response === "string" ? candidate.response : "";
  const responseCode = typeof candidate?.responseCode === "number" ? candidate.responseCode : null;
  const message = typeof candidate?.message === "string" ? candidate.message : String(error);

  return new MailDeliveryError(message, response || message, responseCode);
}

/**
 * Whether the relay answered and rejected the message, as opposed to never
 * answering at all.
 *
 * `MailDeliveryError` covers both, because both mean "not delivered". They need
 * very different words though: a relay that answered with `550 5.4.6` is a
 * problem with the sending account and retrying will not help, whereas a
 * connection that timed out may simply have been a blip. Telling a student the
 * sending account is broken when the network hiccuped would send them to the
 * organisers for nothing.
 *
 * A reply code is the discriminator: it only exists when something replied.
 */
export function isRelayRefusal(error: unknown): boolean {
  return error instanceof MailDeliveryError && error.responseCode !== null;
}

export async function mailerConfigured(channel: MailChannel = "otp"): Promise<boolean> {
  return Boolean((await channelSettings(channel)).host);
}

/** True when a missing mailer is survivable — i.e. local development. */
export async function mailerAllowsLogFallback(channel: MailChannel = "otp"): Promise<boolean> {
  return !(await mailerConfigured(channel)) && process.env.NODE_ENV !== "production";
}

/** A channel's own setting if it has one, otherwise the shared one. */
async function read(channel: MailChannel, field: string): Promise<string> {
  const specific = (await getEnv(`${CHANNEL_PREFIX[channel]}${field}`))?.trim();
  if (specific) return specific;
  return (await getEnv(`SMTP_${field}`))?.trim() ?? "";
}

/**
 * Passwords are taken exactly as written, never trimmed.
 *
 * A credential is a literal string and some providers issue ones with meaningful
 * surrounding whitespace. Every other setting is a name or a host, where stray
 * space is a typo worth correcting silently.
 */
async function readSecret(channel: MailChannel, field: string): Promise<string> {
  const specific = await getEnv(`${CHANNEL_PREFIX[channel]}${field}`);
  if (specific) return specific;
  return (await getEnv(`SMTP_${field}`)) ?? "";
}

export interface ChannelSettings {
  channel: MailChannel;
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
  /** Already resolved: the channel's own reply-to, else `MAIL_REPLY_TO`, else "". */
  replyTo: string;
  /**
   * True when this channel names its own account rather than borrowing the
   * shared one. Only used for reporting — it tells an operator why two channels
   * behave differently.
   */
  dedicated: boolean;
}

/**
 * Resolve one channel's settings.
 *
 * Read fresh on every call rather than cached, so an operator editing `.env` sees
 * the effect without wondering whether a stale value is being used.
 */
export async function channelSettings(channel: MailChannel): Promise<ChannelSettings> {
  const parsedPort = Number.parseInt((await read(channel, "PORT")) || "587", 10);
  const port = Number.isFinite(parsedPort) ? parsedPort : 587;

  return {
    channel,
    host: await read(channel, "HOST"),
    port,
    // Implicit TLS on 465; STARTTLS everywhere else.
    secure: (await read(channel, "SECURE")) === "true" || port === 465,
    user: await read(channel, "USER"),
    pass: await readSecret(channel, "PASS"),
    from: await read(channel, "FROM"),
    replyTo: (await read(channel, "REPLY_TO")) || (await getEnv("MAIL_REPLY_TO"))?.trim() || "",
    /* Distinguished by looking for the channel's own *user*, not its host: a
       deployment may legitimately use one host with two accounts on it. */
    dedicated: Boolean((await getEnv(`${CHANNEL_PREFIX[channel]}USER`))?.trim()),
  };
}

/**
 * How long to wait on a mail server before giving up.
 *
 * Without these, nodemailer waits its own defaults — a **two-minute** connection
 * timeout and a ten-minute socket timeout — and the person on the other end is
 * simply left waiting. That happened: with an unreachable mail host,
 * `POST /api/otp/request` took **78 seconds** to return an error, and a student
 * pressing "Send verification code" had no idea anything was happening.
 *
 * A send is on the critical path of a form someone is standing in front of, so it
 * gets a short leash. Ten seconds is far longer than any healthy relay needs to
 * greet, authenticate and accept, and short enough that a broken one is reported
 * while the captain is still looking at the screen.
 */
const CONNECTION_TIMEOUT_MS = 10_000;
const GREETING_TIMEOUT_MS = 10_000;
const SOCKET_TIMEOUT_MS = 20_000;

/**
 * Live transports, keyed by the connection they represent.
 *
 * Keyed rather than one cached instance because there can now be two accounts, and
 * because keying on the connection means a changed `.env` produces a new transport
 * instead of silently reusing the old settings.
 */
const transports = new Map<string, Transporter>();

function transport(settings: ChannelSettings): Transporter {
  if (!settings.host) throw new MailerNotConfiguredError(settings.channel);

  const key = `${settings.host}:${settings.port}:${settings.user}`;
  const existing = transports.get(key);
  if (existing) return existing;

  const created = nodemailer.createTransport({
    host: settings.host,
    port: settings.port,
    secure: settings.secure,
    auth: settings.user ? { user: settings.user, pass: settings.pass } : undefined,
    /* Never fall back to plaintext: on a STARTTLS port (587) refuse to send if the
       server will not upgrade the connection, so the login and every message stay
       encrypted. Local development relays (Mailpit and the like) are exempt. */
    requireTLS: !settings.secure && process.env.NODE_ENV === "production",
    tls: { minVersion: "TLSv1.2", rejectUnauthorized: true },
    /* See the timeouts above — these exist so a broken relay fails while the
       captain is still looking at the screen rather than a minute later. */
    connectionTimeout: CONNECTION_TIMEOUT_MS,
    greetingTimeout: GREETING_TIMEOUT_MS,
    socketTimeout: SOCKET_TIMEOUT_MS,
  });

  transports.set(key, created);
  return created;
}

/**
 * The From header.
 *
 * A display name on its own — `SMTP_FROM="KSU Crown"` — is not a valid address,
 * and providers reject or silently rewrite it. When the configured value carries
 * no address, borrow the authenticated SMTP user, which is the one identity a
 * provider will always accept for an authenticated account.
 *
 * Note this borrows the *channel's* user, so each account signs its own mail. A
 * provider will generally refuse to send as an address the authenticated account
 * does not own, so the two channels must not swap From addresses.
 *
 * Exported because it is the value providers accept or reject, and it is worth
 * being able to assert on it without sending anything.
 */
export function fromAddress(settings: ChannelSettings): string {
  const configured = settings.from;
  const user = settings.user;
  const fallback = "no-reply@ksucrown.sa";

  if (configured.includes("@")) return configured;
  if (user.includes("@")) return configured ? `${configured} <${user}>` : user;
  return configured ? `${configured} <${fallback}>` : `KSU Crown <${fallback}>`;
}

export function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/* -------------------------------------------------------------------------- */
/* Sending                                                                    */
/* -------------------------------------------------------------------------- */

/** An image embedded in the message and referenced as `cid:` in the HTML. */
export interface InlineImage {
  cid: string;
  filename: string;
  content: Buffer;
  contentType: string;
}

export interface OutgoingMail {
  to: string;
  /**
   * Which account sends this, and therefore which identity the recipient sees.
   *
   * Required rather than defaulted on purpose: a default would silently send a
   * verification code from the confirmations mailbox the first time someone
   * forgot to pass one, and that would look like a phishing attempt to a student.
   * Making it required means the compiler names every call site instead.
   */
  channel: MailChannel;
  subject: string;
  html: string;
  text: string;
  /**
   * Where a reply should go.
   *
   * Transactional mail is often sent from an unmonitored or `no-reply` address.
   * Naming a real mailbox gives the recipient somewhere to answer — and a
   * message with no reply path reads as machine-generated to some filters.
   */
  replyTo?: string;
  /**
   * Attached inline rather than linked from a URL, so the message renders
   * without the recipient having to allow remote images.
   */
  inline?: InlineImage[];
}

export interface SendOutcome {
  delivered: boolean;
  /** True when there was no SMTP relay and the message was logged instead. */
  logged: boolean;
}

/**
 * Send a message on behalf of one channel.
 *
 * Throws when that channel's SMTP is unconfigured outside development, so a caller
 * in production learns that nothing was sent rather than assuming it was.
 *
 * The channel decides the account, the From header and the reply-to — so which
 * one a message uses is a property of the message, not of a global setting.
 */
export async function sendMail(mail: OutgoingMail): Promise<SendOutcome> {
  const settings = await channelSettings(mail.channel);

  if (!settings.host) {
    if (!(await mailerAllowsLogFallback(mail.channel))) throw new MailerNotConfiguredError(mail.channel);

    const which = settings.dedicated ? `the ${mail.channel} channel` : "SMTP";
    console.warn(
      `[mailer] ${which} is not configured — would have sent "${mail.subject}" to ${mail.to}. ` +
        `Set ${CHANNEL_PREFIX[mail.channel]}HOST (or SMTP_HOST) to send real email.`,
    );
    return { delivered: false, logged: true };
  }

  try {
    await transport(settings).sendMail({
      from: fromAddress(settings),
      to: mail.to,
      replyTo: defaultReplyTo(settings, mail.replyTo),
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
      attachments: mail.inline?.map((image) => ({
        filename: image.filename,
        content: image.content,
        contentType: image.contentType,
        cid: image.cid,
      })),
    });
  } catch (error) {
    /* Logged with the relay's exact reply, so an operator can search for it.
       "550 Unusual sending activity" is a provider throttle and reads nothing
       like a bad address, but both arrive here as a generic failure. The channel
       is named because the two accounts fail independently, and knowing which one
       refused is most of the diagnosis. */
    const failure = asDeliveryError(error);
    console.error(
      isRelayRefusal(failure)
        ? `[mailer] ${mail.channel} relay refused "${mail.subject}" for ${mail.to}: ${failure.response}`
        : `[mailer] ${mail.channel} could not be reached for "${mail.subject}" to ${mail.to}: ${failure.response}`,
    );

    if (error instanceof MailerNotConfiguredError) throw error;
    throw failure;
  }

  return { delivered: true, logged: false };
}

/**
 * Where replies land when a message does not say.
 *
 * The channel's own reply-to when set, else `MAIL_REPLY_TO` — the organisers'
 * mailbox — else the authenticated user, which is guaranteed to exist and to be
 * monitored, unlike the `no-reply@` address a From header often falls back to.
 */
function defaultReplyTo(settings: ChannelSettings, override?: string): string | undefined {
  if (override?.includes("@")) return override;
  if (settings.replyTo.includes("@")) return settings.replyTo;
  return settings.user.includes("@") ? settings.user : undefined;
}

/**
 * The subject line for a code email, chosen by what the code is for.
 *
 * Three purposes share one template, and picking the wording here rather than at
 * each call site is what keeps a staff sign-in code from arriving under the
 * subject "your edit code" — which is exactly what happened when the branch was a
 * two-way ternary written out four times.
 */
function otpSubject(copy: EmailCopy, purpose: OtpPurpose) {
  if (purpose === "player-email") return copy.subjectPlayer;
  if (purpose === "edit-access") return copy.subjectEdit;
  if (purpose === "admin-access") return copy.subjectAdmin;
  return copy.subjectStaff;
}

/** The opening sentence of a code email, chosen the same way. */
function otpIntro(copy: EmailCopy, purpose: OtpPurpose) {
  if (purpose === "player-email") return copy.codeIntroPlayer;
  if (purpose === "edit-access") return copy.codeIntroEdit;
  if (purpose === "admin-access") return copy.codeIntroAdmin;
  return copy.codeIntroStaff;
}

function bodyHtml(
  code: string,
  purpose: OtpPurpose,
  teamName: string | undefined,
  language: Language,
) {
  const safeTeam = teamName ? escapeHtml(teamName) : null;
  const copy = emailCopy(language);
  const rtl = language === "ar";

  /* `dir` and `align` are set on the elements a client honours without a stylesheet:
     mail clients do not inherit the page's direction, and many strip a <style> block
     entirely. The inline styles stay physical (padding, colours) because they are
     layout the client will apply either way. */
  const intro = otpIntro(copy, purpose);
  /* The minutes are prose, so they follow the script. The *code* does not.
   *
   * A one-time code is a machine token that has to be transcribed exactly, and the
   * servers compare it against Western digits. Rendering it in Arabic-Indic digits
   * looked helpful and was actively harmful: the person typed what they saw, the
   * verification stripped it, and the code was rejected — with no way to tell why,
   * because both the email and the form looked right. Found by a student who could
   * not register in Arabic at all. */
  const minutes = rtl ? arabicDigits(OTP_TTL_MINUTES) : String(OTP_TTL_MINUTES);
  const shownCode = code;

  return `<!doctype html>
<html lang="${language}" dir="${emailDirection(language)}">
  <body dir="${emailDirection(language)}" style="margin:0;background:#04121a;padding:32px 16px;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;direction:${emailDirection(language)};">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" dir="${emailDirection(language)}" style="max-width:480px;margin:0 auto;background:#082330;border:1px solid #14414f;border-radius:16px;">
      <tr>
        <td align="${rtl ? "right" : "left"}" style="padding:28px 28px 8px;">
          <p style="margin:0;font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:#5cf0f7;font-weight:700;">KSU Crown</p>
          <h1 style="margin:8px 0 0;font-size:20px;color:#eaf7fb;">${copy.codeHeading}</h1>
        </td>
      </tr>
      <tr>
        <td align="${rtl ? "right" : "left"}" style="padding:8px 28px 0;">
          <p style="margin:0;font-size:14px;line-height:1.6;color:#9fc0cc;">
            ${intro}${safeTeam ? ` <strong style="color:#eaf7fb;">${safeTeam}</strong>` : ""}
          </p>
        </td>
      </tr>
      <tr>
        <td align="${rtl ? "right" : "left"}" style="padding:20px 28px;">
          <p dir="ltr" style="margin:0;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:34px;letter-spacing:0.28em;color:#5cf0f7;font-weight:700;">${shownCode}</p>
        </td>
      </tr>
      <tr>
        <td align="${rtl ? "right" : "left"}" style="padding:0 28px 20px;">
          <p style="margin:0;font-size:12px;line-height:1.6;color:#7ba0ad;">
            ${fill(copy.codeExpiry, { minutes })}
          </p>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function bodyText(
  code: string,
  purpose: OtpPurpose,
  teamName: string | undefined,
  language: Language,
) {
  const copy = emailCopy(language);
  const rtl = language === "ar";
  const intro = otpIntro(copy, purpose);
  const minutes = rtl ? arabicDigits(OTP_TTL_MINUTES) : String(OTP_TTL_MINUTES);

  return [
    "KSU Crown",
    intro,
    teamName ? fill(copy.codeTextTeam, { team: teamName }) : null,
    "",
    /* Western digits here too — see the note in `bodyHtml`. */
    fill(copy.codeTextCode, { code }),
    "",
    fill(copy.codeExpiry, { minutes }),
  ]
    .filter((line) => line !== null)
    .join("\n");
}

/**
 * Send a verification code.
 *
 * `language` decides the words. It comes from the browser, because only the browser
 * knows which language the student is filling the form in — the server sees a
 * request and nothing else. `DEFAULT_LANGUAGE` is the fallback for a caller that
 * does not say, so a code is never sent with empty text.
 *
 * Resolves with `{ delivered: false, logged: true }` in development when SMTP is
 * unconfigured, so the flow stays testable; throws in production.
 */
/**
 * Build the verification email without sending it.
 *
 * Exported so the wording can be asserted in tests — the alternative is a test that
 * has to reach a mail server to find out whether the Arabic copy is Arabic, which is
 * both slower and less reliable.
 */
export function renderOtpEmail(
  code: string,
  purpose: OtpPurpose,
  teamName: string | undefined,
  language: Language,
): { subject: string; html: string; text: string } {
  const copy = emailCopy(language);
  return {
    subject: otpSubject(copy, purpose),
    html: bodyHtml(code, purpose, teamName, language),
    text: bodyText(code, purpose, teamName, language),
  };
}

export async function sendOtpEmail(
  to: string,
  code: string,
  purpose: OtpPurpose,
  teamName?: string,
  language: Language = DEFAULT_LANGUAGE,
): Promise<SendOutcome> {
  const rendered = renderOtpEmail(code, purpose, teamName, language);

  return sendMail({
    to,
    /* Always the OTP channel, whatever else is configured: a code that arrived from
       the confirmations mailbox would look like a forgery to a student. */
    channel: "otp",
    subject: rendered.subject,
    text: rendered.text,
    html: rendered.html,
  });
}
