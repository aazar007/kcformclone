/**
 * Preparing a game logo in the browser.
 *
 * The organisers upload whatever image they have — a logo exported at whatever
 * size, a screenshot, a picture with a patterned backdrop — and this turns it
 * into the one thing the server accepts: a 512×512 PNG with a transparent
 * background wherever the artwork does not reach.
 *
 * Doing the work here rather than on the server is a deliberate choice:
 *
 * - Background removal needs an image-segmentation model. Running it in the
 *   browser means the model is downloaded once by the one person who uploads
 *   logos, instead of being bundled into the deployment — which matters because
 *   this app is deployed to Vercel, where a serverless function has a hard size
 *   limit and a cold start to pay.
 * - Resizing on a canvas is a few lines, where on the server it would mean a
 *   native image library.
 *
 * The server still enforces 512×512 and a real image format. This module is a
 * convenience, not a guarantee.
 */

import { ACCEPTED_IMAGE_TYPES, LOGO_SIZE } from "./image";

/** The one size every logo is normalised to. */
export const LOGO_CANVAS_SIZE = LOGO_SIZE;

/**
 * Model used for segmentation.
 *
 * `isnet_fp16` is the full-quality network at half precision: visually
 * indistinguishable from `isnet` on logo art, for roughly half the download.
 * `isnet_quint8` is smaller again but visibly coarser around thin edges, which
 * is exactly where game logos live.
 */
const MODEL = "isnet_fp16" as const;

/** Give up rather than leave the organiser staring at a spinner. */
const REMOVAL_TIMEOUT_MS = 120_000;

export class LogoPreparationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LogoPreparationError";
  }
}

export interface PreparedLogo {
  /** A 512×512 PNG, ready to upload. */
  blob: Blob;
  /** The size of the image the organiser chose. */
  sourceWidth: number;
  sourceHeight: number;
  /** True when the source already had transparency, so removal was skipped. */
  alreadyTransparent: boolean;
  /** True when a background was found and removed. */
  removedBackground: boolean;
  /** Why removal did not happen, when it was attempted and failed. */
  removalError?: string;
}

/* -------------------------------------------------------------------------- */
/* Decoding                                                                   */
/* -------------------------------------------------------------------------- */

type Source = ImageBitmap | HTMLImageElement;

function isBitmap(source: Source): source is ImageBitmap {
  return typeof ImageBitmap !== "undefined" && source instanceof ImageBitmap;
}

function sizeOf(source: Source) {
  return isBitmap(source)
    ? { width: source.width, height: source.height }
    : { width: source.naturalWidth, height: source.naturalHeight };
}

/**
 * Decode a blob into something drawable.
 *
 * `createImageBitmap` is preferred because it never touches the DOM, but it is
 * absent on some older browsers and refuses a few formats the `<img>` element
 * happily renders — so it falls back rather than giving up.
 */
async function loadSource(blob: Blob): Promise<{ source: Source; release: () => void }> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(blob);
      return { source: bitmap, release: () => bitmap.close() };
    } catch {
      // Fall through to the element-based path.
    }
  }

  const url = URL.createObjectURL(blob);
  const image = new Image();
  image.decoding = "async";

  try {
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new LogoPreparationError("That file is not an image the browser can read."));
      image.src = url;
    });
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }

  return { source: image, release: () => URL.revokeObjectURL(url) };
}

/* -------------------------------------------------------------------------- */
/* Analysis and drawing                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Whether the image already has transparency.
 *
 * Sampled at a reduced size: this only needs to answer "does this artwork bring
 * its own background?", and scaling to 64×64 makes a full pixel scan cheap. Any
 * translucent pixel means the designer already cut the background out, so
 * running segmentation over it would at best be wasted work and at worst erode
 * fine edges.
 */
function hasTransparency(source: Source): boolean {
  const probe = 64;
  const canvas = document.createElement("canvas");
  canvas.width = probe;
  canvas.height = probe;

  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return false;

  context.clearRect(0, 0, probe, probe);
  try {
    context.drawImage(source as CanvasImageSource, 0, 0, probe, probe);
  } catch {
    return false;
  }

  const { data } = context.getImageData(0, 0, probe, probe);
  for (let index = 3; index < data.length; index += 4) {
    if (data[index] < 250) return true;
  }
  return false;
}

