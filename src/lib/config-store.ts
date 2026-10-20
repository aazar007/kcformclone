/**
 * Tournament config, cached for the Next.js server.
 *
 * Every request that needs the config goes through here so the (slow) Apps
 * Script read happens at most once per TTL per server instance, and so the
 * public form and the admin console can never disagree about what the current
 * tournament is.
 */

import { readStoredConfig, writeStoredConfig } from "./store";
import { DEFAULT_TOURNAMENT, normaliseConfig, type TournamentConfig } from "./tournament";

export type ConfigSource = "default" | "stored";

export interface LoadedConfig {
  config: TournamentConfig;
  source: ConfigSource;
}

/** Long enough to absorb a burst of page loads, short enough to feel live. */
const TTL_MS = 20_000;

let cache: (LoadedConfig & { at: number }) | null = null;
/** One in-flight read, so a cold burst of requests makes one call, not ten. */
let pending: Promise<LoadedConfig> | null = null;

async function read(): Promise<LoadedConfig> {
  const stored = await readStoredConfig();
  if (stored === null) return { config: { ...DEFAULT_TOURNAMENT }, source: "default" };
  return { config: normaliseConfig(stored), source: "stored" };
}

export async function loadConfig(): Promise<LoadedConfig> {
  if (cache && Date.now() - cache.at < TTL_MS) {
    return { config: cache.config, source: cache.source };
  }

  if (!pending) {
    pending = read()
      .catch((error) => {
        console.warn("[config] using the built-in tournament:", (error as Error).message);
        return { config: { ...DEFAULT_TOURNAMENT }, source: "default" as ConfigSource };
      })
      .then((result) => {
        cache = { ...result, at: Date.now() };
        pending = null;
        return result;
      });
  }

  return pending;
}

/**
 * Persist a config the admin console already normalised. The version stamp is
 * applied here rather than by the caller so it can never drift from the write.
 */
export async function saveConfig(config: TournamentConfig): Promise<TournamentConfig> {
  const stamped: TournamentConfig = { ...config, updatedAt: new Date().toISOString() };
  await writeStoredConfig(stamped);

  // The next reader must see what was just saved, not the previous TTL window.
  cache = { config: stamped, source: "stored", at: Date.now() };
  return stamped;
}
