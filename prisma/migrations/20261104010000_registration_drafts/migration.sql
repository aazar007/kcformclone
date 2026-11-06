-- A registration in progress: teammates complete their own details before the
-- captain submits, so their answers need somewhere to live without a Team row.
CREATE TABLE "Draft" (
    "id" TEXT NOT NULL,
    "secretHash" TEXT NOT NULL,
    "teamName" TEXT NOT NULL,
    "tournamentName" TEXT NOT NULL,
    "gameName" TEXT NOT NULL,
    "gender" TEXT NOT NULL,
    "leaderIndex" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Draft_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Draft_secretHash_key" ON "Draft"("secretHash");
CREATE INDEX "Draft_createdAt_idx" ON "Draft"("createdAt");
CREATE INDEX "Draft_updatedAt_idx" ON "Draft"("updatedAt");

CREATE TABLE "DraftMember" (
    "id" TEXT NOT NULL,
    "draftId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'STARTER',
    "universityId" TEXT NOT NULL,
    "universityName" TEXT NOT NULL,
    "universityRegion" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "fullName" TEXT NOT NULL DEFAULT '',
    "gameTag" TEXT NOT NULL DEFAULT '',
    "studentId" TEXT,
    "discord" TEXT NOT NULL DEFAULT '',
    "phone" TEXT NOT NULL DEFAULT '',
    "requirements" JSONB NOT NULL DEFAULT '[]',
    "profileCompletedAt" TIMESTAMP(3),
    "confirmTokenHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DraftMember_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DraftMember_draftId_position_key" ON "DraftMember"("draftId", "position");
CREATE INDEX "DraftMember_draftId_idx" ON "DraftMember"("draftId");
CREATE UNIQUE INDEX "DraftMember_confirmTokenHash_key" ON "DraftMember"("confirmTokenHash");

ALTER TABLE "DraftMember" ADD CONSTRAINT "DraftMember_draftId_fkey"
    FOREIGN KEY ("draftId") REFERENCES "Draft"("id") ON DELETE CASCADE ON UPDATE CASCADE;
