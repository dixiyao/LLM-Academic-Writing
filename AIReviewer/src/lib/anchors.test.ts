import { describe, expect, it } from "vitest";

import {
  jaccardScore,
  normalizeForMatch,
  resolveSuggestionAnchor
} from "@/lib/anchors";
import type { ReviewSuggestion, TextIndexItem } from "@/lib/review-schema";

describe("anchor matching", () => {
  it("normalizes punctuation and spacing", () => {
    expect(normalizeForMatch("We\u2019re  testing: claims!")).toBe(
      "we re testing claims"
    );
  });

  it("scores overlapping token sets", () => {
    expect(jaccardScore("strong empirical evidence", "empirical evidence")).toBeGreaterThan(
      0.55
    );
  });

  it("resolves a suggestion to the best matching PDF sentence", () => {
    const suggestion: ReviewSuggestion = {
      id: "s1",
      agent: "improvement_analyzer",
      targetType: "sentence",
      section: "Abstract",
      anchorText: "we show that the proposed method improves robustness",
      severity: "high",
      confidence: 0.8,
      rationale: "Claim needs support.",
      action: "Add a stress test.",
      rebuttalQuestion: ""
    };
    const index: TextIndexItem[] = [
      {
        id: "a",
        pageNumber: 1,
        text: "This unrelated sentence discusses the problem setting."
      },
      {
        id: "b",
        pageNumber: 1,
        text: "In our experiments, we show that the proposed method improves robustness on shifted data."
      }
    ];

    const match = resolveSuggestionAnchor(suggestion, index);
    expect(match?.textIndexId).toBe("b");
    expect(match?.score).toBeGreaterThan(0.5);
  });

  it("resolves general suggestions when the model provides anchor text", () => {
    const suggestion: ReviewSuggestion = {
      id: "s2",
      agent: "improvement_analyzer",
      targetType: "general",
      section: "Abstract",
      anchorText: "improves average performance scores by 25%",
      severity: "medium",
      confidence: 0.7,
      rationale: "The numerical claim needs clarification.",
      action: "Clarify whether the improvement is relative or absolute.",
      rebuttalQuestion: ""
    };
    const index: TextIndexItem[] = [
      {
        id: "abstract-claim",
        pageNumber: 1,
        text: "Specifically, it improves average performance scores by 25% while reducing reasoning tokens by 4%."
      }
    ];

    expect(resolveSuggestionAnchor(suggestion, index)?.textIndexId).toBe("abstract-claim");
  });
});
