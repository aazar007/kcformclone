-- Per-member email confirmation.
--
-- Until now every roster member had to prove their address with a one-time code
-- before the team could submit. The organisers asked for a lighter handover: only
-- the team leader is verified during registration, and every other member gets a
-- confirmation link by email. They are "pending" until they click it, and the
-- leader may submit without waiting.
--
-- `emailConfirmedAt` is the status the console shows. `confirmTokenHash` holds a
-- SHA-256 of the single-use link token: only the hash is stored, so a database
-- leak cannot be used to confirm somebody else's address.
--
-- Existing rows were all verified under the old flow, so they are backfilled as
-- confirmed rather than appearing pending after the deploy.

ALTER TABLE "Member"
  ADD COLUMN "emailConfirmedAt" TIMESTAMP(3),
  ADD COLUMN "confirmTokenHash" TEXT;

UPDATE "Member"
  SET "emailConfirmedAt" = COALESCE("createdAt", NOW())
  WHERE "emailConfirmedAt" IS NULL;

CREATE UNIQUE INDEX "Member_confirmTokenHash_key"
  ON "Member" ("confirmTokenHash");
