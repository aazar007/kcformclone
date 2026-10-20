-- Records when the captain accepted the privacy notice and confirmed every member
-- knows their details are shared.
--
-- Nullable on purpose: entries created before consent was collected have no
-- timestamp, and back-filling one would fabricate a decision nobody made.
ALTER TABLE "Team" ADD COLUMN "consentedAt" TIMESTAMP(3);
