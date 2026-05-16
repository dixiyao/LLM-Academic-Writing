import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";

import { ensureRuntimeDirs } from "@/server/files";
import { serverEnv } from "@/server/env";
import { schema } from "@/server/db/schema";

type DbClient = BetterSQLite3Database<typeof schema>;

type GlobalWithDb = typeof globalThis & {
  aiReviewerSqlite?: Database.Database;
  aiReviewerDb?: DbClient;
};

const globalForDb = globalThis as GlobalWithDb;

function initSchema(sqlite: Database.Database): void {
  sqlite.exec(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS papers (
      id TEXT PRIMARY KEY,
      original_name TEXT NOT NULL,
      stored_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size INTEGER NOT NULL,
      sha256 TEXT NOT NULL,
      local_path TEXT NOT NULL,
      provider TEXT NOT NULL DEFAULT 'gemini',
      provider_file_name TEXT,
      provider_file_uri TEXT,
      provider_mime_type TEXT,
      provider_state TEXT NOT NULL DEFAULT 'not_uploaded',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS papers_sha_idx ON papers (sha256);

    CREATE TABLE IF NOT EXISTS text_index (
      id TEXT PRIMARY KEY,
      paper_id TEXT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
      page_number INTEGER NOT NULL,
      text TEXT NOT NULL,
      raw_text TEXT,
      position TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS text_index_paper_page_idx ON text_index (paper_id, page_number);

    CREATE TABLE IF NOT EXISTS review_runs (
      id TEXT PRIMARY KEY,
      paper_id TEXT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
      venue_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      search_enabled INTEGER NOT NULL,
      status TEXT NOT NULL,
      progress TEXT,
      output TEXT,
      error TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS review_runs_paper_idx ON review_runs (paper_id);

    CREATE TABLE IF NOT EXISTS agent_outputs (
      id TEXT PRIMARY KEY,
      review_run_id TEXT NOT NULL REFERENCES review_runs(id) ON DELETE CASCADE,
      agent TEXT NOT NULL,
      raw_output TEXT NOT NULL,
      parsed_output TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS agent_outputs_run_idx ON agent_outputs (review_run_id);

    CREATE TABLE IF NOT EXISTS annotations (
      id TEXT PRIMARY KEY,
      paper_id TEXT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
      review_run_id TEXT NOT NULL REFERENCES review_runs(id) ON DELETE CASCADE,
      suggestion_id TEXT,
      text_index_id TEXT,
      type TEXT NOT NULL,
      position TEXT,
      content TEXT,
      score REAL NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS annotations_run_idx ON annotations (review_run_id);

    CREATE TABLE IF NOT EXISTS chat_messages (
      id TEXT PRIMARY KEY,
      paper_id TEXT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
      review_run_id TEXT REFERENCES review_runs(id) ON DELETE SET NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      target TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS chat_messages_paper_idx ON chat_messages (paper_id);

    CREATE TABLE IF NOT EXISTS rebuttals (
      id TEXT PRIMARY KEY,
      paper_id TEXT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
      review_run_id TEXT NOT NULL REFERENCES review_runs(id) ON DELETE CASCADE,
      suggestion_id TEXT,
      target TEXT,
      user_message TEXT NOT NULL,
      agent_judgment TEXT NOT NULL,
      revised_action TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS rebuttals_run_idx ON rebuttals (review_run_id);

    CREATE TABLE IF NOT EXISTS memory_summaries (
      id TEXT PRIMARY KEY,
      paper_id TEXT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
      review_run_id TEXT REFERENCES review_runs(id) ON DELETE SET NULL,
      summary TEXT NOT NULL,
      token_estimate INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS memory_summaries_paper_idx ON memory_summaries (paper_id);
  `);
}

export async function getDb(): Promise<DbClient> {
  if (globalForDb.aiReviewerDb) return globalForDb.aiReviewerDb;

  await ensureRuntimeDirs();
  const sqlite =
    globalForDb.aiReviewerSqlite ??
    new Database(serverEnv.dbPath, {
      fileMustExist: false
    });
  initSchema(sqlite);

  globalForDb.aiReviewerSqlite = sqlite;
  globalForDb.aiReviewerDb = drizzle(sqlite, { schema });
  return globalForDb.aiReviewerDb;
}

export function now(): number {
  return Date.now();
}
