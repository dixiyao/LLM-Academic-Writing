import {
  analyzerOutputSchema,
  metaReviewSchema,
  paperBriefSchema,
  reviewOutputSchema,
  roleReviewSchema,
  type ReviewOutput,
  type ReviewerAgentId,
  type RoleReview
} from "@/lib/review-schema";
import type {
  GenerateRequest,
  GenerateStructuredRequest,
  LLMProvider,
  ProviderUploadResult
} from "@/server/providers/types";

export class FakeProvider implements LLMProvider {
  id = "fake" as const;
  label = "Fake provider";
  model = "fake-reviewer-v1";

  async uploadFile(): Promise<ProviderUploadResult> {
    return { state: "not_uploaded", message: "Fake provider does not upload files." };
  }

  async generateText(request: GenerateRequest): Promise<string> {
    const attachmentNote = request.attachments?.length
      ? ` I also received ${request.attachments.length} image attachment(s).`
      : "";
    return `I checked the current review context.${attachmentNote} ${request.userPrompt.slice(0, 240)}`;
  }

  async generateStructured<T>(
    request: GenerateStructuredRequest<T>
  ): Promise<{ raw: string; parsed: T }> {
    const output = buildFakeReviewOutput();
    const selected = selectFakeOutput(request, output);

    return {
      raw: JSON.stringify(selected),
      parsed: request.schema.parse(selected)
    };
  }
}

function buildFakeReviewOutput(): ReviewOutput {
  const roleReviews: RoleReview[] = [
    {
      roleId: "standard_reviewer",
      roleName: "Standard Venue Reviewer",
      focusAreas: ["contribution", "soundness", "significance", "clarity", "venue fit"],
      summary:
        "The submission is promising and generally clear, but several claims need stronger evidence.",
      strengths: ["Motivation is clear", "Experiments are relevant"],
      weaknesses: [
        "The main claim is broader than the presented evidence",
        "Related work discussion is too compressed"
      ],
      questions: ["Can the authors clarify when the method fails?"],
      recommendation: "Borderline accept after strengthening evidence",
      confidence: 0.62
    },
    {
      roleId: "hard_reviewer",
      roleName: "Skeptical Reviewer 2",
      focusAreas: [
        "fatal risks",
        "claim overreach",
        "missing baselines",
        "unsupported novelty",
        "rebuttal-resistant objections"
      ],
      summary:
        "A skeptical reviewer may focus on whether the evidence distinguishes the method from simpler alternatives.",
      strengths: ["The paper has a plausible problem framing"],
      weaknesses: [
        "Missing stress tests could make the empirical case fragile",
        "Some experimental settings are underspecified"
      ],
      questions: ["Were hyperparameters tuned equally for all baselines?"],
      recommendation: "Borderline reject unless evidence is expanded",
      confidence: 0.58
    },
    {
      roleId: "methodology_reviewer",
      roleName: "Methodology and Experiments Reviewer",
      focusAreas: [
        "experimental design",
        "baselines",
        "ablations",
        "statistics",
        "reproducibility"
      ],
      summary:
        "The experimental structure is plausible, but the evidence does not yet isolate the claimed mechanism.",
      strengths: ["The paper includes a main benchmark and an ablation"],
      weaknesses: [
        "A controlled stress test on shifted data would better support the robustness claim",
        "Reporting does not make baseline tuning fairness obvious"
      ],
      questions: ["Which ablation isolates the proposed objective from architecture changes?"],
      recommendation: "Weak accept if the experimental evidence is tightened",
      confidence: 0.6
    },
    {
      roleId: "related_work_reviewer",
      roleName: "Related Work and Novelty Reviewer",
      focusAreas: [
        "novelty",
        "closest related work",
        "positioning",
        "claim scope",
        "citation gaps"
      ],
      summary:
        "The paper cites relevant areas but needs a sharper comparison to the closest adjacent methods.",
      strengths: ["The motivation connects to a recognizable research problem"],
      weaknesses: [
        "The related work section does not clearly separate the paper from close alternatives",
        "Novelty may be discounted unless assumptions and evaluation settings are contrasted"
      ],
      questions: ["Which cited baseline is closest in assumptions and supervision?"],
      recommendation: "Borderline until positioning is clearer",
      confidence: 0.57
    },
    {
      roleId: "writing_reviewer",
      roleName: "Writing and Claim-Evidence Reviewer",
      focusAreas: [
        "clarity",
        "claim-evidence alignment",
        "limitations",
        "paper structure",
        "reviewer readability"
      ],
      summary:
        "The paper is readable, but several claims need clearer signposting to the exact supporting evidence.",
      strengths: ["The abstract states the intended contribution directly"],
      weaknesses: [
        "The phrase 'we show that' invites a broader interpretation than the experiments support",
        "The limitations discussion should name expected failure cases earlier"
      ],
      questions: ["Can each main claim point to a table, figure, or ablation?"],
      recommendation: "Acceptability improves with tighter claim wording",
      confidence: 0.65
    }
  ];

  const output: ReviewOutput = {
    paperBrief: {
      title: "Sample Uploaded Paper",
      oneSentenceSummary:
        "The paper proposes a method and evaluates it on representative experiments.",
      claimedContributions: [
        "A new modeling approach",
        "An empirical comparison against common baselines"
      ],
      methods: ["Model architecture", "Training objective"],
      experiments: ["Main benchmark table", "Ablation study"],
      limitations: ["Related work coverage and failure modes need more detail"]
    },
    standardReview: roleReviews[0],
    hardReview: roleReviews[1],
    roleReviews,
    debateRounds: [
      { round: 1, roleReviews },
      { round: 2, roleReviews },
      { round: 3, roleReviews }
    ],
    metaReview: {
      readiness: "borderline",
      decisionRationale:
        "The paper has a coherent contribution but should add stronger experiments and clearer claim boundaries.",
      mostImportantRisks: [
        "Reviewers may challenge empirical sufficiency",
        "Novelty may be discounted without sharper positioning"
      ],
      highestLeverageFixes: [
        "Add a stress-test experiment",
        "Rewrite the claims to match the evidence",
        "Expand related work comparison"
      ]
    },
    improvementPlan: [
      "Add one controlled experiment that isolates the claimed mechanism.",
      "Add a limitations paragraph that states expected failure cases.",
      "Map each main claim to the exact table or figure that supports it."
    ],
    suggestions: [
      {
        id: "sug-claim-evidence",
        agent: "writing_reviewer",
        targetType: "sentence",
        section: "Abstract",
        anchorText: "we show that",
        severity: "high",
        confidence: 0.74,
        rationale:
          "The claim sounds broad; reviewers may ask whether the experiments fully support it.",
        action:
          "Narrow the wording or add a direct experiment that tests the claim in the stated setting.",
        rebuttalQuestion:
          "Which result in the paper directly supports the full scope of this claim?"
      },
      {
        id: "sug-stress-test",
        agent: "methodology_reviewer",
        targetType: "general",
        section: "Experiments",
        anchorText: "",
        severity: "high",
        confidence: 0.7,
        rationale:
          "A controlled stress test would make the empirical case less fragile for skeptical reviewers.",
        action:
          "Add a shifted-data or failure-mode stress test and report whether the claimed mechanism still holds.",
        rebuttalQuestion: "Is this stress setting already evaluated elsewhere in the paper?"
      },
      {
        id: "sug-related-work",
        agent: "related_work_reviewer",
        targetType: "general",
        section: "Related Work",
        anchorText: "",
        severity: "medium",
        confidence: 0.66,
        rationale:
          "A reviewer may expect a more explicit comparison to recent adjacent methods.",
        action:
          "Add a paragraph contrasting assumptions, supervision, and evaluation settings.",
        rebuttalQuestion: "Are the closest methods already compared in text or only cited?"
      }
    ],
    sources: [
      {
        title: "Venue reviewer instructions",
        url: "https://neurips.cc/Conferences/2026/ReviewerGuidelines",
        note: "Used as rubric context in the fake run."
      }
    ],
    completeReview:
      "Review outline:\n\nThe paper is promising but currently borderline. Strengthen the evidence for broad claims, add stress tests, and expand the related work comparison. The most important improvement is to align claims with experimental support."
  };

  return reviewOutputSchema.parse(output);
}

