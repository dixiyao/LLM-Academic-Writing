import { describe, expect, it } from "vitest";

import { reviewOutputSchema, roleReviewSchema } from "@/lib/review-schema";
import { parseStructured } from "@/server/providers/json";

describe("parseStructured", () => {
  it("unwraps review output nested inside completeReview", () => {
    const parsed = parseStructured(
      JSON.stringify({
        completeReview: {
          paperBrief: {
            title: "Federated Optimization Paper",
            oneSentenceSummary: "The paper proposes a federated reasoning method.",
            claimedContributions: ["Federated traces"],
            methods: ["Trace aggregation"],
            experiments: ["Accuracy table"],
            limitations: ["Related work"]
          },
          standardReview: {
            summary: "Promising but needs clearer evidence.",
            strengths: ["Clear motivation"],
            weaknesses: ["Evidence is thin"],
            questions: ["How robust is the method?"],
            recommendation: "Borderline",
            confidence: 0.6
          },
          hardReview: {
            summary: "A skeptical reviewer may question novelty.",
            strengths: [],
            weaknesses: ["Closest baselines need more detail"],
            questions: [],
            recommendation: "Weak reject",
            confidence: 0.5
          },
          metaReview: {
            readiness: "borderline",
            decisionRationale: "Needs stronger empirical support.",
            mostImportantRisks: ["Empirical support"],
            highestLeverageFixes: ["Add ablations"]
          },
          improvementPlan: ["Add a stress test"],
          suggestions: [],
          sources: [],
          completeReview: "Full review text"
        }
      }),
      reviewOutputSchema
    );

    expect(parsed.paperBrief.title).toBe("Federated Optimization Paper");
    expect(parsed.completeReview).toBe("Full review text");
  });

  it("normalizes title plus review objects into readable sections", () => {
    const parsed = parseStructured(
      JSON.stringify({
        title: "Federation over Text",
        review: {
          summary: "The paper proposes FoT.",
          strengths: ["Novel framing"],
          weaknesses: ["Ambiguous 25% claim"],
          questions: ["Which benchmarks support the claim?"],
          recommendation: "Borderline accept",
          confidence: 0.64
        },
        suggestions: [
          {
            anchor: "improves average performance scores by 25%",
            issue: "Ambiguous improvement claim",
            suggestion: "Clarify relative versus absolute gains."
          }
        ]
      }),
      reviewOutputSchema
    );

    expect(parsed.paperBrief.title).toBe("Federation over Text");
    expect(parsed.standardReview.strengths).toContain("Novel framing");
    expect(parsed.suggestions[0].anchorText).toContain("25%");
    expect(parsed.completeReview).toContain("Strengths");
    expect(parsed.completeReview).not.toContain("```json");
  });

  it("normalizes nested snake_case review fields from real provider output", () => {
    const parsed = parseStructured(
      JSON.stringify({
        title: "Federation over Text: Insight Sharing for Multi-Agent Reasoning",
        summary: "The paper proposes FoT.",
        review: {
          standard_review: {
            summary: "FoT is an interesting idea.",
            strengths: ["Comprehensive experiments"],
            weaknesses: ["Cross-domain transfer evidence is mostly anecdotal."],
            questions_for_authors: ["How do you measure transfer rate?"]
          },
          hard_review: {
            summary: "The paper has rejection risk.",
            rejection_risks: ["LLM-as-judge bias makes the 80% claim unreliable."],
            suggestions_to_address: ["Cross-validate with human evaluation."]
          },
          ac_review: {
            summary: "Creative but under-supported.",
            verdict: "Borderline."
          }
        }
      }),
      reviewOutputSchema
    );

    expect(parsed.standardReview.summary).toBe("FoT is an interesting idea.");
    expect(parsed.standardReview.strengths).toContain("Comprehensive experiments");
    expect(parsed.standardReview.questions).toContain("How do you measure transfer rate?");
    expect(parsed.hardReview.weaknesses).toContain(
      "LLM-as-judge bias makes the 80% claim unreliable."
    );
    expect(parsed.metaReview.decisionRationale).toContain("Creative");
    expect(parsed.suggestions.length).toBeGreaterThan(0);
  });

  it("normalizes a single reviewer role response into the matching section", () => {
    const parsed = parseStructured(
      JSON.stringify({
        title: "Attention Is All You Need",
        roleId: "standard_reviewer",
        roleName: "Standard Venue Reviewer",
        focusAreas: ["contribution", "soundness"],
        summary: "The paper introduces the Transformer for sequence transduction.",
        strengths: ["Strong empirical translation results."],
        weaknesses: ["The generality claim is not supported beyond translation."],
        questions: ["Can the method work on non-translation tasks?"],
        recommendation: "Accept (borderline)",
        confidence: 0.75
      }),
      reviewOutputSchema
    );

    expect(parsed.paperBrief.title).toBe("Attention Is All You Need");
    expect(parsed.standardReview.summary).toContain("Transformer");
    expect(parsed.standardReview.weaknesses).toContain(
      "The generality claim is not supported beyond translation."
    );
    expect(parsed.roleReviews[0]?.roleId).toBe("standard_reviewer");
  });

  it("fills reviewer sections from analyzer-only suggestions", () => {
    const parsed = parseStructured(
      JSON.stringify({
        improvementPlan: ["Add non-translation experiments."],
        suggestions: [
          {
            id: "S1",
            agent: "ac_meta_reviewer",
            targetType: "general",
            section: "Experiments",
            anchorText: "",
            pageHint: 6,
            severity: "high",
            confidence: 0.95,
            rationale: "The paper only evaluates on machine translation.",
            action: "Add results on at least one task beyond machine translation.",
            rebuttalQuestion: "Where is a non-translation task evaluated?"
          }
        ],
        sources: []
      }),
      reviewOutputSchema
    );

    expect(parsed.hardReview.weaknesses[0]).toContain("machine translation");
    expect(parsed.metaReview.highestLeverageFixes).toContain("Add non-translation experiments.");
    expect(parsed.completeReview).toContain("Hard Reviewer Risks");
  });

  it("repairs a truncated reviewer-role JSON response", () => {
    const parsed = parseStructured(
      `{
        "roleId": "related_work_reviewer",
        "roleName": "Related Work and Novelty Reviewer",
        "focusAreas": ["novelty", "positioning"],
        "summary": "The paper introduces the Transformer and positions it against recurrent and convolutional sequence models.",
        "strengths": ["The paper clearly states the fully attention-based transduction contribution."],
        "weaknesses": [
          "The related work does not deeply engage with close models that reduce sequential computation beyond empirical`,
      roleReviewSchema
    );

    expect(parsed.roleId).toBe("related_work_reviewer");
    expect(parsed.summary).toContain("Transformer");
    expect(parsed.weaknesses[0]).toContain("reduce sequential computation");
    expect(parsed.questions).toEqual([]);
  });
});
