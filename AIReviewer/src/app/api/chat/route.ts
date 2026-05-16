import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { providerIds, rebuttalTargetSchema, reviewOutputSchema } from "@/lib/review-schema";
import { venueIds } from "@/lib/venues";
import { buildRebuttalPrompt } from "@/server/agents/prompts";
import { getDb, now } from "@/server/db/client";
import { chatMessages, papers, rebuttals, reviewRuns } from "@/server/db/schema";
import { compactMemoryIfNeeded, getMemoryContext } from "@/server/memory";
import { getProvider } from "@/server/providers";

export const runtime = "nodejs";
export const maxDuration = 180;

const chatRequestSchema = z.object({
  paperId: z.string().min(1),
  reviewRunId: z.string().min(1),
  venueId: z.enum(venueIds).default("neurips"),
  providerId: z.enum(providerIds).default("gemini"),
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
  try {
    const body = chatRequestSchema.parse(await request.json());
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
    const memory = await getMemoryContext(body.paperId);

    await db.insert(chatMessages).values({
      id: randomUUID(),
      paperId: body.paperId,
      reviewRunId: body.reviewRunId,
      role: "user",
      content: body.attachments.length
        ? `${body.message}\n\n[Attached images: ${body.attachments.map((item) => item.name).join(", ")}]`
        : body.message,
      target: body.target,
      createdAt: now()
    });

    const answer = await provider.generateText({
      systemPrompt:
        "You are AIReviewer evaluating an author rebuttal. Be concrete, fair, and willing to revise the critique when the rebuttal directly resolves it.",
      userPrompt: `${buildRebuttalPrompt({
        review,
        suggestionJson: suggestion ? JSON.stringify(suggestion, null, 2) : "",
        userMessage: body.message,
        selectedText: body.target.selectedText,
        targetAgent: body.target.agent
      })}

Conversation memory:
${memory || "No prior conversation memory."}

User image attachments:
${body.attachments.length ? body.attachments.map((item) => `- ${item.name} (${item.mimeType})`).join("\n") : "None"}`,
      attachments: body.attachments,
      paper: {
        localPath: paper.localPath,
        originalName: paper.originalName,
        mimeType: paper.mimeType,
        providerFileUri: paper.providerFileUri,
        providerMimeType: paper.providerMimeType
      }
    });

    const assistantMessage = {
      id: randomUUID(),
      paperId: body.paperId,
      reviewRunId: body.reviewRunId,
      role: "assistant",
      content: answer,
      target: body.target,
      createdAt: now()
    } as const;
    await db.insert(chatMessages).values(assistantMessage);

    await db.insert(rebuttals).values({
      id: randomUUID(),
      paperId: body.paperId,
      reviewRunId: body.reviewRunId,
      suggestionId: body.target.suggestionId ?? null,
      target: body.target,
      userMessage: body.message,
      agentJudgment: answer,
      revisedAction: null,
      createdAt: now()
    });

    await compactMemoryIfNeeded({
      paperId: body.paperId,
      reviewRunId: body.reviewRunId
    });

    return NextResponse.json({
      answer,
      message: {
        id: assistantMessage.id,
        role: assistantMessage.role,
        content: assistantMessage.content
      }
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Chat failed." },
      { status: 500 }
    );
  }
}
