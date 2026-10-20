/**
 * Reading image dimensions without an image library.
 *
 * Game logos must be exactly 512×512, and the check has to happen on the server
 * where the bytes are. Rather than pull in a native image pipeline just to read
 * two integers, this parses the handful of formats' headers directly.
 *
 * Only formats whose declared size can be trusted are accepted. SVG is
 * deliberately absent: it is a script-bearing document, and its `width`/`height`
 * attributes say nothing about what it renders as.
 */

export type ImageKind = "png" | "jpeg" | "webp" | "gif";

export interface ImageSize {
  width: number;
  height: number;
  kind: ImageKind;
  mimeType: string;
}

const MIME: Record<ImageKind, string> = {
  png: "image/png",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
};

function isPng(bytes: Buffer) {
  return (
    bytes.length >= 24 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  );
}

function isGif(bytes: Buffer) {
  return bytes.length >= 10 && bytes.toString("ascii", 0, 3) === "GIF";
}

function isWebp(bytes: Buffer) {
  return (
    bytes.length >= 30 &&
    bytes.toString("ascii", 0, 4) === "RIFF" &&
    bytes.toString("ascii", 8, 12) === "WEBP"
  );
}

function isJpeg(bytes: Buffer) {
  return bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8;
}

/* ------------------------------------------------------------------ */
/* Per-format readers                                                  */
/* ------------------------------------------------------------------ */

/** IHDR always follows the 8-byte signature and a fixed 8-byte chunk header. */
function pngSize(bytes: Buffer): ImageSize | null {
  if (!isPng(bytes)) return null;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), kind: "png", mimeType: MIME.png };
}

function gifSize(bytes: Buffer): ImageSize | null {
  if (!isGif(bytes)) return null;
  return {
    width: bytes.readUInt16LE(6),
    height: bytes.readUInt16LE(8),
    kind: "gif",
    mimeType: MIME.gif,
  };
}

/**
 * Walk the JPEG segment chain looking for a Start-Of-Frame marker, which is the
 * only place the true dimensions appear. Standalone markers carry no length.
 */
function jpegSize(bytes: Buffer): ImageSize | null {
  if (!isJpeg(bytes)) return null;

  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }

    const marker = bytes[offset + 1];

    // Padding and standalone markers: no payload to skip.
    if (marker === 0xff || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
      offset += 2;
      continue;
    }

    const length = bytes.readUInt16BE(offset + 2);
    if (length < 2) return null;

    // SOF0–SOF15, excluding DHT (c4), JPG (c8) and DAC (cc).
    const isFrame =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;

    if (isFrame) {
      return {
        height: bytes.readUInt16BE(offset + 5),
        width: bytes.readUInt16BE(offset + 7),
        kind: "jpeg",
        mimeType: MIME.jpeg,
      };
    }

    offset += 2 + length;
  }

  return null;
}

/** VP8 (lossy), VP8L (lossless) and VP8X (extended) each store size differently. */
function webpSize(bytes: Buffer): ImageSize | null {
  if (!isWebp(bytes)) return null;

  const format = bytes.toString("ascii", 12, 16);

  if (format === "VP8X") {
    const width = 1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16));
    const height = 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16));
    return { width, height, kind: "webp", mimeType: MIME.webp };
  }

  if (format === "VP8 ") {
    return {
      width: bytes.readUInt16LE(26) & 0x3fff,
      height: bytes.readUInt16LE(28) & 0x3fff,
      kind: "webp",
      mimeType: MIME.webp,
    };
  }

  if (format === "VP8L") {
    if (bytes[20] !== 0x2f) return null;
    const bits = bytes.readUInt32LE(21);
    return {
      width: (bits & 0x3fff) + 1,
      height: ((bits >> 14) & 0x3fff) + 1,
      kind: "webp",
      mimeType: MIME.webp,
    };
  }

  return null;
}

/**
 * The dimensions an image declares, or `null` when the bytes are not a format
 * this app will store.
 */
export function readImageSize(bytes: Buffer): ImageSize | null {
  return pngSize(bytes) ?? jpegSize(bytes) ?? webpSize(bytes) ?? gifSize(bytes);
}

export const ACCEPTED_IMAGE_TYPES = Object.values(MIME);

/** The exact square organisers must upload. */
export const LOGO_SIZE = 512;

/** Largest upload accepted, before any parsing. */
export const LOGO_MAX_BYTES = 3 * 1024 * 1024;
