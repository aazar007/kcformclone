import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

/**
 * The Prisma client for the registration database.
 * hello
 * Prisma 7 has no connection URL in the schema — the driver adapter owns it — so
 * the client is built here, lazily, and reused across hot reloads in
 * development. Every caller goes through `getPrisma()`.
 */

/** Thrown when the deployment has no database configured. */
export class DatabaseNotConfiguredError extends Error {
  constructor() {
    super("DATABASE_URL is not set, so the registration database cannot be reached.");
    this.name = "DatabaseNotConfiguredError";
  }
}

const globalForPrisma = globalThis as unknown as { ksuPrisma?: PrismaClient };

let cached: PrismaClient | null = null;

/**
 * The shared Prisma client.
 *
 * Construction is deferred until the first query so that an unconfigured
 * database produces one clear error at the call site rather than crashing the
 * module graph while the page is being rendered.
 */
export function getPrisma(): PrismaClient {
  if (cached) return cached;

  const connectionString = env.database_binding.connectionString;
  if (!connectionString) throw new DatabaseNotConfiguredError();

  cached =
    globalForPrisma.ksuPrisma ??
    new PrismaClient({
      adapter: new PrismaPg({
        connectionString,

        /* Connection tuning, because the default behaviour is bad in both
           directions for a hosted, pooled PostgreSQL:

           - Without a connect timeout, a dropped network path surfaced after
             **55 seconds**, reported to the organiser as "could not save" with no
             hint that the database was the problem. Failing in ten is long
             enough for a slow handshake and short enough to act on.
           - `keepAlive` stops the OS from closing an idle pooled socket, which
             is what produced `read EADDRNOTAVAIL` on the next query: the
             connection looked alive to `pg` and dead to the kernel.
           - A small pool suits serverless, where each instance serves one
             request at a time and the pooler is already doing the multiplexing.
             A large one just holds sockets the provider will idle out. */
        max: 5,
        connectionTimeoutMillis: 10_000,
        idleTimeoutMillis: 30_000,
        keepAlive: true,
        keepAliveInitialDelayMillis: 5_000,
        application_name: "ksu-crown",
      }),
      log: process.env.NODE_ENV === "production" ? ["error"] : ["error", "warn"],
    });

  // A dev-server reload must reuse the connection pool instead of leaking one.
  if (process.env.NODE_ENV !== "production") globalForPrisma.ksuPrisma = cached;

  return cached;
}

/** True when a database is configured — used to fail fast with a clear message. */
export function databaseConfigured() {
  return Boolean(process.env.DATABASE_URL?.trim());
}
