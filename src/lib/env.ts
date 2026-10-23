import { env } from "cloudflare:workers";

export function getEnv(key: string): string | undefined {
  return (env as unknown as Record<string, string | undefined>)[key];
}
