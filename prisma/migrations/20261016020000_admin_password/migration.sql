-- The grand admin's password, stored as a hash.
--
-- Added so the password can be set and changed from the console without a redeploy,
-- while `ADMIN_SECRET` stays valid as the root credential: the first owner session has
-- to come from somewhere, and a forgotten password must not lock anyone out of their
-- own tournament.
--
-- A single row, enforced by the primary key on a fixed id.
--
-- Applied by hand, like the earlier migrations — the pooled connection cannot hold the
-- advisory lock `prisma migrate deploy` takes, so it fails with P1002. See the README.

CREATE TABLE "AdminCredential" (
    "id" TEXT NOT NULL DEFAULT 'owner',
    "passwordHash" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedVia" TEXT NOT NULL DEFAULT 'console',

    CONSTRAINT "AdminCredential_pkey" PRIMARY KEY ("id")
);
