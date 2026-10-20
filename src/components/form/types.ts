import type { TournamentConfig } from "@/lib/tournament";
import type { RulebookVersions } from "@/lib/store";
import type { MemberDraft, RegistrationDraft } from "@/lib/validation";
import type { DuplicateWatch } from "./use-duplicate-watch";

export interface StepProps {
  config: TournamentConfig;
  /**
   * Game ids that have a logo, mapped to a cache-busting version. Absent means no
   * logo, so the card renders no `<img>` rather than a broken one.
   */
  logoVersions: Record<string, number>;
  draft: RegistrationDraft;
  /**
   * Live answers to "is this name, email or student ID already registered?".
   *
   * Owned by the wizard rather than by the step, because one debounced request
   * covers the whole draft — letting each field ask for itself would multiply the
   * traffic by the size of the roster and hammer the rate limit.
   */
  duplicates: DuplicateWatch;
  update: <K extends keyof RegistrationDraft>(key: K, value: RegistrationDraft[K]) => void;
  /** Patch one roster slot. */
  setMember: (index: number, patch: Partial<MemberDraft>) => void;
  /** Answer one organiser-defined requirement for one member. */
  setRequirement: (index: number, requirementId: string, value: string) => void;
  errors: Record<string, string>;
  warnings: string[];
  goToStep: (step: number) => void;
  /**
   * Whether this step's errors should be shown.
   *
   * True once the captain has tried to move on from this step and failed. For the
   * review step that attempt is the submit press, so a checkbox the captain has not
   * been asked about yet is not painted red the moment they arrive — it waits until
   * they actually press "Complete registration" and the form has to say what is
   * missing.
   */
  revealed: boolean;
  /**
   * Which games have a rulebook, keyed by game id, so the review step can point its
   * acknowledgement at the document for the game the team actually entered.
   */
  rulebooks: RulebookVersions;
  /** Which games' rulebooks have been read to the end this session — the tick's unlock. */
  gamesRead?: ReadonlySet<string>;
  /** Open the rulebook tab at a given game. */
  onOpenRulebook?: (gameId: string) => void;
}
