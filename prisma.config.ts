import { config as loadEnv } from 'dotenv';
import { definePrismaConfig } from 'prisma/config';
import { defineConfig as ormConfig, prisma7Schema } from '@prisma/orm-postgres/config';

loadEnv({ path: '.env' });

export default definePrismaConfig({
  orm: ormConfig({
    contract: prisma7Schema('prisma/schema.prisma'),
    output: 'generated/prisma8',
    db: { connection: process.env['DIRECT_URL'] ?? process.env['DATABASE_URL'] },
  }),
});
