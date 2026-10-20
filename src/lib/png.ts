/**
 * A minimal PNG decoder/encoder, plus a box-filter downscale.
 *
 * It exists for one reason: the confirmation email embeds the brand mark as an
 * inline (`cid:`) attachment, and the source file is ~154 kB. Base64 inflates
 * that by a third, so the message was ~224 kB — past Gmail's **102 kB clipping
 * threshold**, after which the rest of the message is replaced with
 * "[Message clipped]". A message that is 92% base64 payload is also a poor signal
 * to spam filters, which weigh text-to-image ratio.
 *
 * The fix is to send a smaller image, and doing it here keeps it automatic: swap
 * the brand mark and the email shrinks it without anyone having to remember to
 * export a second file. There is no image library in the project and this needs
 * exactly one operation on one known kind of file, so pulling in a native
 * dependency would cost more than it saves.
 *
 * Scope is deliberately narrow — 8-bit, non-interlaced, RGB or RGBA. Anything
 * else is refused so the caller can fall back to the original bytes rather than
 * corrupting them.
 */

import { deflateSync, inflateSync } from "node:zlib";

export interface RasterImage {
  width: number;
  height: number;
  /** RGBA, 4 bytes per pixel, row-major. */
  pixels: Buffer;
}

/* -------------------------------------------------------------------------- */
/* Decoding                                                                   */
/* -------------------------------------------------------------------------- */

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

interface Chunk {
  type: string;
  data: Buffer;
}

function* chunks(bytes: Buffer): Generator<Chunk> {
  let offset = SIGNATURE.length;
  while (offset + 8 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    const start = offset + 8;
    if (start + length > bytes.length) return;
    yield { type, data: bytes.subarray(start, start + length) };
    // 4 length + 4 type + data + 4 CRC.
    offset = start + length + 4;
  }
}

/** Reverse the per-scanline filter PNG applies before compression. */
function unfilter(raw: Buffer, width: number, height: number, bpp: number): Buffer {
  const stride = width * bpp;
  const out = Buffer.alloc(height * stride);

  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);

    for (let x = 0; x < stride; x += 1) {
      const current = line[x];
      // Bytes to the left, above, and above-left, already reconstructed.
      const left = x >= bpp ? out[y * stride + x - bpp] : 0;
      const up = y > 0 ? out[(y - 1) * stride + x] : 0;
      const upLeft = y > 0 && x >= bpp ? out[(y - 1) * stride + x - bpp] : 0;

      let value: number;
      switch (filter) {
        case 0:
          value = current;
          break;
        case 1:
          value = current + left;
          break;
        case 2:
          value = current + up;
          break;
        case 3:
          value = current + ((left + up) >> 1);
          break;
        case 4: {
          // Paeth predictor.
          const estimate = left + up - upLeft;
          const dl = Math.abs(estimate - left);
          const du = Math.abs(estimate - up);
          const dul = Math.abs(estimate - upLeft);
          value = current + (dl <= du && dl <= dul ? left : du <= dul ? up : upLeft);
          break;
        }
        default:
          return out; // Unknown filter: refuse rather than decode garbage.
      }
      out[y * stride + x] = value & 0xff;
    }
  }

  return out;
}

/**
 * Decode a PNG to RGBA.
 *
 * Returns `null` for anything outside the supported subset — an interlaced,
 * palette-based or 16-bit file is left to the caller to pass through untouched.
 */
export function decodePng(bytes: Buffer): RasterImage | null {
  if (bytes.length < 8 || !bytes.subarray(0, 8).equals(SIGNATURE)) return null;

  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  const idat: Buffer[] = [];

  for (const chunk of chunks(bytes)) {
    if (chunk.type === "IHDR") {
      if (chunk.data.length < 13) return null;
      width = chunk.data.readUInt32BE(0);
      height = chunk.data.readUInt32BE(4);
      bitDepth = chunk.data[8];
      colorType = chunk.data[9];
      interlace = chunk.data[12];
    } else if (chunk.type === "IDAT") {
      idat.push(chunk.data);
    } else if (chunk.type === "IEND") {
      break;
    }
  }

  if (bitDepth !== 8 || interlace !== 0) return null;
  if (colorType !== 2 && colorType !== 6) return null;
  if (!width || !height) return null;

  let raw: Buffer;
  try {
    raw = inflateSync(Buffer.concat(idat));
  } catch {
    return null;
  }

  const channels = colorType === 6 ? 4 : 3;
  const expected = height * (1 + width * channels);
  if (raw.length < expected) return null;

  const flat = unfilter(raw, width, height, channels);
  const pixels = Buffer.alloc(width * height * 4);

  for (let i = 0, p = 0; i < width * height; i += 1, p += channels) {
    pixels[i * 4] = flat[p];
    pixels[i * 4 + 1] = flat[p + 1];
    pixels[i * 4 + 2] = flat[p + 2];
    pixels[i * 4 + 3] = channels === 4 ? flat[p + 3] : 255;
  }

  return { width, height, pixels };
}

