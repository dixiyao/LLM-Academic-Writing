import { describe, expect, it } from "vitest";

import type { MetaReview, PaperBrief, RoleReview } from "@/lib/review-schema";
import { venues } from "@/lib/venues";
import { buildAnalyzerPrompt, buildMetaReviewerPrompt } from "@/server/agents/prompts";

const paperBrief: PaperBrief = {
  title: "Example Paper",
  oneSentenceSummary: "The paper proposes a review assistant.",
  claimedContributions: ["A multi-agent review workflow"],
  methods: ["Prompted reviewers"],
  experiments: ["Case study"],
  limitations: []
};

const roleReviews: RoleReview[] = [
  {
    roleId: "standard_reviewer",
    roleName: "Standard Reviewer",
    focusAreas: ["quality"],
    summary: "Promising but needs clearer evaluation.",
    strengths: ["Clear motivation"],
    weaknesses: ["Missing baseline"],
    questions: ["Which baseline is strongest?"],
    recommendation: "Borderline",
    confidence: 0.7
  }
];

const metaReview: MetaReview = {
  readiness: "borderline",
  decisionRationale: "The main risk is missing empirical support.",
  mostImportantRisks: ["Missing baseline"],
  highestLeverageFixes: ["Add a matched baseline"]
};

describe("agent prompts", () => {
  it("includes user-provided review context in the AC/meta prompt", () => {
    const prompt = buildMetaReviewerPrompt({
      venue: venues.neurips,
      paperBrief,
      roleReviews,
      debateRounds: [],
      reviewContext:
        "For CHI-style papers, assess study validity, participant population, and design implications."
    });

    expect(prompt).toContain("User-provided review context and examples");
    expect(prompt).toContain("participant population");
    expect(prompt).toContain("Do not copy facts");
  });

  it("includes user-provided review context in the analyzer prompt", () => {
    const prompt = buildAnalyzerPrompt({
      venue: venues.neurips,
      paperBrief,
      roleReviews,
      debateRounds: [],
      metaReview,
      searchEnabled: false,
      reviewContext:
        "Suggestions should name the exact claim, missing evidence, and concrete revision."
    });

    expect(prompt).toContain("User-provided review context and examples");
    expect(prompt).toContain("missing evidence");
    expect(prompt).toContain("Do not copy facts");
  });
});
