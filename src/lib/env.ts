import { getCloudflareContext } from "@opennextjs/cloudflare";

/**
 * Get any secret from Secrets Store bindings.
 *
 * Works dynamically — add a new binding to wrangler.jsonc, deploy,
 * and call `await getEnv("NEW_BINDING")` with no other changes.
 */
export async function getEnv(key: string): Promise<string | undefined> {
  const { env } = getCloudflareContext();
  const binding = (env as unknown as Record<string, unknown>)[key];

  // Secrets Store binding — async .get()
  if (binding && typeof (binding as { get?: unknown }).get === "function") {
    return await (binding as { get(): Promise<string> }).get();
  }

  // Regular Worker secret (string) — fallback
  if (typeof binding === "string") {
    return binding;
  }

  return undefined;
}
