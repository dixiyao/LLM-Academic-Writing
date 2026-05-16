import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { textIndexItemSchema } from "@/lib/review-schema";
import { getDb, now } from "@/server/db/client";
import { papers, textIndex } from "@/server/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z.object({
  items: z.array(textIndexItemSchema).max(10_000)
});

export async function POST(
  request: Request,
  context: { params: Promise<{ paperId: string }> }
) {
  const { paperId } = await context.params;
  const body = requestSchema.parse(await request.json());
  const db = await getDb();

  const [paper] = await db.select().from(papers).where(eq(papers.id, paperId));
  if (!paper) {
    return NextResponse.json({ error: "Paper not found." }, { status: 404 });
  }

  await db.delete(textIndex).where(eq(textIndex.paperId, paperId));
  if (body.items.length) {
    await db.insert(textIndex).values(
      body.items.map((item) => ({
        id: storedTextIndexId(paperId, item.id || randomUUID()),
        paperId,
        pageNumber: item.pageNumber,
        text: item.text,
        rawText: item.rawText ?? null,
        position: item.position ?? null,
        createdAt: now()
      }))
    );
  }

  return NextResponse.json({ count: body.items.length });
}

function storedTextIndexId(paperId: string, itemId: string): string {
  return itemId.startsWith(`${paperId}:`) ? itemId : `${paperId}:${itemId}`;
}
