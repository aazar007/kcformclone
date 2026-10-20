-- Supports the site-wide OTP ceiling added with the security audit.
--
-- `countAllRecentOtps(purpose, since)` filters on both columns and runs on the public
-- verification and edit-lookup endpoints. Without this index the abuse control would
-- itself be the cheapest thing to make expensive.
--
-- Applied by hand, like the earlier migrations — the pooled connection cannot hold the
-- advisory lock `prisma migrate deploy` takes (P1002). See the README.

CREATE INDEX "OtpCode_purpose_createdAt_idx" ON "OtpCode"("purpose", "createdAt");
