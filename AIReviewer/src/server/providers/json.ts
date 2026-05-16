import type { z } from "zod";

import {
  normalizeReviewOutputCandidate,
  reviewOutputSchema
} from "@/lib/review-schema";

function tryParseJson(text: string): unknown | null {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function firstBalancedJsonObject(text: string): string | null {
  const start = text.indexOf("{");
  if (start < 0) return null;

  let depth = 0;
  let inString = false;
  let escaping = false;

  for (let index = start; index < text.length; index += 1) {
    const char = text[index];

    if (inString) {
      if (escaping) {
        escaping = false;
      } else if (char === "\\") {
        escaping = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
    } else if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(start, index + 1);
    }
  }

  return null;
}

function repairPartialJsonObject(text: string): string | null {
  const start = text.indexOf("{");
  if (start < 0) return null;

  let repaired = text.slice(start).trim();
  const stack: Array<"}" | "]"> = [];
  let inString = false;
  let escaping = false;

  for (let index = 0; index < repaired.length; index += 1) {
    const char = repaired[index];

    if (inString) {
      if (escaping) {
        escaping = false;
      } else if (char === "\\") {
        escaping = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
    } else if (char === "{") {
      stack.push("}");
    } else if (char === "[") {
      stack.push("]");
    } else if (char === "}" || char === "]") {
      if (stack.at(-1) === char) stack.pop();
    }
  }

  if (escaping) repaired = repaired.slice(0, -1);
  if (inString) repaired += "\"";

  while (stack.length) {
    repaired = repaired.replace(/,\s*$/, "");
    repaired += stack.pop();
  }

  return repaired.replace(/,\s*([}\]])/g, "$1");
}

export function extractJsonObject(text: string): unknown {
  const trimmed = text.trim();
  const direct = tryParseJson(trimmed);
  if (direct !== null) return direct;

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)(?:```|$)/i);
  const candidates = [fenced?.[1]?.trim(), trimmed].filter(Boolean) as string[];

  for (const candidate of candidates) {
    const balanced = firstBalancedJsonObject(candidate);
    if (balanced) {
      const parsed = tryParseJson(balanced);
      if (parsed !== null) return parsed;
    }

    const repaired = repairPartialJsonObject(candidate);
    if (repaired) {
      const parsed = tryParseJson(repaired);
      if (parsed !== null) return parsed;
    }
  }

  throw new Error("Model response did not contain a JSON object.");
}

export function parseStructured<T>(text: string, schema: z.ZodType<T>): T {
  console.log("[AIReviewer] Raw model response before parsing:");
  console.log(text);

  const parsed = extractJsonObject(text);
  if (Object.is(schema, reviewOutputSchema)) {
    const normalizedReview = normalizeReviewOutputCandidate(parsed, text);
    const normalizedResult = normalizedReview
      ? schema.safeParse(normalizedReview)
      : null;
    if (normalizedResult?.success) {
      console.log("[AIReviewer] Parsed review output:");
      console.log(normalizedReview?.completeReview);
      return normalizedResult.data;
    }
  }

  // Auto-unwrap if the model returned something like { "completeReview": { "paperBrief": ... } }
  // or { "reviewOutput": { "paperBrief": ... } } instead of the raw object.
  if (
    parsed &&
    typeof parsed === "object" &&
    !Array.isArray(parsed) &&
    Object.keys(parsed).length === 1
  ) {
    const rootKey = Object.keys(parsed)[0];
    const inner = (parsed as Record<string, unknown>)[rootKey];
    if (inner && typeof inner === "object" && !Array.isArray(inner)) {
      // Check if inner object seems closer to the schema
      const innerParse = schema.safeParse(inner);
      if (innerParse.success) {
        return innerParse.data;
      }
    }
  }

  const result = schema.safeParse(parsed);
  if (result.success) return result.data;

  console.error("[AIReviewer] Failed to parse structured model response.");
  console.error("[AIReviewer] Raw model response:");
  console.error(text);
  console.error("[AIReviewer] Extracted JSON:");
  console.error(JSON.stringify(parsed, null, 2));
  console.error("[AIReviewer] Zod issues:");
  console.error(JSON.stringify(result.error.issues, null, 2));
  throw result.error;
}
