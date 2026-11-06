import type { Metadata } from "next";
import { DEFAULT_LANGUAGE, isLanguage, type Language } from "@/lib/i18n";
import { lookupMemberCompletion } from "@/lib/member-confirm";
import { loadConfig } from "@/lib/config-store";
import type { CompletionView } from "@/lib/member-confirm";
import { universityById, type RequirementDefinition } from "@/lib/tournament";
import { studentIdFromEmail } from "@/lib/validation";
import { ConfirmEmailPanel } from "@/components/confirm/confirm-email-panel";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Complete your details · KSU Crown",
  robots: { index: false, follow: false },
};

/**
 * The page a member lands on after pressing the button in their email.
 *
 * The captain enters only a teammate's university and address, so this is where
 * the player completes their own name, in-game tag, student number and contacts.
 *
 * **Opening the page changes nothing.** It looks up which member the token
 * belongs to and renders their form; the save is a POST. That keeps a
 * link-following mail filter from completing — or confirming — a profile nobody
 * submitted.
 */
export default async function ConfirmEmailPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const token = typeof params.token === "string" ? params.token : "";
  const language: Language = isLanguage(params.lang) ? params.lang : DEFAULT_LANGUAGE;

  let member: CompletionView | null = null;
  let suggestedStudentId: string | null = null;
  if (token) {
    try {
      member = await lookupMemberCompletion(token);
    } catch (error) {
      console.error("[confirm-email]", error);
    }
  }

  /* The questions the organisers define now, not the ones stored on the row: a
     requirement added after the team registered still has to be answered. A
     database outage must not stop the page rendering; the form then asks nothing
     beyond the built-in fields, and the API re-checks every answer anyway. */
  let requirements: RequirementDefinition[] = [];
  try {
    const { config } = await loadConfig();
    requirements = config.requirements;

    /* Most institutions issue `<number>@<domain>`, so the student number can be
       read back out of the address the captain already entered. Offered as the
       field's initial value rather than saved: the player confirms it, and the
       reader refuses to guess when the format does not match. */
    if (member) {
      const university = universityById(config, member.universityId);
      if (university) suggestedStudentId = studentIdFromEmail(member.email, university);
    }
  } catch {
    requirements = [];
  }

  return (
    <main
      dir={language === "ar" ? "rtl" : "ltr"}
      className="relative flex min-h-screen items-center justify-center px-4 py-12"
    >
      <div className="panel w-full max-w-lg rounded-3xl p-7 sm:p-9">
        <ConfirmEmailPanel
          token={token}
          language={language}
          initial={member}
          requirements={requirements}
          suggestedStudentId={suggestedStudentId}
        />
      </div>
    </main>
  );
}
