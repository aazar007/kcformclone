import { defineCloudflareConfig } from "@opennextjs/cloudflare";

/**
 * Cloudflare Workers build.
 *
 * `opennextjs-cloudflare build` runs `npm run build` unless told otherwise, and
 * `npm run build` selects the **Node** Prisma client (for `next start`, Vercel and
 * local scripts). Shipped to Workers, that client cannot load its engine and every
 * database call fails. `build:workers` selects the Workers client first, so a
 * Cloudflare build always gets the right one, whatever the dashboard's build
 * command says.
 */
export default {
  ...defineCloudflareConfig(),
  buildCommand: "npm run build:workers",
};
