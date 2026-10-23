import { getCloudflareContext } from "@opennextjs/cloudflare";

export async function GET() {
  const results: Record<string, unknown> = {};

  // Test 1: process.env
  try {
    results.processEnv = {
      keys: Object.keys(process.env).filter(k => !k.startsWith("_")),
      databaseUrl: process.env.DATABASE_URL ? "SET" : "NOT SET",
    };
  } catch (e) {
    results.processEnv = { error: String(e) };
  }

  // Test 2: getCloudflareContext
  try {
    const { env } = getCloudflareContext();
    results.cloudflareContext = {
      keys: Object.keys(env as object),
      databaseUrl: (env as Record<string, unknown>).DATABASE_URL ? "SET" : "NOT SET",
    };
  } catch (e) {
    results.cloudflareContext = { error: String(e) };
  }

  // Test 3: new Function
  try {
    const get = new Function("key", "return process.env[key]") as (k: string) => string | undefined;
    results.newFunction = {
      databaseUrl: get("DATABASE_URL") ? "SET" : "NOT SET",
    };
  } catch (e) {
    results.newFunction = { error: String(e) };
  }

  return Response.json(results);
}
