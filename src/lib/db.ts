import { getCloudflareContext } from "@opennextjs/cloudflare";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

export class DatabaseNotConfiguredError extends Error {
  constructor() {
    super("Hyperdrive binding is not configured, so the registration database cannot be reached.");
    this.name = "DatabaseNotConfiguredError";
  }
}

const globalForPrisma = globalThis as unknown as { ksuPrisma?: PrismaClient };

let cached: PrismaClient | null = null;

export function getPrisma(): PrismaClient {
  if (cached) return cached;

  const { env } = getCloudflareContext();
  const connectionString = env.database_binding?.connectionString;
  if (!connectionString) throw new DatabaseNotConfiguredError();

  cached =
    globalForPrisma.ksuPrisma ??
    new PrismaClient({
      adapter: new PrismaPg({
        connectionString,
        max: 5,
        connectionTimeoutMillis: 10_000,
        idleTimeoutMillis: 30_000,
        keepAlive: true,
        keepAliveInitialDelayMillis: 5_000,
        application_name: "ksu-crown",
      }),
      log: process.env.NODE_ENV === "production" ? ["error"] : ["error", "warn"],
    });

  if (process.env.NODE_ENV !== "production") globalForPrisma.ksuPrisma = cached;

  return cached;
}

export function databaseConfigured() {
  const { env } = getCloudflareContext();
  return Boolean(env.database_binding?.connectionString);
}
