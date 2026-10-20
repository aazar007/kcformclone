-- One rulebook per game, instead of one for the whole tournament.
--
-- Each title is played by different rules, and a team only ever needs the rules for
-- the game it entered, so the document is keyed by `gameId` exactly like `GameLogo`.
--
-- Generated with `prisma migrate diff --from-config-datasource --to-schema
-- prisma/schema.prisma --script` against the live database.
--
-- Applied with `npx prisma db execute --stdin` rather than `migrate deploy`: the
-- pooled connection cannot hold the advisory lock `migrate deploy` takes, and it
-- fails with P1002. See README.
--
-- The table held no rows when this ran — the single-rulebook feature was never used
-- in production — so re-keying it loses nothing.

-- AlterTable
ALTER TABLE "Rulebook" DROP CONSTRAINT "Rulebook_pkey",
DROP COLUMN "id",
ADD COLUMN     "gameId" TEXT NOT NULL,
ADD CONSTRAINT "Rulebook_pkey" PRIMARY KEY ("gameId");
