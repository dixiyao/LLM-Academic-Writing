import type { ProviderId } from "@/lib/review-schema";
import { serverEnv } from "@/server/env";
import { FakeProvider } from "@/server/providers/fake";
import { GeminiProvider } from "@/server/providers/gemini";
import { OpenRouterProvider } from "@/server/providers/openrouter";
import type { LLMProvider } from "@/server/providers/types";

export function getProvider(id: ProviderId | string = "gemini"): LLMProvider {
  if (id === "gemini") return new GeminiProvider();
  if (id === "openrouter") return new OpenRouterProvider();
  if (id === "fake" && serverEnv.allowFakeProvider) return new FakeProvider();
  throw new Error(`Unsupported or disabled provider: ${id}`);
}
