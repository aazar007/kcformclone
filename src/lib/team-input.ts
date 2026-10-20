/**
 * The one place a validated payload becomes a database write.
 *
 * Both the create endpoint and the edit endpoint funnel through here so a team
 * created and a team edited are stored identically — in particular, both get the
 * same normalised team name and the same `teamNameKey` that uniqueness is built
 * on.
 */

import type { RegistrationPayload } from "./validation";
import { teamNameKey } from "./team-name";
import type { TeamInput } from "./store";

export function toTeamInput(data: RegistrationPayload): TeamInput {
  return {
    tournamentName: data.tournamentName,
    teamName: data.teamName,
    teamNameKey: teamNameKey(data.teamName),
    gender: data.gender,
    gameId: data.gameId,
    gameName: data.gameName,
    leaderIndex: data.leaderIndex,
    // Stamped here rather than in the route so a team created and a team edited
    // record consent the same way. Validation has already rejected any payload
    // without consent, so reaching this line means the box was ticked.
    consentedAt: data.consentGiven ? new Date() : null,
    members: data.members.map((member) => ({
      fullName: member.fullName,
      gameTag: member.gameTag,
      universityId: member.universityId,
      universityName: member.universityName,
      universityRegion: member.universityRegion,
      email: member.email,
      studentId: member.studentId,
      discord: member.discord,
      phone: member.phone,
      role: member.role,
      requirements: member.requirements,
    })),
  };
}
