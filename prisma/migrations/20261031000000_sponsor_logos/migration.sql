-- Sponsor logos, stored the way game logos already are.
--
-- The organisers asked for sponsors to carry real uploaded artwork rather than the
-- wordmark that stood in for it. The bytes go in the database for the same reason a game
-- logo's do: the deployment filesystem is ephemeral, so a file written at runtime does not
-- survive a deploy.
--
-- Keyed by `sponsorId` — the slug in `Config.sponsors[].id` — with no foreign key, because
-- sponsors are rows inside a JSON column rather than a table. A sponsor deleted from the
-- config therefore leaves its bytes behind; `pruneSponsorLogos` removes them on the next
-- console save.
--
-- Applied by hand, like the earlier migrations — the pooled connection cannot hold the
-- advisory lock `prisma migrate deploy` takes (P1002). See the README.

CREATE TABLE "SponsorLogo" (
  "sponsorId" TEXT    NOT NULL,
  "mimeType"  TEXT    NOT NULL,
  "width"     INTEGER NOT NULL,
  "height"    INTEGER NOT NULL,
  "size"      INTEGER NOT NULL,
  "bytes"     BYTEA   NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "SponsorLogo_pkey" PRIMARY KEY ("sponsorId")
);
