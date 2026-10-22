// @ts-check
import { module } from "@prisma/composer";
import { postgres, dataContract } from "@prisma/composer-prisma-cloud/orm";
import ksuCrownContractJson from "./generated/prisma8/contract.json" with { type: "json" };
import ksuCrownService from "./service.mjs";

export default module("dkcform", ({ provision }) => {
  const database = provision(postgres({ name: "database", contract: dataContract(ksuCrownContractJson), config: "./prisma.config.ts" }));
  provision(ksuCrownService, { id: "ksucrown", deps: { db: database } });
});
