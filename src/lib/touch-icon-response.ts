import { TOUCH_ICON_OPAQUE, TOUCH_ICON_TRANSPARENT } from "./touch-icons";

/** Browsers other than Safari. Anything unrecognised is treated as Safari on purpose: Safari's
 *  own icon fetcher does not always send a normal browser User-Agent, and it is the one case
 *  that must never get the transparent file. */
const NOT_SAFARI = /CriOS|FxiOS|EdgiOS|OPiOS|Chrome|Chromium|Firefox|Edg\/|OPR\/|Android/i;

function decode(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function touchIconResponse(request: Request): Response {
  const transparent = NOT_SAFARI.test(request.headers.get("user-agent") ?? "");
  return new Response(decode(transparent ? TOUCH_ICON_TRANSPARENT : TOUCH_ICON_OPAQUE), {
    headers: {
      "content-type": "image/png",
      /* Private: the answer depends on the browser, and a shared cache keyed on the URL alone
         would hand one browser's file to another. */
      "cache-control": "private, max-age=3600",
      vary: "User-Agent",
    },
  });
}
