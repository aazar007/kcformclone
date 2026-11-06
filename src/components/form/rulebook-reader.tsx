"use client";

import * as React from "react";
import { AlertCircle, Loader2 } from "lucide-react";

import { useLanguage } from "./language-provider";

/**
 * The rulebook, rendered as pages we control the scrolling of.
 *
 * **Why not just an `<iframe src="…pdf">`.** The acknowledgement on the submission page
 * is supposed to mean "I read the rules", and the nudge behind it was only ever "the
 * document appeared". A frame around the browser's own PDF viewer cannot be improved on:
 * the scrolling happens inside a plugin the page has no access to, so nothing can tell
 * whether the reader reached page four of eleven or stopped at the first heading.
 *
 * So the pages are drawn onto canvases here. That buys three things the iframe could not:
 *
 * 1. **Scroll reach is observable.** The container is ours, so "reached the end" is a
 *    measurement rather than a guess.
 * 2. **The same on every device.** iOS Safari renders a PDF in a frame at a fixed size
 *    with its own awkward gesture handling; canvases laid out as a column behave like
 *    any other long page.
 * 3. **Crisp text.** Each page is drawn at the device pixel ratio, so it stays sharp on a
 *    phone instead of being upscaled from a PDF-unit bitmap.
 *
 * `pdfjs-dist` is imported **inside the effect**, not at the top of the file. The reader
 * is roughly a megabyte of JavaScript and only the rules tab needs it; a static import
 * would put it in the bundle of every visitor, including the ones filling in the form.
 *
 * **What this is not.** It is not proof that anybody read anything — a scroll to the
 * bottom is a scroll to the bottom. It is the same "nudge with teeth" the rest of this
 * flow is built on, and the copy never claims more.
 */
