/**
 * Keys for images stored in the shared sponsor-logo table.
 *
 * The table holds one row per owning thing, keyed by a string. Sponsors use their own
 * slug, while anything else — a watch channel, a footer social account — is namespaced
 * with a prefix so two owners can never collide. This module is deliberately free of
 * database imports: the admin console and the public footer both need to build these
 * keys in the browser, and importing `store.ts` there would drag the database client
 * into the bundle.
 */

const KEY_PATTERN = /^[a-z0-9][a-z0-9-]{0,47}$/;

function prefixed(prefix: string, id: string): string | null {
  return KEY_PATTERN.test(id) ? `${prefix}:${id}` : null;
}

/** The key a "where to watch" channel's logo is stored under. */
export function channelLogoKey(channelId: string): string | null {
  return prefixed("channel", channelId);
}

/** The key a footer social account's logo is stored under. */
export function socialLogoKey(socialId: string): string | null {
  return prefixed("social", socialId);
}
