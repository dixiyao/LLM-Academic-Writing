import { NextResponse } from "next/server";

import { getDb, now } from "@/server/db/client";
import { papers } from "@/server/db/schema";
import { persistPdfUpload } from "@/server/files";
import { getProvider } from "@/server/providers";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");
    const providerId = String(formData.get("providerId") ?? formData.get("provider") ?? "gemini");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Missing PDF file." }, { status: 400 });
    }

    if (file.type && file.type !== "application/pdf") {
      return NextResponse.json({ error: "Only PDF uploads are supported." }, { status: 400 });
    }

    const uploaded = await persistPdfUpload(file);
    const provider = getProvider(providerId);
    const providerUpload = await provider.uploadFile({
      localPath: uploaded.localPath,
      mimeType: uploaded.mimeType,
      displayName: uploaded.originalName
    });
    const timestamp = now();
    const row = {
      id: uploaded.id,
      originalName: uploaded.originalName,
      storedName: uploaded.storedName,
      mimeType: uploaded.mimeType,
      size: uploaded.size,
      sha256: uploaded.hash,
      localPath: uploaded.localPath,
      provider: provider.id,
      providerFileName: providerUpload.fileName ?? null,
      providerFileUri: providerUpload.fileUri ?? null,
      providerMimeType: providerUpload.mimeType ?? null,
      providerState: providerUpload.state,
      createdAt: timestamp,
      updatedAt: timestamp
    };

    const db = await getDb();
    await db.insert(papers).values(row);

    const responsePaper = {
      id: row.id,
      paperId: row.id,
      originalName: row.originalName,
      mimeType: row.mimeType,
      size: row.size,
      provider: row.provider,
      providerState: row.providerState,
      providerMessage: providerUpload.message,
      providerUpload: {
        state: providerUpload.state,
        message: providerUpload.message
      },
      fileUrl: `/api/papers/${row.id}/file`
    };

    return NextResponse.json({
      ...responsePaper,
      paper: responsePaper
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Upload failed." },
      { status: 500 }
    );
  }
}
