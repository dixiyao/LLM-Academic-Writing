import { readFile } from "node:fs/promises";
import path from "node:path";

import { serverEnv } from "@/server/env";
import { parseStructured } from "@/server/providers/json";
import type {
  GenerateRequest,
  GenerateStructuredRequest,
  LLMProvider,
  ProviderUploadResult
} from "@/server/providers/types";

type OpenRouterMessage = {
  role: "system" | "user" | "assistant";
  content:
    | string
    | Array<
        | { type: "text"; text: string }
        | { type: "file"; file: { filename: string; file_data: string } }
        | { type: "image_url"; image_url: { url: string } }
      >;
};

export class OpenRouterProvider implements LLMProvider {
  id = "openrouter" as const;
  label = "OpenRouter";
  model: string;
  private apiKey: string;

  constructor(model = serverEnv.openRouterModel, apiKey = serverEnv.openRouterApiKey) {
    this.model = model;
    this.apiKey = apiKey;
  }

  async uploadFile(): Promise<ProviderUploadResult> {
    return {
      state: "not_uploaded",
      message: "OpenRouter receives the PDF inline per request."
    };
  }

  async generateText(request: GenerateRequest): Promise<string> {
    return this.call(request, false);
  }

  async generateStructured<T>(
    request: GenerateStructuredRequest<T>
  ): Promise<{ raw: string; parsed: T }> {
    const schemaPrompt = request.jsonSchema
      ? `\n\nYou MUST adhere exactly to this JSON schema:\n${JSON.stringify(request.jsonSchema)}`
      : "";

    const raw = await this.call(
      {
        ...request,
        systemPrompt: `${request.systemPrompt}${schemaPrompt}\n\nReturn only valid JSON. Do not include Markdown fences or explanatory text.`
      },
      true
    );
    return {
      raw,
      parsed: parseStructured(raw, request.schema)
    };
  }

  private async call(request: GenerateRequest, structured: boolean): Promise<string> {
    if (!this.apiKey) {
      throw new Error("OPENROUTER_API_KEY is not configured.");
    }

    const content: OpenRouterMessage["content"] = [
      { type: "text", text: request.userPrompt }
    ];
    if (request.paper) {
      const bytes = await readFile(request.paper.localPath);
      content.unshift({
        type: "file",
        file: {
          filename: path.basename(request.paper.originalName),
          file_data: `data:${request.paper.mimeType};base64,${bytes.toString("base64")}`
        }
      });
    }
    for (const attachment of request.attachments ?? []) {
      if (attachment.mimeType.startsWith("image/")) {
        content.push({
          type: "image_url",
          image_url: { url: attachment.dataUrl }
        });
      }
    }

    const messages: OpenRouterMessage[] = [
      { role: "system", content: request.systemPrompt },
      { role: "user", content }
    ];

    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "http://localhost:3000",
        "X-Title": "AIReviewer"
      },
      body: JSON.stringify({
        model: this.model,
        messages,
        response_format: structured ? { type: "json_object" } : undefined,
        plugins: request.searchEnabled ? [{ id: "web", max_results: 5 }] : undefined
      })
    });

    if (!response.ok) {
      throw new Error(
        formatOpenRouterError(response.status, this.model, await response.text())
      );
    }

    const json = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    return json.choices?.[0]?.message?.content ?? "";
  }
}

function formatOpenRouterError(status: number, model: string, body: string): string {
  const sanitizedBody = sanitizeProviderPayload(body);
  let providerMessage = sanitizedBody;
  try {
    const parsed = JSON.parse(body) as {
      error?: { message?: string; metadata?: { raw?: string } };
    };
    providerMessage = sanitizeProviderPayload(
      parsed.error?.metadata?.raw || parsed.error?.message || sanitizedBody
    );
  } catch {
    // Fall back to sanitized raw body.
  }

  const shortMessage = providerMessage.slice(0, 700);
  if (status === 429) {
    return `OpenRouter request failed: 429. Model ${model} is currently rate-limited upstream. Retry later, switch to Gemini, or choose another OpenRouter model. Provider message: ${shortMessage}`;
  }
  return `OpenRouter request failed: ${status}. ${shortMessage}`;
}

function sanitizeProviderPayload(value: string): string {
  return value
    .replace(/data:[^"'\\\s)]+;base64,[A-Za-z0-9+/=]+/g, "[data-url omitted]")
    .replace(/"file_data":"[^"]+"/g, '"file_data":"[file omitted]"')
    .replace(/"url":"[^"]*base64[^"]+"/g, '"url":"[data-url omitted]"')
    .replace(/\s+/g, " ")
    .trim();
}
