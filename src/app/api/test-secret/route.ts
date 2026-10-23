// app/api/test-secret/route.ts
import { getEnv } from "@/lib/env";

export async function GET() {
  return Response.json({
    databaseUrl: getEnv("DATABASE_URL") ? "FOUND" : "MISSING",
    smtpHost: getEnv("SMTP_OTP_HOST") ? "FOUND" : "MISSING",
    otpSecret: getEnv("OTP_SECRET") ? "FOUND" : "MISSING",
  });
}
