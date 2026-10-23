import { getEnv } from "@/lib/env";

export async function GET() {
  return Response.json({
    smtpHost: getEnv("SMTP_OTP_HOST") ?? "MISSING",
    otpSecret: getEnv("OTP_SECRET") ? "FOUND" : "MISSING",
  });
}
