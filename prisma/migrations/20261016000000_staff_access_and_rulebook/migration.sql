-- Two additive tables for the access model and the rulebook.
--
-- Generated with `prisma migrate diff --from-config-datasource --to-schema
-- prisma/schema.prisma --script` against the live database, so it is exactly the
-- delta Prisma sees and nothing else. Both statements are CREATE, so existing
-- registrations are untouched.
--
-- Applied with `npx prisma db execute --stdin` rather than `migrate deploy`: the
-- pooled connection cannot hold the advisory lock that `migrate deploy` takes, and
-- it fails with P1002. See README.

-- CreateTable
CREATE TABLE "StaffAccess" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastLoginAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "StaffAccess_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Rulebook" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "bytes" BYTEA NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Rulebook_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StaffAccess_email_key" ON "StaffAccess"("email");
