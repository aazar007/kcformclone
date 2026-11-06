import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { JetBrains_Mono } from "next/font/google";
import { LANGUAGE_BOOTSTRAP_SCRIPT } from "@/lib/i18n";
import "./globals.css";

/**
 * Self-hosted IBM Plex, in both scripts.
 *
 * The two faces are served from `public/fonts` and declared in `globals.css`, rather
 * than pulled from a font CDN or next/font:
 *
 * - **They are the same design.** IBM Plex Sans carries the Latin, IBM Plex Sans
 *   Arabic the Arabic, and the Arabic family also ships a Latin subset drawn to sit
 *   with it. A sentence that mixes the two — a team name inside an Arabic sentence —
 *   therefore stays one typeface instead of changing appearance mid-line.
 * - **No third party on the critical path.** A webfont from another origin costs a
 *   DNS lookup and a TLS handshake before the first glyph can paint, and a university
 *   network that blocks that origin leaves the whole site in the fallback face.
 * - **Nothing is fetched at build time**, so a CI machine without network can still
 *   build the site.
 *
 * Only the four weights the interface actually uses are shipped (400/500/600/700),
 * split by script, so a reader downloads the Arabic glyphs or the Latin ones — not
 * both, and not the whole family.
 *
 * `JetBrains Mono` stays a Google font on purpose: it renders one-time codes, student
 * numbers and reference codes, which are fixed-width Latin tokens and must not fall
 * to a proportional face.
 */
const mono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono-var",
  display: "swap",
});

/**
 * Consume the "View form" deep link before hydration.
 *
 * The console links to `/?tab=register` so an organiser lands on the form. That query
 * must not survive the visit: refreshing it used to re-open the form, and to anyone
 * else the site appeared to have forgotten it has a home page.
 *
 * A React effect does the same thing later, but it runs only after hydration — so a
 * refresh during a slow load, or a hydration failure, still saw `?tab=register`. Doing
 * it in `<head>` removes the query while the HTML is still being parsed, before
 * Next.js's router reads the address at all. `lang` is deliberately kept so a link
 * that carried a language still opens in that language.
 *
 * `tab=edit` is left alone: the confirmation email deliberately points at an address
 * meant to be reopened.
 */
const FORM_DEEP_LINK_BOOTSTRAP_SCRIPT = `(function(){try{
if(location.pathname!=="/")return;
var u=new URL(location.href);
if(u.searchParams.get("tab")!=="register")return;
u.searchParams.delete("tab");
history.replaceState(history.state,"",u.pathname+(u.search||"")+u.hash);
}catch(e){}})();`;

/**
 * Decide the headline's reveal state **before the first paint**.
 *
 * The animation starts with the sentence hidden, and it used to hide it from a React
 * effect — which runs after hydration, so the full sentence painted first and was then
 * blanked. That flash is what this script removes: it runs while `<head>` is being
 * parsed, before a single pixel of the body is drawn.
 *
 * Three states, set on `<html>`:
 *
 * - `pending` — JavaScript is available and motion is welcome. The sentence is masked
 *   to nothing by CSS, and the component animates it in on mount.
 * - `done` — the visitor asked for reduced motion, so the sentence is simply shown.
 * - *(absent)* — no JavaScript at all, since only this script can set the attribute.
 *   The default CSS leaves the sentence visible, so the headline still reads.
 *
 * Fixed string, no interpolation, so there is nothing to inject.
 */
const CROWN_REVEAL_BOOTSTRAP_SCRIPT = `(function(){try{
var e=document.documentElement;
var reduce=window.matchMedia&&window.matchMedia("(prefers-reduced-motion: reduce)").matches;
e.setAttribute("data-crown",reduce?"done":"pending");
}catch(e){}})();`;

export const metadata: Metadata = {
  title: "KSU Crown · Team Registration",
  description:
    "Register your team for the KSU Crown esports championship — squad details, university verification and match-day contacts.",
  /* The tab icons come from favicon.ico / icon.png in this folder. The iOS icon is a route
     (see apple-touch-icon.png/route.ts) because it must differ by browser: Safari gets a
     background, every other browser a transparent crown. */
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/icon.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
};

export const viewport: Viewport = {
  themeColor: "#0a2129",
  width: "device-width",
  initialScale: 1,
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // The per-request nonce from middleware.ts; reading it also makes pages render per request.
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  return (
    /*
     * The server cannot know which language this visitor chose — the choice lives
     * in their browser — so the markup ships with the app's default (Arabic) and
     * the script below corrects it before the first paint. Without that script the
     * browser would lay the page out in the wrong direction and then flip it, a
     * jump that is most visible on a slow connection.
     *
     * `suppressHydrationWarning` is required, not a shortcut: the script changes
     * these two attributes before React hydrates, so React's expected values
     * legitimately differ from the DOM. It silences the mismatch for this element's
     * attributes only — it does not skip hydrating the tree beneath it — and it is
     * the documented pattern for anything a pre-paint script has to set.
     */
    <html
      lang="ar"
      dir="rtl"
      suppressHydrationWarning
      className={mono.variable}
    >
      <head>
        {/* A fixed string with no interpolation, so there is nothing to inject. */}
        <script nonce={nonce} suppressHydrationWarning dangerouslySetInnerHTML={{ __html: LANGUAGE_BOOTSTRAP_SCRIPT }} />
        {/* Before the first paint, so the headline never flashes whole and then
            disappears. See the note on `CROWN_REVEAL_BOOTSTRAP_SCRIPT`. */}
        <script nonce={nonce} suppressHydrationWarning dangerouslySetInnerHTML={{ __html: CROWN_REVEAL_BOOTSTRAP_SCRIPT }} />
        {/* Runs before Next's router is hydrated, so the query never becomes the page's
            permanent address. See the note on `FORM_DEEP_LINK_BOOTSTRAP_SCRIPT`. */}
        <script nonce={nonce} suppressHydrationWarning dangerouslySetInnerHTML={{ __html: FORM_DEEP_LINK_BOOTSTRAP_SCRIPT }} />
        {/* Start the two faces the first screen needs while the HTML is still being
            parsed. Everything else is requested by `@font-face` when a glyph needs it,
            so this is a hint rather than a bundle: the regular weights carry the body
            text, which is on screen before anything else.

            `crossOrigin` is required even for same-origin fonts — a font is always
            fetched in CORS mode, and without the attribute the preload is discarded as
            a mismatch and the file is downloaded twice. */}
        <link
          rel="preload"
          as="font"
          type="font/woff2"
          href="/fonts/plex-sans/IBMPlexSans-Regular.woff2"
          crossOrigin="anonymous"
        />
        <link
          rel="preload"
          as="font"
          type="font/woff2"
          href="/fonts/plex-sans-arabic/ibm-plex-sans-arabic-arabic-400-normal.woff2"
          crossOrigin="anonymous"
        />
      </head>
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
