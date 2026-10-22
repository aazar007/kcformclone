// @ts-check
import nextjs from "@prisma/composer/nextjs";
import { compute } from "@prisma/composer-prisma-cloud";
import { postgres, dataContract } from "@prisma/composer-prisma-cloud/orm";
import ksuCrownContractJson from "./generated/prisma8/contract.json" with { type: "json" };

export default compute({
  name: "ksu-crown-registration",
  deps: { db: postgres(dataContract(ksuCrownContractJson)) },
  build: nextjs({ module: import.meta.url, appDir: "." }),
});
