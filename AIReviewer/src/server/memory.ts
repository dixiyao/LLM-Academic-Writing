import { randomUUID } from "node:crypto";

import { desc, eq } from "drizzle-orm";

import { getDb, now } from "@/server/db/client";
import { chatMessages, memorySummaries } from "@/server/db/schema";

export async function getMemoryContext(paperId: string): Promise<string> {
  const db = await getDb();
  const summaries = await db
    .select()
    .from(memorySummaries)
    .where(eq(memorySummaries.paperId, paperId))
    .orderBy(desc(memorySummaries.createdAt))
    .limit(3);

  const recentMessages = await db
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.paperId, paperId))
    .orderBy(desc(chatMessages.createdAt))
    .limit(8);

  const summaryText = summaries
    .reverse()
    .map((summary) => summary.summary)
    .join("\n\n");
  const messagesText = recentMessages
    .reverse()
    .map((message) => `${message.role}: ${message.content}`)
    .join("\n");

  return [summaryText, messagesText].filter(Boolean).join("\n\n");
}

export async function compactMemoryIfNeeded(args: {
  paperId: string;
  reviewRunId?: string | null;
}): Promise<void> {
  const db = await getDb();
  const messages = await db
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.paperId, args.paperId))
    .orderBy(desc(chatMessages.createdAt))
    .limit(14);

  if (messages.length < 10) return;

  const ordered = messages.reverse();
  const summary = ordered
    .slice(-10)
    .map((message) => `${message.role}: ${message.content.slice(0, 240)}`)
    .join("\n");

  await db.insert(memorySummaries).values({
    id: randomUUID(),
    paperId: args.paperId,
    reviewRunId: args.reviewRunId ?? null,
    summary: `Recent compacted conversation:\n${summary}`,
    tokenEstimate: Math.ceil(summary.length / 4),
    createdAt: now()
  });
}
