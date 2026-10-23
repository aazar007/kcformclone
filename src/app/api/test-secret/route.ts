// app/api/test-secret/route.ts
import { getEnv } from "@/lib/env";

export async function GET() {
  return Response.json({
    databaseUrl: (await getEnv("DATABASE_URL")) ? "FOUND" : "MISSING",
    smtpHost: (await getEnv("SMTP_OTP_HOST")) ? "FOUND" : "MISSING",
    otpSecret: (await getEnv("OTP_SECRET")) ? "FOUND" : "MISSING",
  });
}
