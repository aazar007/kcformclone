import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { Archivo_Black, Inter, JetBrains_Mono, Tajawal } from "next/font/google";
import { LANGUAGE_BOOTSTRAP_SCRIPT } from "@/lib/i18n";
import "./globals.css";

/**
 * Archivo Black stands in for the heavy condensed grotesque of the KSU Crown
 * wordmark, Inter carries the form UI, and JetBrains Mono renders IDs and the
 * registration reference where digits must line up.
 */
const display = Archivo_Black({
  weight: "400",
  subsets: ["latin"],
  /* `--font-archivo`, not `--font-display`. `--font-display` is the composed
     family list Tailwind exposes in `globals.css`, and the language rules there need
     to name the raw family per language — which they cannot do while the raw and the
     composed value share a name, because a declaration that reads its own property is
     invalid at computed-value time and the winner between the two is decided by source
     order. */
  variable: "--font-archivo",
  display: "swap",
});

const body = Inter({
  subsets: ["latin"],
  variable: "--font-body",
  display: "swap",
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono-var",
  display: "swap",
});

/**
 * Tajawal, for Arabic.
 *
 * Arabic needs its own face rather than a Latin one with fallbacks. Inter and
 * Archivo Black are `latin`-subset fonts with **no Arabic glyphs at all**, so every
 * Arabic heading was silently falling through to whatever `system-ui` happened to be —
 * which differs per machine and looks nothing like the wordmark the design is built
 * around.
 *
 * `latin` is included alongside `arabic` on purpose. An Arabic form still contains
 * Latin — the captain's team name, an email address, the digit on a player badge — and
 * a stack that hands those to a second family renders one sentence in two typefaces.
 * Tajawal's Latin is drawn to sit with its Arabic, so mixed text stays even.
 *
 * Weights: 400 for body, 700 for the 63 `font-bold` uses, 800 to stand in for
 * Archivo Black's weight on the nine `font-display` headings. **Tajawal has no 600**, so
 * the 11 `font-semibold` uses resolve to the nearest declared weight (700) — worth
 * knowing before anyone "fixes" the missing weight.
 */
const arabic = Tajawal({
  weight: ["400", "700", "800"],
  subsets: ["arabic", "latin"],
  variable: "--font-arabic",
  display: "swap",
});

export const metadata: Metadata = {
  title: "KSU Crown · Team Registration",
  description:
    "Register your team for the KSU Crown esports championship — squad details, university verification and match-day contacts.",
  /* The tab icons come from favicon.ico / icon.png in this folder. The iOS icon is a route
     (see apple-touch-icon.png/route.ts) because it must differ by browser: Safari gets a
     background, every other browser a transparent crown. */
  icons: { apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }] },
};

export const viewport: Viewport = {
  themeColor: "#243035",
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
      className={`${display.variable} ${body.variable} ${mono.variable} ${arabic.variable}`}
    >
      <head>
        {/* A fixed string with no interpolation, so there is nothing to inject. */}
        <script nonce={nonce} suppressHydrationWarning dangerouslySetInnerHTML={{ __html: LANGUAGE_BOOTSTRAP_SCRIPT }} />
      </head>
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