function selectFakeOutput<T>(
  request: GenerateStructuredRequest<T>,
  output: ReviewOutput
): unknown {
  if (Object.is(request.schema, paperBriefSchema)) return output.paperBrief;
  if (Object.is(request.schema, metaReviewSchema)) return output.metaReview;
  if (Object.is(request.schema, analyzerOutputSchema)) {
    return {
      improvementPlan: output.improvementPlan,
      suggestions: output.suggestions,
      sources: output.sources
    };
  }
  if (Object.is(request.schema, roleReviewSchema)) {
    return findRoleForPrompt(request.userPrompt, output.roleReviews);
  }
  return output;
}

function findRoleForPrompt(prompt: string, roleReviews: RoleReview[]): RoleReview {
  const normalizedPrompt = prompt.toLowerCase();
  const explicitRole = roleReviews.find(
    (role) =>
      normalizedPrompt.includes(role.roleId) ||
      normalizedPrompt.includes(role.roleName.toLowerCase())
  );
  if (explicitRole) return explicitRole;

  const aliasRole = roleReviews.find((role) =>
    normalizedPrompt.includes(roleAlias(role.roleId))
  );
  return aliasRole ?? roleReviews[0];
}

function roleAlias(roleId: ReviewerAgentId): string {
  switch (roleId) {
    case "standard_reviewer":
      return "standard";
    case "hard_reviewer":
      return "skeptical";
    case "methodology_reviewer":
      return "methodology";
    case "related_work_reviewer":
      return "related work";
    case "writing_reviewer":
      return "writing";
  }
}
