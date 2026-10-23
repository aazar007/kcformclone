import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

export class DatabaseNotConfiguredError extends Error {
  constructor() {
    super("DATABASE_URL is not set, so the registration database cannot be reached.");
    this.name = "DatabaseNotConfiguredError";
  }
}

const globalForPrisma = globalThis as unknown as { ksuPrisma?: PrismaClient };

let cached: PrismaClient | null = null;

export function getPrisma(): PrismaClient {
  if (cached) return cached;

  const connectionString = process.env.DATABASE_URL?.trim();
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
  return Boolean(process.env.DATABASE_URL?.trim());
}
