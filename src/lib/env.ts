import { getCloudflareContext } from "@opennextjs/cloudflare";

/** Get a secret/value from the Worker's env bindings. */
export function getEnv(key: string): string | undefined {
  const { env } = getCloudflareContext();
  return (env as Record<string, string | undefined>)[key];
}
