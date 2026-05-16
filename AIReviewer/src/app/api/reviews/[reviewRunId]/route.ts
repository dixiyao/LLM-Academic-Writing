import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { getDb } from "@/server/db/client";
import {
  annotations,
  chatMessages,
  rebuttals,
  reviewRuns
} from "@/server/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ reviewRunId: string }> }
) {
  const { reviewRunId } = await context.params;
  const db = await getDb();
  const [reviewRun] = await db
    .select()
    .from(reviewRuns)
    .where(eq(reviewRuns.id, reviewRunId));
  if (!reviewRun) {
    return NextResponse.json({ error: "Review run not found." }, { status: 404 });
  }

  const [annotationRows, rebuttalRows, chatRows] = await Promise.all([
    db.select().from(annotations).where(eq(annotations.reviewRunId, reviewRunId)),
    db.select().from(rebuttals).where(eq(rebuttals.reviewRunId, reviewRunId)),
    db.select().from(chatMessages).where(eq(chatMessages.reviewRunId, reviewRunId))
  ]);

  return NextResponse.json({
    reviewRun,
    annotations: annotationRows,
    rebuttals: rebuttalRows,
    chatMessages: chatRows
  });
}
