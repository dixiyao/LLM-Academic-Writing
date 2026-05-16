import type { ReviewSuggestion, TextIndexItem } from "@/lib/review-schema";

export type AnchorMatch = {
  suggestionId: string;
  textIndexId: string;
  pageNumber: number;
  score: number;
  matchedText: string;
  position?: unknown;
};

export function normalizeForMatch(value: string): string {
  return value
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokenSet(value: string): Set<string> {
  return new Set(
    normalizeForMatch(value)
      .split(" ")
      .filter((token) => token.length > 2)
  );
}

export function jaccardScore(a: string, b: string): number {
  const left = tokenSet(a);
  const right = tokenSet(b);
  if (!left.size || !right.size) return 0;

  let intersection = 0;
  for (const token of left) {
    if (right.has(token)) intersection += 1;
  }

  const union = left.size + right.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export function phraseScore(needle: string, haystack: string): number {
  const normalizedNeedle = normalizeForMatch(needle);
  const normalizedHaystack = normalizeForMatch(haystack);
  if (!normalizedNeedle || !normalizedHaystack) return 0;
  if (normalizedHaystack.includes(normalizedNeedle)) return 1;

  const tokenOverlap = jaccardScore(normalizedNeedle, normalizedHaystack);
  const lengthRatio =
    Math.min(normalizedNeedle.length, normalizedHaystack.length) /
    Math.max(normalizedNeedle.length, normalizedHaystack.length);

  return tokenOverlap * 0.85 + lengthRatio * 0.15;
}

export function resolveSuggestionAnchor(
  suggestion: ReviewSuggestion,
  textIndex: TextIndexItem[],
  minScore = 0.24
): AnchorMatch | null {
  const searchText = [
    suggestion.anchorText,
    suggestion.section,
    suggestion.action,
    suggestion.rationale
  ]
    .filter(Boolean)
    .join(" ");

  if (!searchText.trim()) {
    return null;
  }

  const candidates = suggestion.pageHint
    ? textIndex.filter((item) => item.pageNumber === suggestion.pageHint)
    : textIndex;

  let best: AnchorMatch | null = null;
  for (const item of candidates) {
    const anchorScore = suggestion.anchorText?.trim()
      ? phraseScore(suggestion.anchorText, item.text)
      : 0;
    const fallbackScore = phraseScore(searchText, item.text) * 0.72;
    const score = Math.max(anchorScore, fallbackScore);
    if (!best || score > best.score) {
      best = {
        suggestionId: suggestion.id,
        textIndexId: item.id,
        pageNumber: item.pageNumber,
        score,
        matchedText: item.text,
        position: item.position
      };
    }
  }

  return best && best.score >= minScore ? best : null;
}

export function resolveSuggestionAnchors(
  suggestions: ReviewSuggestion[],
  textIndex: TextIndexItem[],
  minScore = 0.24
): AnchorMatch[] {
  return suggestions
    .map((suggestion) => resolveSuggestionAnchor(suggestion, textIndex, minScore))
    .filter((match): match is AnchorMatch => Boolean(match));
}
