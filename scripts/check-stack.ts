/**
 * Check the whole registration stack.
 *
 *   npm run check
 *
 * The app has three moving parts, and a failure in any of them looks the same
 * from the browser: the database it registers into, the mailer that sends the
 * verification codes, and the optional spreadsheet it exports to. This reports
 * on each separately, and says what to do about it rather than just what failed.
 */

import { EXPECTED_SCRIPT_VERSION, deploymentId, fail, loadEnv, ping } from "./lib/sheet-client";
import { adminHref, staffHref } from "../src/lib/admin-path";
import { adminSecretIsHashed, adminTwoStep } from "../src/lib/admin-auth";
import { CHANNEL_PREFIX, channelSettings, sendMail, type MailChannel } from "../src/lib/mailer";
import { looksLikeSheetUrl, sheetUrl } from "../src/lib/sheets";
import { registrationCounts } from "../src/lib/store";

loadEnv();

/* -------------------------------------------------------------------------- */
/* Database                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Collapse an error to something worth reading in a terminal.
 *
 * Prisma's connection failures arrive as a multi-line message with a source
 * excerpt and a caret pointing at the offending call, which buries the one line
 * that matters.
 */
function summarise(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const first = message.split("\n").map((line) => line.trim()).filter(Boolean)[0] ?? message;
  return first.length > 200 ? `${first.slice(0, 200)}…` : first;
}

/**
 * Whether the connection string asks for a TLS mode that will change meaning.
 *
 * `pg` treats `sslmode=require` as `verify-full` today — encrypted *and* the server
 * certificate verified against the system roots. Its next major version adopts
 * standard libpq semantics, where `require` means encrypted but **unverified**, so a
 * man-in-the-middle is no longer ruled out. The change arrives with a dependency
 * bump nobody would connect to a security property, which is exactly why it is worth
 * reporting here rather than waiting to notice it.
 *
 * `verify-full` is the mode that means the same thing now and later.
 */
function tlsModeWarning(url: string): string | null {
  const match = /[?&]sslmode=([^&]+)/.exec(url);
  if (!match) {
    /* No mode at all: `pg` defaults to no TLS, which is fine on a local socket and
       wrong for anything reached over a network. */
    return url.includes("localhost") || url.includes("127.0.0.1")
      ? null
      : "no sslmode in the URL — the connection may not be encrypted at all";
  }
  if (match[1] === "verify-full") return null;
  if (match[1] === "require") {
    return "sslmode=require becomes *unverified* encryption in pg v9 — use sslmode=verify-full";
  }
  if (match[1] === "verify-ca") {
    return "sslmode=verify-ca does not check the hostname — use sslmode=verify-full";
  }
  if (match[1] === "prefer" || match[1] === "no-verify") {
    return `sslmode=${match[1]} does not verify the server certificate`;
  }
  return null;
}

async function checkDatabase() {
  console.log("Database (source of truth)");
  console.log("─".repeat(64));

  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    console.log("✖ DATABASE_URL is not set in .env — registration cannot work.");
    console.log("  Create a PostgreSQL database, set DATABASE_URL, then run:");
    console.log("    npx prisma migrate dev\n");
    return false;
  }

  // Never print the password, but show enough to tell which database this is.
  const safe = url.replace(/:\/\/([^:]+):[^@]+@/, "://$1:•••@");
  console.log(`  url : ${safe}`);

  const tls = tlsModeWarning(url);
  if (tls) {
    console.log(`  ⚠ ${tls}`);
    console.log("    This is a TLS setting, not a connection fault — it still works today.\n");
  }

  try {
    const counts = await registrationCounts();
    console.log(`  ✓ reachable — ${counts.teams} team(s), ${counts.players} member(s)\n`);
    return true;
  } catch (error) {
    const message = summarise(error);
    console.log(`  ✖ could not query: ${message}`);

    if (/DATABASE_URL is not set/i.test(message)) {
      console.log("  Set DATABASE_URL in .env.\n");
    } else if (/does not exist|P2021|relation|P1010|authentication|password/i.test(message)) {
      console.log("  The database may not be migrated yet, or the credentials are wrong. Try:");
      console.log("    npx prisma migrate dev\n");
    } else {
      console.log("  Check that PostgreSQL is running and that DATABASE_URL is correct.");
      console.log("  If this is a fresh database, run: npx prisma migrate dev\n");
    }
    return false;
  }
}

