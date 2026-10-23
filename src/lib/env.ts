import { getCloudflareContext } from "@opennextjs/cloudflare";

export function getEnv(key: string): string | undefined {
  const { env } = getCloudflareContext();
  return (env as unknown as Record<string, string | undefined>)[key];
}
