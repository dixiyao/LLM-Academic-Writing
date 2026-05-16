import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";

import { providerIds, textIndexItemSchema } from "@/lib/review-schema";
import { venueIds, venueModes, type VenueId } from "@/lib/venues";
import { runReview, type ReviewProgress } from "@/server/agents/orchestrator";
import { getDb, now } from "@/server/db/client";
import { textIndex as textIndexTable } from "@/server/db/schema";
import { serverEnv } from "@/server/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z.object({
  paperId: z.string().min(1),
  venueMode: z.enum(venueModes).default(serverEnv.venueMode),
  venueId: z.enum(venueIds).default(defaultVenueId()),
  customVenueName: z.string().trim().max(160).optional(),
  customVenueTemplatePath: z.string().trim().max(2000).optional(),
  reviewContext: z.string().max(30000).default(""),
  providerId: z.enum(providerIds).default("gemini"),
  searchEnabled: z.boolean().default(false),
  textIndex: z.array(textIndexItemSchema).default([])
});

export async function POST(request: Request) {
  const body = requestSchema.parse(await request.json());
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
        );
      };

      try {
        if (body.textIndex.length) {
          const db = await getDb();
          await db.delete(textIndexTable).where(eq(textIndexTable.paperId, body.paperId));
          await db.insert(textIndexTable).values(
            body.textIndex.map((item) => ({
              id: storedTextIndexId(body.paperId, item.id),
              paperId: body.paperId,
              pageNumber: item.pageNumber,
              text: item.text,
              rawText: item.rawText ?? null,
              position: item.position ?? null,
              createdAt: now()
            }))
          );
        }

        const result = await runReview({
          paperId: body.paperId,
          venueMode: body.venueMode,
          venueId: body.venueId,
          customVenueName: body.customVenueName,
          customVenueTemplatePath: body.customVenueTemplatePath,
          reviewContext: body.reviewContext,
          providerId: body.providerId,
          searchEnabled: body.searchEnabled,
          onProgress: (event: ReviewProgress) => send("progress", event)
        });
        send("final", result);
      } catch (error) {
        send("error", {
          message: error instanceof Error ? error.message : "Review failed."
        });
      } finally {
        controller.close();
      }
    }
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive"
    }
  });
}

export async function GET() {
  return NextResponse.json({ ok: true });
}

function storedTextIndexId(paperId: string, itemId: string): string {
  return itemId.startsWith(`${paperId}:`) ? itemId : `${paperId}:${itemId}`;
}

function defaultVenueId(): VenueId {
  return venueIds.includes(serverEnv.venueId as VenueId)
    ? (serverEnv.venueId as VenueId)
    : "neurips";
}
