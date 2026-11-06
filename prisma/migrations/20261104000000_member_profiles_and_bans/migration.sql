-- Members now complete their own details after the captain enters only their
-- university and email, so a non-leader row may be stored incomplete.
ALTER TABLE "Member" ADD COLUMN "profileCompletedAt" TIMESTAMP(3);

-- Organisers can ban a team or an individual player.
ALTER TABLE "Member" ADD COLUMN "bannedAt" TIMESTAMP(3);
ALTER TABLE "Member" ADD COLUMN "banReason" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Team" ADD COLUMN "bannedAt" TIMESTAMP(3);
ALTER TABLE "Team" ADD COLUMN "banReason" TEXT NOT NULL DEFAULT '';

-- Rows written before this migration were entered in full by the captain.
UPDATE "Member" SET "profileCompletedAt" = COALESCE("emailConfirmedAt", "createdAt");
