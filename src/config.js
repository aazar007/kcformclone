// All secrets are stored in Cloudflare: Worker → Settings → Variables and Secrets.
// To add a new key: add it in the dashboard, then add it to REQUIRED_KEYS and to the object below.

const REQUIRED_KEYS = [
  "ADMIN_SECRET",
  "DATABASE_URL",
  "OTP_SECRET",
  "SHEET_WEBHOOK_SECRET",
  "SHEET_WEBHOOK_URL",
  "SMTP_OTP_FROM",
  "SMTP_OTP_HOST",
  "SMTP_OTP_PASS",
  "SMTP_OTP_PORT",
  "SMTP_OTP_USER",
  // add new keys here
];

export function getConfig(env) {
  const missing = REQUIRED_KEYS.filter((key) => !env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing secrets: ${missing.join(", ")}`);
  }

  return {
    adminSecret: env.ADMIN_SECRET,
    databaseUrl: env.DATABASE_URL,
    otpSecret: env.OTP_SECRET,

    sheet: {
      webhookUrl: env.SHEET_WEBHOOK_URL,
      webhookSecret: env.SHEET_WEBHOOK_SECRET,
    },

    smtp: {
      host: env.SMTP_OTP_HOST,
      port: Number(env.SMTP_OTP_PORT), // secrets are always text, so convert to a number
      user: env.SMTP_OTP_USER,
      pass: env.SMTP_OTP_PASS,
      from: env.SMTP_OTP_FROM,
    },

    // add new keys here
  };
}
