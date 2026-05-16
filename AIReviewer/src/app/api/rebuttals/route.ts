import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import {
  rebuttalTargetSchema,
  reviewOutputSchema
} from "@/lib/review-schema";
import { buildRebuttalPrompt } from "@/server/agents/prompts";
import { getDb, now } from "@/server/db/client";
import { papers, rebuttals, reviewRuns } from "@/server/db/schema";
import { getProvider } from "@/server/providers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z.object({
  paperId: z.string().min(1),
  reviewRunId: z.string().min(1),
  message: z.string().min(1),
  target: rebuttalTargetSchema,
  attachments: z
    .array(
      z.object({
        name: z.string().min(1),
        mimeType: z.string().min(1),
        dataUrl: z.string().startsWith("data:")
      })
    )
    .max(6)
    .default([])
});

export async function POST(request: Request) {
  const body = requestSchema.parse(await request.json());
  const db = await getDb();
  const [paper] = await db.select().from(papers).where(eq(papers.id, body.paperId));
  const [reviewRun] = await db
    .select()
    .from(reviewRuns)
    .where(eq(reviewRuns.id, body.reviewRunId));

  if (!paper) {
    return NextResponse.json({ error: "Paper not found." }, { status: 404 });
  }
  if (!reviewRun?.output) {
    return NextResponse.json({ error: "Review run not found." }, { status: 404 });
  }

  const review = reviewOutputSchema.parse(reviewRun.output);
  const suggestion = body.target.suggestionId
    ? review.suggestions.find((item) => item.id === body.target.suggestionId)
    : undefined;
  const provider = getProvider(reviewRun.provider);
  const judgment = await provider.generateText({
    systemPrompt:
      "You are AIReviewer evaluating an author rebuttal. Update the critique only when the rebuttal directly resolves the concern.",
    userPrompt: buildRebuttalPrompt({
      review,
      suggestionJson: suggestion ? JSON.stringify(suggestion, null, 2) : "",
      userMessage: body.message,
      selectedText: body.target.selectedText,
      targetAgent: body.target.agent
    }),
    attachments: body.attachments,
    paper: {
      localPath: paper.localPath,
      originalName: paper.originalName,
      mimeType: paper.mimeType,
      providerFileUri: paper.providerFileUri,
      providerMimeType: paper.providerMimeType
    }
  });

  const row = {
    id: randomUUID(),
    paperId: body.paperId,
    reviewRunId: body.reviewRunId,
    suggestionId: body.target.suggestionId ?? null,
    target: body.target,
    userMessage: body.message,
    agentJudgment: judgment,
    revisedAction: null,
    createdAt: now()
  };
  await db.insert(rebuttals).values(row);

  return NextResponse.json({ rebuttal: row });
}