export function RulebookReader({
  src,
  title,
  onReadToEnd,
}: {
  src: string;
  /** Used for the accessible name of each page. Not the document's file name. */
  title: string;
  /**
   * Called once, when the reader reaches the end of the document.
   *
   * Also called when the whole document fits without scrolling — there is nothing to
   * scroll in that case, and demanding a gesture the layout does not offer would be a
   * dead end rather than a gate.
   */
  onReadToEnd: () => void;
}) {
  const { t } = useLanguage();
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const pagesRef = React.useRef<HTMLDivElement>(null);
  const [status, setStatus] = React.useState<"loading" | "ready" | "failed">("loading");
  /** The document is still being drawn, so its height is not final yet. */
  const reported = React.useRef(false);

  const report = React.useCallback(() => {
    if (reported.current) return;
    reported.current = true;
    onReadToEnd();
  }, [onReadToEnd]);

  React.useEffect(() => {
    let cancelled = false;
    let pdf: { destroy: () => Promise<void> } | null = null;
    reported.current = false;
    setStatus("loading");

    (async () => {
      try {
        /* The legacy build, because it is the one that still carries the polyfills for
           older mobile browsers — and this form is read on phones more than anywhere
           else. */
        const pdfjs = (await import(
          "pdfjs-dist/legacy/build/pdf.mjs"
        )) as unknown as PdfJsModule;

        /* A **fixed** path under `public/`, copied there by `npm run pdfjs:assets`.
           Deriving it from `new URL("pdfjs-dist/…", import.meta.url)` (what this used to
           do) turns it into a content-hashed `/_next/static/media/…` path, which makes the
           worker's location a build artefact that has to agree across two asset pipelines
           — Next's and OpenNext's. A constant served from this origin is the same on Node
           and on Workers, with nothing to keep in step. */
        pdfjs.GlobalWorkerOptions.workerSrc = "/pdfjs/pdf.worker.min.mjs";

        /*
         * **Fetch the document ourselves and hand pdf.js the bytes.**
         *
         * Two reasons, both of which matter only on a deployed host:
         *
         * 1. `url:` makes pdf.js stream the file with **byte-range requests**. That is
         *    normally fine, but through a serverless/edge proxy a range response can come
         *    back as a partial or re-encoded body. A PDF parsed from a truncated stream
         *    does not fail outright — it renders pages with mangled glyphs, because the
         *    font programs it did receive are only partly there. Fetching the whole body
         *    once and parsing from memory removes the class of failure entirely.
         * 2. It lets us check that what arrived is actually a PDF. A proxy or captive
         *    portal can answer with an HTML page and a `200`, which pdf.js would otherwise
         *    try to parse.
         */
        const response = await fetch(src, { cache: "no-store" });
        if (!response.ok) throw new Error(`The rulebook could not be fetched (${response.status}).`);

        const bytes = new Uint8Array(await response.arrayBuffer());
        /* `%PDF-` is the format's own magic number. Anything else is not a document we
           should try to draw. */
        const magic = new TextDecoder("latin1").decode(bytes.subarray(0, 5));
        if (magic !== "%PDF-") {
          throw new Error("The rulebook response was not a PDF.");
        }

        const loaded = await pdfjs.getDocument({
          data: bytes,
          /* Never evaluate anything out of the document. Rules PDFs come from an
             organiser's upload, but a PDF is a program as far as a viewer is concerned,
             and this one is rendered in the page that also holds the session cookie. */
          isEvalSupported: false,

          /*
           * **Glyphs are drawn as outlines, not as browser text.**
           *
           * This is the fix for "the rulebook is corrupted in Arabic", and it is worth
           * being precise about what was going on, because the document was never at
           * fault — the same file renders perfectly in Chrome's own PDF viewer.
           *
           * By default pdf.js registers each embedded font as a `FontFace` and then draws
           * text with `fillText`, so the **browser** lays the string out. Those fonts are
           * what a PDF calls a *shaped* font: the file stores the already-joined Arabic
           * glyphs (the `ﺔ` / `ﻦ` presentation forms), and the only correct way to draw
           * them is to place each one at the advance width the PDF states. When the
           * browser is handed the string instead, it applies its own shaping and its own
           * advances on top — and any doubt about the font's metrics shows up as exactly
           * what the organiser reported: letters coming apart in the wrong places, words
           * splitting, and — the tell — Latin text too, as "ROCK ET LEAGU E".
           *
           * With `disableFontFace`, pdf.js instead emits the glyph **outlines** from the
           * font program and paints them at their stated positions. No shaping is applied
           * a second time, so the page is reproduced as the PDF describes it. Verified on
           * the three rulebooks in the database: Arabic now connects and reads correctly,
           * and the Latin spacing is right.
           *
           * The cost is that text is no longer selectable inside the reader. That is a
           * fair trade for a document whose whole purpose is to be *read*: a reader who
           * wants to copy a line has the download button beside the reader.
           */
          disableFontFace: true,

          /*
           * **Arabic (and every non-Latin script) needs these, and without them the text
           * renders as garbage rather than as missing boxes** — which is what "the words
           * are corrupted" looks like.
           *
           * A PDF can describe its text in two ways. The safe one embeds the font and
           * carries a `ToUnicode` map, so the viewer never has to know what the bytes
           * mean. The other refers to a **predefined CMap** — `Identity-H`,
           * `UniGB-UCS2-H`, and friends — or uses one of the fourteen standard fonts
           * without embedding it. In that case pdf.js has to look the mapping up in
           * `cmaps/`, and the glyph shapes up in `standard_fonts/`.
           *
           * Both directories live in `public/pdfjs/`, served from this origin, so the
           * existing `connect-src 'self'` policy already covers them. They total 2.4 MB
           * and are fetched **only when a document actually needs one**.
           */
          cMapUrl: "/pdfjs/cmaps/",
          cMapPacked: true,
          standardFontDataUrl: "/pdfjs/standard_fonts/",
        }).promise;
        pdf = loaded;

        const host = pagesRef.current;
        if (!host || cancelled) return;
        host.replaceChildren();

        /*
         * **Check the text before drawing it.**
         *
         * If the font data could not be decoded, pdf.js does not throw: it substitutes
         * `.notdef` and the extracted text comes back as U+FFFD, which is exactly the
         * "corrupted words" symptom. Drawing that would show the reader a document they
         * cannot use.
         *
         * So page one is decoded first and inspected. A single replacement character
         * means the mapping failed, and the honest response is to stop drawing and let the
         * browser's own PDF viewer show the file instead — it brings its own font stack and
         * renders Arabic correctly. The acknowledgement still unlocks on "it loaded", which
         * is the weaker promise the iframe fallback has always offered.
         */
        const firstPage = await loaded.getPage(1);
        if (cancelled) return;
        const probe = await firstPage.getTextContent();
        const undecodable = probe.items.some((item) => (item.str ?? "").includes("\uFFFD"));
        if (undecodable) {
          throw new Error("The document's fonts could not be decoded on this device.");
        }

        /* Fit to the column, not to the window: the PDF should reflow to whatever width
           the reader has, like text does. `devicePixelRatio` keeps it sharp. */
        const columnWidth = host.clientWidth || 720;
        const ratio = Math.min(window.devicePixelRatio || 1, 2);

        for (let number = 1; number <= loaded.numPages; number += 1) {
          /* Page one was already fetched for the check above. */
          const page = number === 1 ? firstPage : await loaded.getPage(number);
          if (cancelled) return;

          const base = page.getViewport({ scale: 1 });
          const viewport = page.getViewport({ scale: (columnWidth * ratio) / base.width });

          const canvas = document.createElement("canvas");
          canvas.width = Math.floor(viewport.width);
          canvas.height = Math.floor(viewport.height);
          canvas.className = "block w-full rounded-xl bg-white shadow-lg";
          canvas.setAttribute("role", "img");
          canvas.setAttribute("aria-label", `${title} — ${number} / ${loaded.numPages}`);
          host.appendChild(canvas);

          const context = canvas.getContext("2d");
          if (!context) throw new Error("This browser cannot draw the rulebook.");
          await page.render({ canvasContext: context, viewport }).promise;
        }

        if (cancelled) return;
        setStatus("ready");
      } catch (error) {
        if (cancelled) return;
        /* The reader is a nicety; the rulebook is not. If it cannot start — an old
           browser, a blocked worker, a document pdf.js refuses — fall back to the
           browser's own viewer on the next render and keep the weaker "it loaded"
           unlock. A registration must never be blocked by the way the document is
           displayed. */
        console.warn("[rulebook] in-page reader unavailable, using the browser viewer:", error);
        setStatus("failed");
      }
    })();

    return () => {
      cancelled = true;
      void pdf?.destroy();
    };
  }, [src, title]);

  /* Reaching the bottom is the whole gate. `24` is a tolerance for sub-pixel layout and
     for a scrollbar that a mouse wheel lands a few pixels shy of the end. */
  React.useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;

    const onScroll = () => {
      const remaining = container.scrollHeight - container.scrollTop - container.clientHeight;
      if (remaining <= 24) report();
    };

    container.addEventListener("scroll", onScroll, { passive: true });
    return () => container.removeEventListener("scroll", onScroll);
  }, [report]);

  /* A short rulebook — one page, or two that fit — offers nothing to scroll. Checking
     after the pages are drawn is what makes the gate honest instead of impossible: the
     reader is told to scroll only when there is somewhere to scroll to. */
  React.useEffect(() => {
    if (status !== "ready") return;
    const container = scrollRef.current;
    if (container && container.scrollHeight <= container.clientHeight + 24) report();
  }, [status, report]);

  if (status === "failed") {
    /* The old behaviour, kept as the floor: the native viewer, and the document having
       loaded counts as having been reached. */
    return (
      <iframe
        src={src}
        title={title}
        onLoad={report}
        className="mt-4 h-[70vh] min-h-[26.25rem] w-full rounded-xl border border-[rgba(79, 182, 208,0.18)] bg-wall-950"
      />
    );
  }

  return (
    <div className="mt-4">
      <div
        ref={scrollRef}
        /* Keyboard users need to be able to scroll this by tabbing to it, and a scrollable
           region without a focus stop is one they cannot read. */
        tabIndex={0}
        role="region"
        aria-label={title}
        className="hud-scroll max-h-[70vh] min-h-[26.25rem] overflow-y-auto rounded-xl border border-[rgba(79, 182, 208,0.18)] bg-wall-950 p-3 focus-visible:ring-2 focus-visible:ring-brand/60 focus-visible:outline-none"
      >
        <div ref={pagesRef} className="space-y-3" />

        {status === "loading" && (
          <div className="flex min-h-[22.5rem] flex-col items-center justify-center gap-3 text-ash">
            <Loader2 className="size-5 animate-spin" />
            <p className="text-[0.6875rem]">{t("rulebook.loading")}</p>
          </div>
        )}
      </div>

      <p className="mt-3 flex items-start gap-1.5 text-[0.6875rem] leading-relaxed text-ash/80">
        <AlertCircle className="mt-px size-3.5 shrink-0" />
        <span>{t("rulebook.scrollHint")}</span>
      </p>
    </div>
  );
}

