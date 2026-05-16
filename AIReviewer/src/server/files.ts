import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { serverEnv } from "@/server/env";

export async function ensureRuntimeDirs(): Promise<void> {
  await mkdir(serverEnv.uploadDir, { recursive: true });
  await mkdir(path.dirname(serverEnv.dbPath), { recursive: true });
}

export function sanitizeFilename(filename: string): string {
  return filename
    .replace(/[/\\?%*:|"<>]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
}

export function sha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

export async function persistPdfUpload(file: File): Promise<{
  id: string;
  originalName: string;
  storedName: string;
  localPath: string;
  mimeType: string;
  size: number;
  hash: string;
}> {
  await ensureRuntimeDirs();
  const bytes = Buffer.from(await file.arrayBuffer());
  const mimeType = file.type || "application/pdf";
  const id = randomUUID();
  const originalName = sanitizeFilename(file.name || "paper.pdf");
  const storedName = `${id}-${originalName.endsWith(".pdf") ? originalName : `${originalName}.pdf`}`;
  const localPath = path.join(serverEnv.uploadDir, storedName);
  await writeFile(localPath, bytes);

  return {
    id,
    originalName,
    storedName,
    localPath,
    mimeType,
    size: bytes.byteLength,
    hash: sha256(bytes)
  };
}
