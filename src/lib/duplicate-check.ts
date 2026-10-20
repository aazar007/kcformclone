/**
 * The duplicate-check contract, shared by the endpoint and the form.
 *
 * Kept out of the route file so the client can import the shape without pulling
 * in a server module — and so both sides read the same definition when one of
 * them changes.
 */

export interface DuplicateCheckResponse {
  teamName: { taken: boolean; label: string | null };
  members: { field: "email" | "studentId"; value: string; taken: boolean }[];
}

/**
 * Ask the server whether these values are already registered.
 *
 * Never throws: a live check is a courtesy, and a dead network must not stop the
 * captain from submitting, where the real collision check runs anyway. A failure
 * resolves to `null`, which the caller reads as "no answer" rather than "free".
 */
export async function checkDuplicates(
  input: {
    teamName?: string;
    emails?: string[];
    studentIds?: string[];
    /**
     * The reference of the team being edited, when there is one.
     *
     * Without it a captain reopening their own registration is told their own
     * team name and their own members' addresses are taken — the live check is
     * indistinguishable from a stranger retyping them. The reference is what
     * lets the server exclude the team it belongs to.
     */
    reference?: string;
    /** Signed proof that the caller may edit `reference`; without it the reference is ignored. */
    editProof?: string;
    /** Signed email proofs, by lower-case address; only proven emails get an answer. */
    emailProofs?: Record<string, string>;
  },
  signal?: AbortSignal,
): Promise<DuplicateCheckResponse | null> {
  try {
    const response = await fetch("/api/registrations/check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
      signal,
    });
    if (!response.ok) return null;
    return (await response.json()) as DuplicateCheckResponse;
  } catch {
    return null;
  }
}
