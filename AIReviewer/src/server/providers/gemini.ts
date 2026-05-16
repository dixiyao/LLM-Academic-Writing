import { readFile } from "node:fs/promises";

import {
  createPartFromBase64,
  createPartFromUri,
  GoogleGenAI
} from "@google/genai";

import { serverEnv } from "@/server/env";
import { parseStructured } from "@/server/providers/json";
import type {
  GenerateRequest,
  GenerateStructuredRequest,
  LLMProvider,
  ProviderUploadResult
} from "@/server/providers/types";

function dataUrlToBase64(dataUrl: string): { mimeType: string; base64: string } | null {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return null;
  return { mimeType: match[1], base64: match[2] };
}

export class GeminiProvider implements LLMProvider {
  id = "gemini" as const;
  label = "Gemini";
  model: string;
  private ai: GoogleGenAI | null;

  constructor(model = serverEnv.geminiModel, apiKey = serverEnv.geminiApiKey) {
    this.model = model;
    this.ai = apiKey ? new GoogleGenAI({ apiKey }) : null;
  }

  async uploadFile(file: {
    localPath: string;
    mimeType: string;
    displayName: string;
  }): Promise<ProviderUploadResult> {
    if (!this.ai) {
      return {
        state: "skipped_missing_key",
        message: "GEMINI_API_KEY is not configured."
      };
    }

    try {
      const uploaded = await this.ai.files.upload({
        file: file.localPath,
        config: {
          mimeType: file.mimeType,
          displayName: file.displayName
        }
      });

      return {
        fileName: uploaded.name,
        fileUri: uploaded.uri,
        mimeType: uploaded.mimeType ?? file.mimeType,
        state: "active"
      };
    } catch (error) {
      return {
        state: "failed",
        message: error instanceof Error ? error.message : "Gemini upload failed."
      };
    }
  }

  async generateText(request: GenerateRequest): Promise<string> {
    const response = await this.generate(request);
    return response.text ?? "";
  }

  async generateStructured<T>(
    request: GenerateStructuredRequest<T>
  ): Promise<{ raw: string; parsed: T }> {
    const response = await this.generate({
      ...request,
      systemPrompt: `${request.systemPrompt}

Return only valid JSON. Do not include Markdown fences or explanatory text.`
    });
    const raw = response.text ?? "";
    return {
      raw,
      parsed: parseStructured(raw, request.schema)
    };
  }

  private async generate(request: GenerateRequest & { jsonSchema?: unknown }) {
    if (!this.ai) {
      throw new Error("GEMINI_API_KEY is not configured.");
    }

    const parts: unknown[] = [];
    if (request.paper?.providerFileUri) {
      parts.push(
        createPartFromUri(
          request.paper.providerFileUri,
          request.paper.providerMimeType ?? request.paper.mimeType
        )
      );
    } else if (request.paper) {
      const bytes = await readFile(request.paper.localPath);
      parts.push(
        createPartFromBase64(bytes.toString("base64"), request.paper.mimeType)
      );
    }
    for (const attachment of request.attachments ?? []) {
      const parsed = dataUrlToBase64(attachment.dataUrl);
      if (parsed) {
        parts.push(createPartFromBase64(parsed.base64, attachment.mimeType || parsed.mimeType));
      }
    }
    parts.push({ text: request.userPrompt });

    return this.ai.models.generateContent({
      model: this.model,
      contents: [{ role: "user", parts }],
      config: {
        systemInstruction: request.systemPrompt,
        responseMimeType: request.jsonSchema ? "application/json" : undefined,
        responseSchema: request.jsonSchema,
        tools: request.searchEnabled ? [{ googleSearch: {} }] : undefined
      }
    } as never);
  }
}
