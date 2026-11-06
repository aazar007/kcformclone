import { after } from "next/server";

/**
 * Run work once the response has been sent.
 *
 * Email is the slowest thing a registration does, and none of it changes what the
 * captain is told: the team is stored, and the reference code is already on
 * screen. Holding the response open for an SMTP round trip made the submit button
 * hang, and — because every message was sent one after another — pushed each
 * member's confirmation link further back in the queue as the roster grew.
 *
 * `after()` flushes the response first and then finishes the sends within the same
 * request, which is what serverless runtimes require: a bare floating promise can
 * be frozen the moment the response is returned. If the runtime cannot defer
 * (no `waitUntil`), the work is awaited inline instead, so a missing capability
 * costs speed rather than the messages.
 */
export async function runAfterResponse(task: () => Promise<unknown>): Promise<void> {
  try {
    after(async () => {
      await task();
    });
  } catch {
    await task();
  }
}