/**
 * Only the handful of members this component calls, typed locally.
 *
 * Importing the package's own declarations would drag a large `lib.dom` shape into a
 * client component that uses four of its members, and pin the build to whichever version
 * is installed. Everything crossing this boundary is checked by the shape below instead.
 */
interface PdfViewport {
  width: number;
  height: number;
}

interface PdfPage {
  getViewport(params: { scale: number }): PdfViewport;
  render(params: {
    canvasContext: CanvasRenderingContext2D;
    viewport: PdfViewport;
  }): { promise: Promise<void> };
  /**
   * The page's text, used only to detect undecodable fonts.
   *
   * pdf.js does not throw when a CMap or standard font cannot be resolved — it draws
   * `.notdef` and the text comes back as U+FFFD. Reading it is the only way to notice
   * before showing the reader a document full of boxes.
   */
  getTextContent(): Promise<{ items: { str?: string }[] }>;
}

interface PdfDocument {
  numPages: number;
  getPage(number: number): Promise<PdfPage>;
  destroy(): Promise<void>;
}

interface PdfJsModule {
  GlobalWorkerOptions: { workerSrc: string };
  getDocument(params: {
    /**
     * The document bytes, fetched by the reader itself.
     *
     * Preferred over `url:`: that makes pdf.js stream with byte-range requests, and a
     * partial or re-encoded range response from an edge proxy yields a document that
     * parses without error but draws mangled glyphs.
     */
    data?: Uint8Array;
    url?: string;
    isEvalSupported?: boolean;
    /**
     * Draw glyph outlines instead of registering a `FontFace`.
     *
     * Required for Arabic rulebooks: the files store pre-shaped glyphs, and letting the
     * browser lay them out a second time breaks the joins. See the call site.
     */
    disableFontFace?: boolean;
    /**
     * Where pdf.js finds its predefined CMap tables, and whether they are the packed
     * binary form. Needed for documents that describe text with a CMap rather than an
     * embedded font — without it, non-Latin text renders as garbage.
     */
    cMapUrl?: string;
    cMapPacked?: boolean;
    /** Where pdf.js finds the fourteen standard fonts when a document does not embed them. */
    standardFontDataUrl?: string;
  }): {
    promise: Promise<PdfDocument>;
  };
}