/* -------------------------------------------------------------------------- */
/* Email                                                                      */
/* -------------------------------------------------------------------------- */

const CHANNEL_LABEL: Record<MailChannel, string> = {
  otp: "verification codes",
  confirmation: "confirmations",
};

/** One line describing which account a channel will send from, and where. */
function describeChannel(channel: MailChannel): string | null {
  const settings = channelSettings(channel);
  if (!settings.host) return null;

  const identity = settings.user || "(no user — unauthenticated relay)";
  const from = settings.from.includes("@") ? settings.from : settings.user || settings.from;
  const origin = settings.dedicated ? `${CHANNEL_PREFIX[channel]}*` : "shared SMTP_*";

  return `${identity} via ${settings.host}:${settings.port}${from ? `, From ${from}` : ""}  [${origin}]`;
}

async function checkEmail() {
  console.log("Email (verification codes and confirmations)");
  console.log("─".repeat(64));

  const otpValue = process.env.OTP_SECRET?.trim() ?? "";
  const production = process.env.NODE_ENV === "production";

  /*
   * The pieces are reported independently.
   *
   * This used to `return false` the moment OTP_SECRET was wrong, which hid the
   * mail configuration completely. They are unrelated — OTP_SECRET decides whether
   * a code can be *verified*, SMTP decides whether it can be *sent* — and someone
   * debugging "students cannot register" needs both answers from one run, not the
   * first problem only.
   */
  let ok = true;

  if (!otpValue) {
    console.log("✖ OTP_SECRET is not set — no player can verify their address.");
    console.log("  Generate one with: openssl rand -base64 32");
    ok = false;
  } else if (/^openssl\s|rand\s+-base64|changeme|^secret$|^password$|^test$/i.test(otpValue)) {
    /* A very common mistake: pasting the *command* into .env instead of running it
       and pasting the output. It still "works" — any non-empty string is a valid
       HMAC key — so nothing breaks loudly, but the key is then public knowledge. */
    console.log("✖ OTP_SECRET looks like a placeholder, not a secret.");
    console.log(`  It currently reads: ${JSON.stringify(otpValue)}`);
    console.log("  Run `openssl rand -base64 32` and paste the *output* into .env,");
    console.log("  not the command itself.");
    ok = false;
  } else if (otpValue.length < 24) {
    console.log(`⚠ OTP_SECRET is only ${otpValue.length} characters — use at least 32.`);
    console.log("  It is the key for every verification code, so it should be random.");
  } else {
    console.log("  ✓ OTP_SECRET is set");
  }

  console.log("");

  /* Which account each channel will use. Named separately because they can, and
     often should, be different — and because "codes work but confirmations do not"
     is otherwise a very confusing symptom. */
  const channels: MailChannel[] = ["otp", "confirmation"];
  const described = new Map<MailChannel, string | null>();
  for (const channel of channels) described.set(channel, describeChannel(channel));

  for (const channel of channels) {
    const line = described.get(channel);
    const label = CHANNEL_LABEL[channel].padEnd(18);
    console.log(line ? `  ${label}: ${line}` : `  ${label}: ○ not configured`);
  }

  const configured = channels.filter((channel) => described.get(channel));
  console.log("");

  if (configured.length === 0) {
    console.log(`${production ? "✖" : "⚠"} No SMTP account is set — messages go to the server log.`);
    console.log(
      production
        ? "  That is refused in production. Set SMTP_HOST, SMTP_PORT, SMTP_USER,\n" +
            "  SMTP_PASS and SMTP_FROM (or the per-channel variants).\n"
        : "  Fine for local development; set SMTP_HOST before going live.\n",
    );
    return ok && !production;
  }

  /* Registration cannot proceed without a code, so an unconfigured OTP channel is
     fatal in a way that a missing confirmation is not. */
  if (!described.get("otp")) {
    console.log("✖ No account for verification codes — nobody can register.");
    console.log("  Set SMTP_HOST, or SMTP_OTP_HOST to use a separate account for codes.\n");
    ok = false;
  } else if (!described.get("confirmation")) {
    console.log("⚠ No account for confirmations — teams will register but get no email.");
    console.log("  Set SMTP_HOST, or SMTP_CONFIRMATION_HOST to use a separate account.\n");
  }

  /* A display name with no address is not a valid From, and providers reject it. */
  for (const channel of configured) {
    const settings = channelSettings(channel);
    if (settings.from && !settings.from.includes("@") && !settings.user.includes("@")) {
      console.log(
        `✖ ${CHANNEL_LABEL[channel]}: the From is "${settings.from}", which has no address,`,
      );
      console.log("  and no SMTP user to borrow one from. Set it to \"Name <address@example.com>\".\n");
      ok = false;
    }
  }

  /* Static checks done. Only a real send proves an account can actually deliver,
     so each configured channel gets one. */
  for (const channel of configured) {
    console.log(`${CHANNEL_LABEL[channel]}:`);
    if (!(await probeChannel(channel))) ok = false;
  }

  return ok;
}

