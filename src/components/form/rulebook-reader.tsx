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

        /* Bundled by webpack into an asset URL on this origin, which `worker-src 'self'`
           already allows. A CDN worker would need its own CSP entry and a network round
           trip, for no benefit. */
        pdfjs.GlobalWorkerOptions.workerSrc = new URL(
          "pdfjs-dist/legacy/build/pdf.worker.min.mjs",
          import.meta.url,
        ).toString();

        const loaded = await pdfjs.getDocument({
          url: src,
          /* Never evaluate anything out of the document. Rules PDFs come from an
             organiser's upload, but a PDF is a program as far as a viewer is concerned,
             and this one is rendered in the page that also holds the session cookie. */
          isEvalSupported: false,
        }).promise;
        pdf = loaded;

        const host = pagesRef.current;
        if (!host || cancelled) return;
        host.replaceChildren();

        /* Fit to the column, not to the window: the PDF should reflow to whatever width
           the reader has, like text does. `devicePixelRatio` keeps it sharp. */
        const columnWidth = host.clientWidth || 720;
        const ratio = Math.min(window.devicePixelRatio || 1, 2);

        for (let number = 1; number <= loaded.numPages; number += 1) {
          const page = await loaded.getPage(number);
          if (cancelled) return;

          const base = page.getViewport({ scale: 1 });
          const viewport = page.getViewport({ scale: (columnWidth * ratio) / base.width });

          const canvas = document.createElement("canvas");
          /* Always left-to-right, whatever the page language is. A canvas's text
             direction defaults to "inherit", so on the Arabic page (dir="rtl") every
             glyph pdf.js places was drawn right-aligned from its own position — letters
             pulled apart and words scrambled. pdf.js positions each glyph itself in PDF
             (left-to-right) coordinates; the Arabic in the document is already shaped
             and ordered, so LTR is correct for every language. */
          canvas.dir = "ltr";
          canvas.width = Math.floor(viewport.width);
          canvas.height = Math.floor(viewport.height);
          canvas.className = "block w-full rounded-xl bg-white shadow-lg";
          canvas.setAttribute("role", "img");
          canvas.setAttribute("aria-label", `${title} — ${number} / ${loaded.numPages}`);
          host.appendChild(canvas);

          const context = canvas.getContext("2d");
          if (!context) throw new Error("This browser cannot draw the rulebook.");
          /* Belt and braces for browsers that resolve the context's direction before the
             attribute takes effect. */
          context.direction = "ltr";
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
        className="mt-4 h-[70vh] min-h-[420px] w-full rounded-xl border border-[rgba(148,196,208,0.18)] bg-wall-950"
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
        className="hud-scroll max-h-[70vh] min-h-[420px] overflow-y-auto rounded-xl border border-[rgba(148,196,208,0.18)] bg-wall-950 p-3 focus-visible:ring-2 focus-visible:ring-brand/60 focus-visible:outline-none"
      >
        {/* LTR for the same reason as each canvas: pages are PDF drawings, not page text. */}
        <div ref={pagesRef} dir="ltr" className="space-y-3" />

        {status === "loading" && (
          <div className="flex min-h-[360px] flex-col items-center justify-center gap-3 text-ash">
            <Loader2 className="size-5 animate-spin" />
            <p className="text-[11px]">{t("rulebook.loading")}</p>
          </div>
        )}
      </div>

      <p className="mt-3 flex items-start gap-1.5 text-[11px] leading-relaxed text-ash/80">
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
}

interface PdfDocument {
  numPages: number;
  getPage(number: number): Promise<PdfPage>;
  destroy(): Promise<void>;
}

interface PdfJsModule {
  GlobalWorkerOptions: { workerSrc: string };
  getDocument(params: { url: string; isEvalSupported?: boolean }): {
    promise: Promise<PdfDocument>;
  };
}
