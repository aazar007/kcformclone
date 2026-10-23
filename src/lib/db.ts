import { PrismaClient } from "../../generated/prisma-client/client";
import { PrismaPg } from "@prisma/adapter-pg";

/**
 * The Prisma client for the registration database.
 *
 * Prisma 7 has no connection URL in the schema — the driver adapter owns it — so
 * the client is built here, lazily. Every caller goes through `getPrisma()`.
 *
 * Where the connection string comes from, first match wins:
 *
 * 1. A `HYPERDRIVE` binding, when the Worker has one.
 * 2. `DATABASE_URL` — a Worker secret on Cloudflare, or `process.env` on Node.
 *    Prisma Postgres already pools connections, so a direct connection from the
 *    Worker is fine without Hyperdrive.
 *
 * Reuse rules differ by runtime:
 *
 * - **Cloudflare Workers** forbid one request from using a socket opened by
 *   another ("Cannot perform I/O on behalf of a different request"). So on
 *   Workers the client is cached per request, keyed on that request's context,
 *   and garbage-collected with it.
 * - **Node** (local `next dev`) keeps one client for the whole process and
 *   across hot reloads, so the pool is not leaked.
 */

/** Thrown when the deployment has no database configured. */
export class DatabaseNotConfiguredError extends Error {
  constructor() {
    super("DATABASE_URL is not set, so the registration database cannot be reached.");
    this.name = "DatabaseNotConfiguredError";
  }
}

const CLOUDFLARE_CONTEXT = Symbol.for("__cloudflare-context__");

interface CloudflareRequestContext {
  env?: Record<string, unknown>;
  ctx?: object;
}

/** The current Worker request's context, or undefined outside a Worker request. */
function cloudflareContext(): CloudflareRequestContext | undefined {
  return (globalThis as Record<symbol, unknown>)[CLOUDFLARE_CONTEXT] as
    | CloudflareRequestContext
    | undefined;
}

function connectionString(): string | undefined {
  const env = cloudflareContext()?.env;
  const hyperdrive = env?.HYPERDRIVE as { connectionString?: string } | undefined;
  if (hyperdrive?.connectionString) return hyperdrive.connectionString;

  const workerSecret = env?.DATABASE_URL;
  if (typeof workerSecret === "string" && workerSecret.trim()) return workerSecret.trim();

  const nodeValue = process.env.DATABASE_URL;
  return nodeValue?.trim() || undefined;
}

function createClient(url: string, onWorkers: boolean): PrismaClient {
  return new PrismaClient({
    adapter: new PrismaPg({
      connectionString: url,

      /* Connection tuning, because the defaults are bad in both directions for a
         hosted, pooled PostgreSQL:

         - Without a connect timeout, a dropped network path surfaced after
           **55 seconds**, reported to the organiser as "could not save" with no
           hint that the database was the problem. Ten seconds is long enough
           for a slow handshake and short enough to act on.
         - `keepAlive` stops the OS from closing an idle pooled socket on Node.
         - On Workers the client lives for one request, so one connection is
           enough and nothing should idle. */
      max: onWorkers ? 1 : 5,
      connectionTimeoutMillis: 10_000,
      idleTimeoutMillis: onWorkers ? 0 : 30_000,
      ...(onWorkers ? {} : { keepAlive: true, keepAliveInitialDelayMillis: 5_000 }),
      application_name: "ksu-crown",
    }),
    log: process.env.NODE_ENV === "production" ? ["error"] : ["error", "warn"],
  });
}

/** One client per Worker request, released with the request. */
const perRequest = new WeakMap<object, PrismaClient>();

/** One client for the whole Node process (dev hot reloads included). */
const globalForPrisma = globalThis as unknown as { ksuPrisma?: PrismaClient };

/**
 * The Prisma client for the current request.
 *
 * Construction is deferred until the first query so that an unconfigured
 * database produces one clear error at the call site rather than crashing the
 * module graph while the page is being rendered.
 */
export async function getPrisma(): Promise<PrismaClient> {
  const url = connectionString();
  if (!url) throw new DatabaseNotConfiguredError();

  const context = cloudflareContext();
  const requestKey = context?.ctx ?? context;
  if (requestKey) {
    let client = perRequest.get(requestKey);
    if (!client) {
      client = createClient(url, true);
      perRequest.set(requestKey, client);
    }
    return client;
  }

  globalForPrisma.ksuPrisma ??= createClient(url, false);
  return globalForPrisma.ksuPrisma;
}

/** True when a database is configured — used to fail fast with a clear message. */
export async function databaseConfigured(): Promise<boolean> {
  return Boolean(connectionString());
}