/**
 * Actually send something, because only a real message proves the account works.
 *
 * A connection test (`transporter.verify()`) checks that the host answers and the
 * credentials are accepted — and it passes while the account is throttled, because
 * providers refuse *during* `DATA`, after the greeting and after AUTH. That is
 * exactly the failure this project hit: every code was refused with
 * `550 5.4.6 Unusual sending activity detected`, `verify()` said everything was
 * fine, and the first person to find out was a student who could not register.
 *
 * **The recipient matters more than the send.** Mailing the account its own
 * address proves almost nothing: a host that refuses every external recipient will
 * happily deliver to itself, so a self-send reports success while every student is
 * still locked out. It did exactly that the first time this probe was written.
 * Name an external address with `MAIL_TEST_TO`; without one the probe still sends,
 * but says plainly what it did and did not prove.
 */
async function probeChannel(channel: MailChannel): Promise<boolean> {
  const settings = channelSettings(channel);
  const requested = (process.env.MAIL_TEST_TO ?? "").trim();
  const to = requested || settings.user;

  if (!to || !to.includes("@")) {
    console.log("  ○ skipped the test send — no address to send to.");
    console.log("    Set MAIL_TEST_TO to an address you can check, then run this again.\n");
    return true;
  }

  /* External means "not this channel's own account", so a split setup tests each
     account against the same real recipient. */
  const external = to.toLowerCase() !== settings.user.toLowerCase();

  console.log(`  sending a test message to ${to}${external ? "" : " (the sending account itself)"} …`);
  try {
    await sendMail({
      to,
      channel,
      subject: `KSU Crown — ${CHANNEL_LABEL[channel]} mail check`,
      text:
        "This is a test message from `npm run check`.\n\n" +
        `If you are reading it, the registration site can send ${CHANNEL_LABEL[channel]}.\n` +
        "No action is needed.",
      html:
        "<p>This is a test message from <code>npm run check</code>.</p>" +
        `<p>If you are reading it, the registration site can send ${CHANNEL_LABEL[channel]}.</p>` +
        "<p>No action is needed.</p>",
    });

    console.log("  ✓ relay accepted the message");
    if (external) {
      console.log(`    Check ${to}. If nothing arrives within a few minutes, the relay took the`);
      console.log("    message and something after it dropped it — a filter, or the receiving");
      console.log("    server. That is a different problem from the relay refusing it.\n");
      return true;
    }

    /* The important caveat. Success here is not evidence that students will get
       their codes, and saying otherwise would send the operator away happy while
       registration is still broken. */
    console.log("");
    console.log("  ⚠ This proves the account can mail ITSELF, and little more.");
    console.log("    Hosts such as Zoho routinely accept self-sends while refusing every");
    console.log("    external recipient — which is the failure mode this site actually hit.");
    console.log("    To test what students experience, send to an address on another domain:");
    console.log("      MAIL_TEST_TO=you@gmail.com npm run check");
    console.log("");
    return true;
  } catch (error) {
    const failure = error as { response?: unknown; message?: unknown };
    const reply = typeof failure?.response === "string" ? failure.response : summarise(error);

    console.log("  ✖ the relay refused the message.");
    console.log(`    It said: ${reply}`);
    console.log("");
    /* The distinction matters, because one is fixable by waiting and the other is
       not. Anything 5xx during DATA is the provider rejecting the *account*. */
    if (/unusual sending activity|5\.4\.6|usage-policy|too many|rate limit|limit exceeded/i.test(reply)) {
      console.log("    This is a throttle on the sending account, not a problem with the");
      console.log("    recipient. It reads like a spam filter but it is the provider's");
      console.log("    anti-abuse limit, and while it is in force nothing on this channel");
      console.log("    reaches anybody.");
      console.log("");
      if (channel === "otp") {
        console.log("    Students cannot register while the code account is blocked.");
      } else {
        console.log("    Teams can still register; they just get no confirmation email.");
      }
      console.log("");
      console.log("    Options, best first:");
      console.log("      1. Move this channel to a transactional provider (Resend, Postmark,");
      console.log("         SES, SendGrid). This is the only reliable fix: a shared mailbox");
      console.log("         account like Zoho Mail is throttled by design, and its free tier");
      console.log(`         restricts sending to external recipients. Set ${CHANNEL_PREFIX[channel]}HOST`)
      console.log("         / _USER / _PASS to use one account for this channel only.");
      console.log("      2. Contact the provider and ask them to lift the restriction.");
      console.log("      3. Wait — it sometimes clears in a few hours, then returns.");
      console.log("");
      console.log("    Nothing in the application can work around this.");
    } else if (/535|534|authentication|invalid login|username and password/i.test(reply)) {
      console.log(`    The provider rejected the credentials. The ${CHANNEL_LABEL[channel]} user`);
      console.log("    or password is wrong, or the account needs an app-specific password.");
    } else if (/550|553|554|sender|from/i.test(reply)) {
      console.log("    The provider rejected the message. Check the From address — a provider");
      console.log("    will not send as a domain the authenticated account does not own, so the");
      console.log(`    ${CHANNEL_LABEL[channel]} account must send as its own address.`);
    } else {
      console.log("    Search that reply verbatim; providers document their own codes.");
    }
    console.log("");
    return false;
  }
}

