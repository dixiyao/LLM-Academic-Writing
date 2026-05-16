import type { z } from "zod";

import type { ProviderId } from "@/lib/review-schema";

export type ProviderUploadResult = {
  fileName?: string;
  fileUri?: string;
  mimeType?: string;
  state: "active" | "not_uploaded" | "skipped_missing_key" | "failed";
  message?: string;
};

export type PaperAttachment = {
  localPath: string;
  originalName: string;
  mimeType: string;
  providerFileUri?: string | null;
  providerMimeType?: string | null;
};

export type UserAttachment = {
  name: string;
  mimeType: string;
  dataUrl: string;
};

export type GenerateRequest = {
  systemPrompt: string;
  userPrompt: string;
  paper?: PaperAttachment;
  attachments?: UserAttachment[];
  searchEnabled?: boolean;
};

export type GenerateStructuredRequest<T> = GenerateRequest & {
  schema: z.ZodType<T>;
  jsonSchema?: unknown;
};

export interface LLMProvider {
  id: ProviderId;
  label: string;
  model: string;
  uploadFile(file: {
    localPath: string;
    mimeType: string;
    displayName: string;
  }): Promise<ProviderUploadResult>;
  generateText(request: GenerateRequest): Promise<string>;
  generateStructured<T>(request: GenerateStructuredRequest<T>): Promise<{
    raw: string;
    parsed: T;
  }>;
}
