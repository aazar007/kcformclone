import { config as loadEnv } from 'dotenv';
import { definePrismaConfig } from 'prisma/config';
import { defineConfig as ormConfig, prisma7Schema } from '@prisma/orm-postgres/config';
import { defineConfig as composer } from '@prisma/composer/config';
import { nodeBuild } from '@prisma/composer/node/control';
import { prismaCloud, prismaState } from '@prisma/composer-prisma-cloud/control';

loadEnv({ path: '.env' });
loadEnv({ path: '.env.local', override: true });

export default definePrismaConfig({
  orm: ormConfig({
    // keep your existing contract / output / db settings here
  }),
});