/* -------------------------------------------------------------------------- */
/* Spreadsheet export                                                         */
/* -------------------------------------------------------------------------- */

async function checkSheet() {
  console.log("Google Sheet (optional export)");
  console.log("─".repeat(64));

  /* Reported before the early return, because it is a separate setting: the webhook is what
     writes to the sheet, the URL is what the console links to, and either can be set
     without the other. */
  const rawSheetUrl = process.env.SHEET_URL?.trim();
  if (!rawSheetUrl) {
    console.log("○ SHEET_URL is not set — the console shows no link to the spreadsheet.");
    console.log("  This is only the address the organiser clicks; the export works without");
    console.log("  it. It cannot be derived from SHEET_WEBHOOK_URL.");
  } else if (!looksLikeSheetUrl(rawSheetUrl)) {
    console.log("⚠ SHEET_URL does not look like a Google Sheets address. Expected:");
    console.log("  https://docs.google.com/spreadsheets/d/<id>/edit");
    console.log(`  got: ${rawSheetUrl}`);
  } else if (sheetUrl()) {
    console.log(`✓ SHEET_URL is a valid link (…${rawSheetUrl.slice(-24)})`);
  } else {
    console.log("⚠ SHEET_URL is set but is not a linkable http(s) URL — no link is shown.");
  }

  if (!process.env.SHEET_WEBHOOK_URL?.trim()) {
    console.log("○ SHEET_WEBHOOK_URL is not set — the export is simply unavailable.");
    console.log("  Registration is unaffected. See the README to set the mirror up.\n");
    return true;
  }

  if (!process.env.SHEET_WEBHOOK_SECRET?.trim()) {
    console.log("⚠ SHEET_WEBHOOK_SECRET is empty — requests will be rejected unless the");
    console.log("  script also has no secret. Run diagnose() in the Apps Script editor.\n");
  }

  console.log(`  deployment : ${deploymentId()}`);
  console.log("  contacting the web app…");

  const health = await ping();
  const version = typeof health.version === "number" ? health.version : null;

  console.log(`  ✓ reachable — sheet "${health.sheet}" holds ${health.players} row(s)`);
  console.log(`  script version : ${version ?? "not reported"} (expected ${EXPECTED_SCRIPT_VERSION})`);

  if (version !== EXPECTED_SCRIPT_VERSION) {
    console.log(
      "\n  ⚠ The deployment does not match this app's Code.gs.\n" +
        "    An older script still accepts an append, so exporting keeps working, but\n" +
        "    its column layout and Role values may differ. To upgrade:\n" +
        "      Apps Script editor → paste google-apps-script/Code.gs → Save →\n" +
        "      Deploy → Manage deployments → Edit → Version: New version\n" +
        "    Then run setupSheet() once from the editor.",
    );
  }

  console.log("");
  return true;
}

