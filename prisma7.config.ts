import "dotenv/config";
import { defineConfig } from "prisma7/config";

/**
 * Prisma 7 CLI configuration (`npm run prisma7 -- ...`).
 *
 * Prisma 7 still generates the client the app uses at runtime and owns the
 * migrations in prisma/migrations. The Prisma 8 CLI (`prisma ...`) reads
 * prisma.config.ts and is only used to emit the data contract for Prisma Cloud.
 *
 * Prisma 7 no longer accepts a connection URL inside `schema.prisma` — the CLI
 * reads it from here, and the runtime client gets it through the driver adapter
 * in `src/lib/db.ts`. Both ultimately come from `DATABASE_URL`.
 *
 * `process.env` is read directly rather than through the `env()` helper so that
 * `generate` still works on CI, where only a build-time subset of the
 * environment is present and `DATABASE_URL` may be absent.
 */
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: process.env.DATABASE_URL ?? "",
  },
});
