import { relations } from "drizzle-orm";
import {
  index,
  integer,
  real,
  sqliteTable,
  text
} from "drizzle-orm/sqlite-core";

export const papers = sqliteTable(
  "papers",
  {
    id: text("id").primaryKey(),
    originalName: text("original_name").notNull(),
    storedName: text("stored_name").notNull(),
    mimeType: text("mime_type").notNull(),
    size: integer("size").notNull(),
    sha256: text("sha256").notNull(),
    localPath: text("local_path").notNull(),
    provider: text("provider").notNull().default("gemini"),
    providerFileName: text("provider_file_name"),
    providerFileUri: text("provider_file_uri"),
    providerMimeType: text("provider_mime_type"),
    providerState: text("provider_state").notNull().default("not_uploaded"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull()
  },
  (table) => ({
    shaIdx: index("papers_sha_idx").on(table.sha256)
  })
);

export const textIndex = sqliteTable(
  "text_index",
  {
    id: text("id").primaryKey(),
    paperId: text("paper_id")
      .notNull()
      .references(() => papers.id, { onDelete: "cascade" }),
    pageNumber: integer("page_number").notNull(),
    text: text("text").notNull(),
    rawText: text("raw_text"),
    position: text("position", { mode: "json" }),
    createdAt: integer("created_at").notNull()
  },
  (table) => ({
    paperPageIdx: index("text_index_paper_page_idx").on(table.paperId, table.pageNumber)
  })
);

export const reviewRuns = sqliteTable(
  "review_runs",
  {
    id: text("id").primaryKey(),
    paperId: text("paper_id")
      .notNull()
      .references(() => papers.id, { onDelete: "cascade" }),
    venueId: text("venue_id").notNull(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    searchEnabled: integer("search_enabled", { mode: "boolean" }).notNull(),
    status: text("status").notNull(),
    progress: text("progress", { mode: "json" }),
    output: text("output", { mode: "json" }),
    error: text("error"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull()
  },
  (table) => ({
    paperIdx: index("review_runs_paper_idx").on(table.paperId)
  })
);

export const agentOutputs = sqliteTable(
  "agent_outputs",
  {
    id: text("id").primaryKey(),
    reviewRunId: text("review_run_id")
      .notNull()
      .references(() => reviewRuns.id, { onDelete: "cascade" }),
    agent: text("agent").notNull(),
    rawOutput: text("raw_output").notNull(),
    parsedOutput: text("parsed_output", { mode: "json" }),
    createdAt: integer("created_at").notNull()
  },
  (table) => ({
    runIdx: index("agent_outputs_run_idx").on(table.reviewRunId)
  })
);

export const annotations = sqliteTable(
  "annotations",
  {
    id: text("id").primaryKey(),
    paperId: text("paper_id")
      .notNull()
      .references(() => papers.id, { onDelete: "cascade" }),
    reviewRunId: text("review_run_id")
      .notNull()
      .references(() => reviewRuns.id, { onDelete: "cascade" }),
    suggestionId: text("suggestion_id"),
    textIndexId: text("text_index_id"),
    type: text("type").notNull(),
    position: text("position", { mode: "json" }),
    content: text("content", { mode: "json" }),
    score: real("score").notNull().default(0),
    createdAt: integer("created_at").notNull()
  },
  (table) => ({
    runIdx: index("annotations_run_idx").on(table.reviewRunId)
  })
);

export const chatMessages = sqliteTable(
  "chat_messages",
  {
    id: text("id").primaryKey(),
    paperId: text("paper_id")
      .notNull()
      .references(() => papers.id, { onDelete: "cascade" }),
    reviewRunId: text("review_run_id").references(() => reviewRuns.id, {
      onDelete: "set null"
    }),
    role: text("role").notNull(),
    content: text("content").notNull(),
    target: text("target", { mode: "json" }),
    createdAt: integer("created_at").notNull()
  },
  (table) => ({
    paperIdx: index("chat_messages_paper_idx").on(table.paperId)
  })
);

export const rebuttals = sqliteTable(
  "rebuttals",
  {
    id: text("id").primaryKey(),
    paperId: text("paper_id")
      .notNull()
      .references(() => papers.id, { onDelete: "cascade" }),
    reviewRunId: text("review_run_id")
      .notNull()
      .references(() => reviewRuns.id, { onDelete: "cascade" }),
    suggestionId: text("suggestion_id"),
    target: text("target", { mode: "json" }),
    userMessage: text("user_message").notNull(),
    agentJudgment: text("agent_judgment").notNull(),
    revisedAction: text("revised_action"),
    createdAt: integer("created_at").notNull()
  },
  (table) => ({
    runIdx: index("rebuttals_run_idx").on(table.reviewRunId)
  })
);

export const memorySummaries = sqliteTable(
  "memory_summaries",
  {
    id: text("id").primaryKey(),
    paperId: text("paper_id")
      .notNull()
      .references(() => papers.id, { onDelete: "cascade" }),
    reviewRunId: text("review_run_id").references(() => reviewRuns.id, {
      onDelete: "set null"
    }),
    summary: text("summary").notNull(),
    tokenEstimate: integer("token_estimate").notNull().default(0),
    createdAt: integer("created_at").notNull()
  },
  (table) => ({
    paperIdx: index("memory_summaries_paper_idx").on(table.paperId)
  })
);

export const paperRelations = relations(papers, ({ many }) => ({
  textIndex: many(textIndex),
  reviewRuns: many(reviewRuns),
  chatMessages: many(chatMessages),
  memorySummaries: many(memorySummaries)
}));

export const reviewRunRelations = relations(reviewRuns, ({ one, many }) => ({
  paper: one(papers, {
    fields: [reviewRuns.paperId],
    references: [papers.id]
  }),
  agentOutputs: many(agentOutputs),
  annotations: many(annotations),
  rebuttals: many(rebuttals)
}));

export const schema = {
  papers,
  textIndex,
  reviewRuns,
  agentOutputs,
  annotations,
  chatMessages,
  rebuttals,
  memorySummaries,
  paperRelations,
  reviewRunRelations
};