/* -------------------------------------------------------------------------- */

async function main() {
  console.log("\nKSU Crown — registration stack check\n");

  const database = await checkDatabase();
  const email = await checkEmail();
  const sheet = await checkSheet();
  await checkConsole();

  console.log("─".repeat(64));
  if (database && email) {
    console.log("✓ Registration can work. Push to the sheet from the admin console.\n");
  } else {
    console.log("✖ Registration is not fully configured — see the ✖ lines above.\n");
    process.exitCode = 1;
  }
  void sheet;
}

/**
 * Where the console is, and how the grand admin's secret is stored.
 *
 * Worth printing because both answers are *derived*: the addresses come from
 * `ADMIN_SECRET` through a hash, so an organiser who changes that value — to rot them, or
 * to move from a plaintext secret to a hashed one — has no way to work out the new
 * address. Without this they would be looking at a 404 with nothing to go on.
 */
async function checkConsole() {
  console.log("\nOrganiser console");
  console.log("─".repeat(64));

  const [owner, staff, hashed, twoStep] = [
    await adminHref(),
    await staffHref(),
    adminSecretIsHashed(),
    adminTwoStep(),
  ];

  if (!owner) {
    console.log("✖ ADMIN_SECRET is not set, so the console cannot be reached at any address.");
    console.log("  Production needs it; in development the built-in 'crown-admin' secret is used.");
    return;
  }

  console.log(`  grand admin : ${owner}`);
  console.log(`  staff       : ${staff ?? "(unavailable)"}`);
  console.log(`
  secret      : ${hashed ? "hashed (good — the environment holds nothing replayable)" : "PLAINTEXT"}`);
  if (!hashed) {
    console.log("                Run `npm run admin:hash` to store a hash instead.");
  }
  /* The step is on when there is somewhere to send the code — so "off" is not a refusal any
     more, it is a banner. Said plainly here because a missing address is easy to overlook. */
  console.log(
    `  confirmation: ${twoStep ? "emailed code required after the secret" : "OFF — ADMIN_EMAIL is not set"}`,
  );
  if (!twoStep) {
    console.log("                Sign-in still works; the console shows a warning banner.");
  }

  /* The password is independent of ADMIN_SECRET, so it works wherever the database does. */
  console.log("");
  console.log("  The stored grand admin password depends only on itself and the database, so");
  console.log("  it verifies in every environment that reaches the same database. Setting");
  console.log("  ADMIN_PEPPER would mix in a value that must then match everywhere — off by");
  console.log("  default, and the usual cause of a password working in one place and not");
  console.log("  another.");
  console.log("");
  console.log("  ADMIN_SECRET remains the root credential and always signs in. Both addresses");
  console.log("  are derived from it, so changing that value changes them too — bookmark the");
  console.log("  lines above after any rotation.");
}

main().catch((error) => fail((error as Error).message));
