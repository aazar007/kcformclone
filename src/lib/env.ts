import { env } from "cloudflare:workers";

export function getEnv(key: string): string | undefined {
  return (env as Record<string, string | undefined>)[key];
}