/**
 * Draw the artwork centred on a transparent square, scaled to fit.
 *
 * Fitting (`contain`) rather than filling (`cover`): a logo must never be
 * cropped, so any spare space becomes transparency instead.
 */
function drawContained(source: Source, size: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;

  const context = canvas.getContext("2d");
  if (!context) throw new LogoPreparationError("This browser cannot prepare images.");

  context.clearRect(0, 0, size, size);

  const { width, height } = sizeOf(source);
  if (!width || !height) throw new LogoPreparationError("That image appears to be empty.");

  const scale = Math.min(size / width, size / height);
  const targetWidth = Math.max(1, Math.round(width * scale));
  const targetHeight = Math.max(1, Math.round(height * scale));

  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(
    source as CanvasImageSource,
    Math.round((size - targetWidth) / 2),
    Math.round((size - targetHeight) / 2),
    targetWidth,
    targetHeight,
  );

  return canvas;
}

function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new LogoPreparationError("The browser could not convert that image."));
      },
      "image/png",
      1,
    );
  });
}

/* -------------------------------------------------------------------------- */
/* Background removal                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Load the segmentation model and cut the background out.
 *
 * Imported dynamically so the model and its runtime never enter the main admin
 * bundle — an organiser who is not uploading a logo should not download any of
 * it. The package also touches browser globals at load time, which is another
 * reason it must not be reached during a server render.
 */
async function removeBackground(
  file: File,
  onProgress?: (fraction: number, note: string) => void,
): Promise<Blob> {
  const module = await import("@imgly/background-removal");

  const work = module.removeBackground(file, {
    model: MODEL,
    // Transparency is the whole point, so the output must be PNG.
    output: { format: "image/png" },
    progress: (_key, current, total) => {
      if (total > 0) onProgress?.(current / total, "Removing background");
    },
  });

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new LogoPreparationError("Background removal took too long.")),
      REMOVAL_TIMEOUT_MS,
    );
  });

  try {
    return await Promise.race([work, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/* -------------------------------------------------------------------------- */
/* Entry point                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Turn any image the organiser picked into a 512×512 transparent PNG.
 *
 * Never throws for a merely *awkward* image: if segmentation cannot run — no
 * network for the model, an old browser, a timeout — the original artwork is
 * resized and uploaded instead, and `removalError` explains what was skipped.
 * Only genuinely unusable files (a PDF, a corrupt download) throw.
 */
export async function prepareLogo(
  file: File,
  options: { onProgress?: (fraction: number, note: string) => void } = {},
): Promise<PreparedLogo> {
  const { onProgress } = options;

  if (!file.type.startsWith("image/")) {
    throw new LogoPreparationError(
      `That file is ${file.type || "not an image"}. Upload ${ACCEPTED_IMAGE_TYPES.map((type) => type.replace("image/", "")).join(", ")}.`,
    );
  }

  onProgress?.(0.05, "Reading the image");
  const { source, release } = await loadSource(file);

  try {
    const { width: sourceWidth, height: sourceHeight } = sizeOf(source);
    const alreadyTransparent = hasTransparency(source);

    let artwork: Source = source;
    let releaseArtwork: (() => void) | undefined;
    let removedBackground = false;
    let removalError: string | undefined;

    if (alreadyTransparent) {
      onProgress?.(0.6, "Logo already has no background");
    } else {
      onProgress?.(0.15, "Loading the background remover");
      try {
        const cut = await removeBackground(file, onProgress);
        const decoded = await loadSource(cut);
        artwork = decoded.source;
        releaseArtwork = decoded.release;
        removedBackground = true;
        onProgress?.(0.8, "Background removed");
      } catch (error) {
        removalError = error instanceof Error ? error.message : String(error);
        // Keep going: a resized original still beats no logo at all.
        onProgress?.(0.8, "Using the original image");
      }
    }

    try {
      onProgress?.(0.9, "Fitting to 512×512");
      const canvas = drawContained(artwork, LOGO_SIZE);
      const blob = await canvasToPng(canvas);

      return {
        blob,
        sourceWidth,
        sourceHeight,
        alreadyTransparent,
        removedBackground,
        removalError,
      };
    } finally {
      releaseArtwork?.();
    }
  } finally {
    release();
  }
}
