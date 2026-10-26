import { touchIconResponse } from "@/lib/touch-icon-response";

export const dynamic = "force-dynamic";

export function GET(request: Request) {
  return touchIconResponse(request);
}
