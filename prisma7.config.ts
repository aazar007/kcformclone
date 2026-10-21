import "dotenv/config";
import { defineConfig } from "prisma7/config";

/**
 * Prisma **7** CLI configuration.
 *
 * This is the same file the v7 CLI used before Prisma 8 was adopted, renamed so the two
 * versions stop fighting over one filename — they want incompatible shapes, and the v8
 * CLI cannot read `schema`/`datasource` while the v7 CLI cannot read `orm`.
 *
 * Every v7 command names it explicitly:
 *
 *   node node_modules/prisma7/build/index.js migrate … --config prisma7.config.ts
 *
 * (see the `db:*` scripts). Prisma 7 still owns `schema.prisma` and the migration history;
 * Prisma 8 reads that schema through `prisma7Schema()` in `prisma.config.ts`.
 *
 * `process.env` is read directly rather than through the `env()` helper so that
 * `prisma generate` still works on CI, where only a build-time subset of the environment
 * is present and `DATABASE_URL` may be absent.
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