/* -------------------------------------------------------------------------- */
/* Encoding                                                                   */
/* -------------------------------------------------------------------------- */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer: Buffer): number {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typed = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typed, data])));
  return Buffer.concat([length, typed, data, crc]);
}

/** Encode RGBA as an 8-bit truecolour-with-alpha PNG. */
export function encodePng(image: RasterImage): Buffer {
  const { width, height, pixels } = image;
  const stride = width * 4;

  // One filter byte per row. Filter 0 (none) keeps this simple, and the deflate
  // level below recovers most of what a smarter filter would have saved.
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    pixels.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // no interlace

  return Buffer.concat([
    SIGNATURE,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/* -------------------------------------------------------------------------- */
/* Resizing                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Downscale by averaging each source region ("box filter").
 *
 * Averaging rather than nearest-neighbour sampling matters here: the mark is
 * line art with fine chrome highlights, and dropping pixels would make it
 * speckle. Averaging also smooths the source's compression noise, which is what
 * makes the resized file compress so much better than the original.
 */
export function downscale(image: RasterImage, targetWidth: number): RasterImage {
  const ratio = targetWidth / image.width;
  const width = Math.max(1, Math.round(targetWidth));
  const height = Math.max(1, Math.round(image.height * ratio));
  const out = Buffer.alloc(width * height * 4);

  for (let y = 0; y < height; y += 1) {
    const sourceY0 = Math.floor((y * image.height) / height);
    const sourceY1 = Math.max(sourceY0 + 1, Math.floor(((y + 1) * image.height) / height));

    for (let x = 0; x < width; x += 1) {
      const sourceX0 = Math.floor((x * image.width) / width);
      const sourceX1 = Math.max(sourceX0 + 1, Math.floor(((x + 1) * image.width) / width));

      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let count = 0;

      for (let sy = sourceY0; sy < sourceY1; sy += 1) {
        for (let sx = sourceX0; sx < sourceX1; sx += 1) {
          const i = (sy * image.width + sx) * 4;
          const alpha = image.pixels[i + 3];
          /* Weight colour by alpha so fully transparent pixels — which may hold
             any colour at all — cannot tint the edges of the artwork. */
          r += image.pixels[i] * alpha;
          g += image.pixels[i + 1] * alpha;
          b += image.pixels[i + 2] * alpha;
          a += alpha;
          count += 1;
        }
      }

      const target = (y * width + x) * 4;
      if (a > 0) {
        out[target] = Math.round(r / a);
        out[target + 1] = Math.round(g / a);
        out[target + 2] = Math.round(b / a);
        out[target + 3] = Math.round(a / count);
      }
    }
  }

  return { width, height, pixels: out };
}

/**
 * Shrink a PNG so its encoded size drops below `maxBytes`.
 *
 * Walks down a ladder of widths and stops at the first result that fits, so the
 * image stays as large as the budget allows instead of being guessed at. Falls
 * back to the original bytes when the file cannot be decoded or when even the
 * smallest attempt is bigger than what we started with.
 */
export function shrinkPng(bytes: Buffer, maxBytes: number): Buffer {
  if (bytes.byteLength <= maxBytes) return bytes;

  const decoded = decodePng(bytes);
  if (!decoded) return bytes;

  let best: Buffer | null = null;

  for (const width of [420, 360, 300, 260, 220, 180, 150]) {
    if (width >= decoded.width) continue;
    const candidate = encodePng(downscale(decoded, width));
    if (candidate.byteLength <= maxBytes) return candidate;
    // Keep the smallest attempt in case none of them fit.
    if (!best || candidate.byteLength < best.byteLength) best = candidate;
  }

  if (!best) return bytes;
  return best.byteLength < bytes.byteLength ? best : bytes;
}
