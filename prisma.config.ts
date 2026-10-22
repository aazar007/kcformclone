import "dotenv/config";
import { definePrismaConfig } from "prisma/config";
import { defineConfig as ormConfig, prisma7Schema } from "@prisma/orm-postgres/config";
import { defineConfig as composer } from "@prisma/composer/config";
import { nextjsBuild } from "@prisma/composer/nextjs/control";
import { nodeBuild } from "@prisma/composer/node/control";
import { prismaCloud, prismaState } from "@prisma/composer-prisma-cloud/control";

// Prisma 8 CLI config (`prisma ...`). The data contract is read straight from
// the existing prisma/schema.prisma, so there is a single schema file while
// Prisma 7 (`npm run prisma7 -- ...`) still generates the runtime client.
export default definePrismaConfig({
  orm: ormConfig({
    contract: prisma7Schema("prisma/schema.prisma"),
    // Emitted contract.json / contract.d.ts (gitignored via `generated/`).
    output: "generated/prisma8",
    db: {
      // `contract emit` never connects, so this may be unset during builds.
      connection: process.env["DIRECT_URL"] ?? process.env["DATABASE_URL"],
    },
  }),
  composer: composer({
    extensions: [prismaCloud({ region: "ap-southeast-1" }), nodeBuild(), nextjsBuild()],
    state: prismaState(),
  }),
});
