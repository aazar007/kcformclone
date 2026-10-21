#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/2c5a1956cfb4129c981639fe078e9f1ab480df9c9d2c5bab739198da6e7b4c41/contract';
import endContract from '../../snapshots/2c5a1956cfb4129c981639fe078e9f1ab480df9c9d2c5bab739198da6e7b4c41/contract.json' with { type: 'json' };
import {
  Migration,
  MigrationCLI,
  col,
  fn,
  lit,
  primaryKey,
  sql,
} from '@prisma/orm-postgres/migration';

export default class M extends Migration<never, End> {
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createSchema({ schema: 'public' }),
      this.createTable({
        schema: 'public',
        table: 'AdminCredential',
        columns: [
          col('id', 'text', {
            notNull: true,
            default: lit('owner'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('passwordHash', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamp(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamp-string@1', typeParams: { precision: 3 } },
          }),
          col('updatedVia', 'text', {
            notNull: true,
            default: lit('console'),
            codecRef: { codecId: 'pg/text@1' },
          }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'Config',
        columns: [
          col('data', 'jsonb', { notNull: true, codecRef: { codecId: 'pg/jsonb@1' } }),
          col('id', 'int4', { notNull: true, default: lit(1), codecRef: { codecId: 'pg/int4@1' } }),
          col('updatedAt', 'timestamp(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamp-string@1', typeParams: { precision: 3 } },
          }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'GameLogo',
        columns: [
          col('bytes', 'bytea', { notNull: true, codecRef: { codecId: 'pg/bytea@1' } }),
          col('gameId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('height', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('mimeType', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('size', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('updatedAt', 'timestamp(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamp-string@1', typeParams: { precision: 3 } },
          }),
          col('width', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
        ],
        constraints: [primaryKey(['gameId'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'Member',
        columns: [
          col('createdAt', 'timestamp(3)', {
            notNull: true,
            default: fn(sql`now()`),
            codecRef: { codecId: 'pg/timestamp-string@1', typeParams: { precision: 3 } },
          }),
          col('discord', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('email', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('fullName', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('gameTag', 'text', {
            notNull: true,
            default: lit(''),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('phone', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('position', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('requirements', 'jsonb', {
            notNull: true,
            default: lit([]),
            codecRef: { codecId: 'pg/jsonb@1' },
          }),
          col('role', 'text', {
            notNull: true,
            default: lit('STARTER'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('studentId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('teamId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('universityId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('universityName', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('universityRegion', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'OtpCode',
        columns: [
          col('attempts', 'int4', {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('codeHash', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('consumedAt', 'timestamp(3)', {
            codecRef: { codecId: 'pg/timestamp-string@1', typeParams: { precision: 3 } },
          }),
          col('createdAt', 'timestamp(3)', {
            notNull: true,
            default: fn(sql`now()`),
            codecRef: { codecId: 'pg/timestamp-string@1', typeParams: { precision: 3 } },
          }),
          col('email', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('expiresAt', 'timestamp(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamp-string@1', typeParams: { precision: 3 } },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('purpose', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'Rulebook',
        columns: [
          col('bytes', 'bytea', { notNull: true, codecRef: { codecId: 'pg/bytea@1' } }),
          col('gameId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('mimeType', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('size', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('title', 'text', {
            notNull: true,
            default: lit(''),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('updatedAt', 'timestamp(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamp-string@1', typeParams: { precision: 3 } },
          }),
        ],
        constraints: [primaryKey(['gameId'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'StaffAccess',
        columns: [
          col('addedAt', 'timestamp(3)', {
            notNull: true,
            default: fn(sql`now()`),
            codecRef: { codecId: 'pg/timestamp-string@1', typeParams: { precision: 3 } },
          }),
          col('email', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('lastLoginAt', 'timestamp(3)', {
            codecRef: { codecId: 'pg/timestamp-string@1', typeParams: { precision: 3 } },
          }),
          col('note', 'text', {
            notNull: true,
            default: lit(''),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('revokedAt', 'timestamp(3)', {
            codecRef: { codecId: 'pg/timestamp-string@1', typeParams: { precision: 3 } },
          }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'Team',
        columns: [
          col('consentedAt', 'timestamp(3)', {
            codecRef: { codecId: 'pg/timestamp-string@1', typeParams: { precision: 3 } },
          }),
          col('createdAt', 'timestamp(3)', {
            notNull: true,
            default: fn(sql`now()`),
            codecRef: { codecId: 'pg/timestamp-string@1', typeParams: { precision: 3 } },
          }),
          col('gameId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('gameName', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('gender', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('leaderIndex', 'int4', {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('reference', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('teamName', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('teamNameKey', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('tournamentName', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamp(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamp-string@1', typeParams: { precision: 3 } },
          }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createIndex({
        schema: 'public',
        table: 'Member',
        index: 'Member_email_key',
        columns: ['email'],
        extras: { unique: true },
      }),
      this.createIndex({
        schema: 'public',
        table: 'Member',
        index: 'Member_studentId_key',
        columns: ['studentId'],
        extras: { unique: true },
      }),
      this.createIndex({
        schema: 'public',
        table: 'Member',
        index: 'Member_teamId_idx',
        columns: ['teamId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'Member',
        index: 'Member_teamId_position_key',
        columns: ['teamId', 'position'],
        extras: { unique: true },
      }),
      this.createIndex({
        schema: 'public',
        table: 'OtpCode',
        index: 'OtpCode_email_purpose_idx',
        columns: ['email', 'purpose'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'OtpCode',
        index: 'OtpCode_expiresAt_idx',
        columns: ['expiresAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'OtpCode',
        index: 'OtpCode_purpose_createdAt_idx',
        columns: ['purpose', 'createdAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'StaffAccess',
        index: 'StaffAccess_email_key',
        columns: ['email'],
        extras: { unique: true },
      }),
      this.createIndex({
        schema: 'public',
        table: 'Team',
        index: 'Team_createdAt_idx',
        columns: ['createdAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'Team',
        index: 'Team_gameId_idx',
        columns: ['gameId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'Team',
        index: 'Team_gender_idx',
        columns: ['gender'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'Team',
        index: 'Team_reference_key',
        columns: ['reference'],
        extras: { unique: true },
      }),
      this.createIndex({
        schema: 'public',
        table: 'Team',
        index: 'Team_teamNameKey_key',
        columns: ['teamNameKey'],
        extras: { unique: true },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'Member',
        foreignKey: {
          name: 'Member_teamId_fkey',
          columns: ['teamId'],
          references: { schema: 'public', table: 'Team', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
