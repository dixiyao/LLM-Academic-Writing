import { readFile } from "node:fs/promises";

import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { getDb } from "@/server/db/client";
import { papers } from "@/server/db/schema";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ paperId: string }> }
) {
  try {
    const { paperId } = await params;
    const db = await getDb();
    const [paper] = await db.select().from(papers).where(eq(papers.id, paperId));
    if (!paper) {
      return NextResponse.json({ error: "Paper not found." }, { status: 404 });
    }
    const bytes = await readFile(paper.localPath);

    return new NextResponse(bytes, {
      headers: {
        "Content-Type": paper.mimeType,
        "Content-Disposition": `inline; filename="${paper.originalName.replace(/"/g, "")}"`
      }
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Paper file not found." },
      { status: 404 }
    );
  }
}
