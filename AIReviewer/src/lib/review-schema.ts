import { z } from "zod";

export const providerIds = ["gemini", "openrouter", "fake"] as const;
export const reviewerAgentIds = [
  "standard_reviewer",
  "hard_reviewer",
  "methodology_reviewer",
  "related_work_reviewer",
  "writing_reviewer"
] as const;
export const reviewAgentIds = [
  "paper_briefing",
  ...reviewerAgentIds,
  "ac_meta_reviewer",
  "improvement_analyzer"
] as const;

export const suggestionSchema = z.object({
  id: z.string().min(1),
  agent: z.enum(reviewAgentIds),
  targetType: z.enum(["general", "section", "sentence", "figure", "table"]),
  section: z.string().optional().default(""),
  anchorText: z.string().optional().default(""),
  pageHint: z.number().int().positive().optional(),
  severity: z.enum(["low", "medium", "high"]),
  confidence: z.number().min(0).max(1).default(0.5),
  rationale: z.string().min(1),
  action: z.string().min(1),
  rebuttalQuestion: z.string().optional().default("")
});

export const sourceSchema = z.object({
  title: z.string().min(1),
  url: z.string().url().optional(),
  note: z.string().optional().default("")
});

export const paperBriefSchema = z.object({
  title: z.string().default("Untitled paper"),
  oneSentenceSummary: z.string().default(""),
  claimedContributions: z.array(z.string()).default([]),
  methods: z.array(z.string()).default([]),
  experiments: z.array(z.string()).default([]),
  limitations: z.array(z.string()).default([])
});

export const agentReviewSchema = z.object({
  summary: z.string().default(""),
  strengths: z.array(z.string()).default([]),
  weaknesses: z.array(z.string()).default([]),
  questions: z.array(z.string()).default([]),
  recommendation: z.string().default(""),
  confidence: z.number().min(0).max(1).default(0.5)
});

export const roleReviewSchema = agentReviewSchema.extend({
  roleId: z.enum(reviewerAgentIds).default("standard_reviewer"),
  roleName: z.string().default(""),
  focusAreas: z.array(z.string()).default([])
});

export const debateRoundSchema = z.object({
  round: z.number().int().min(1).max(3),
  roleReviews: z.array(roleReviewSchema).default([])
});

export const metaReviewSchema = z.object({
  readiness: z.enum(["below_bar", "borderline", "near_bar", "above_bar"]),
  decisionRationale: z.string().default(""),
  mostImportantRisks: z.array(z.string()).default([]),
  highestLeverageFixes: z.array(z.string()).default([])
});

export const analyzerOutputSchema = z.object({
  improvementPlan: z.array(z.string()).default([]),
  suggestions: z.array(suggestionSchema).default([]),
  sources: z.array(sourceSchema).default([])
});

export const reviewOutputSchema = z.object({
  paperBrief: paperBriefSchema,
  standardReview: agentReviewSchema,
  hardReview: agentReviewSchema,
  roleReviews: z.array(roleReviewSchema).default([]),
  debateRounds: z.array(debateRoundSchema).default([]),
  metaReview: metaReviewSchema,
  improvementPlan: z.array(z.string()).default([]),
  suggestions: z.array(suggestionSchema).default([]),
  sources: z.array(sourceSchema).default([]),
  completeReview: z.string().default("")
});

export const textIndexItemSchema = z.object({
  id: z.string().min(1),
  pageNumber: z.number().int().positive(),
  text: z.string(),
  rawText: z.string().optional(),
  position: z.unknown().optional()
});

export const rebuttalTargetSchema = z.object({
  type: z.enum(["general", "suggestion", "selection"]),
  agent: z.enum(reviewAgentIds).optional(),
  suggestionId: z.string().optional(),
  selectedText: z.string().optional(),
  pageNumber: z.number().int().positive().optional(),
  position: z.unknown().optional()
});

export type ProviderId = (typeof providerIds)[number];
export type ReviewAgentId = (typeof reviewAgentIds)[number];
export type ReviewerAgentId = (typeof reviewerAgentIds)[number];
export type PaperBrief = z.infer<typeof paperBriefSchema>;
export type AgentReview = z.infer<typeof agentReviewSchema>;
export type RoleReview = z.infer<typeof roleReviewSchema>;
export type DebateRound = z.infer<typeof debateRoundSchema>;
export type MetaReview = z.infer<typeof metaReviewSchema>;
export type AnalyzerOutput = z.infer<typeof analyzerOutputSchema>;
export type ReviewSuggestion = z.infer<typeof suggestionSchema>;
export type ReviewOutput = z.infer<typeof reviewOutputSchema>;
export type TextIndexItem = z.infer<typeof textIndexItemSchema>;
export type RebuttalTarget = z.infer<typeof rebuttalTargetSchema>;

const reviewWrapperKeys = [
  "reviewOutput",
  "output",
  "result",
  "completeReview",
  "data"
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asString(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value;
  if (value == null) return fallback;
  if (Array.isArray(value)) return value.map((item) => asString(item)).join("\n");
  if (typeof value === "object") return JSON.stringify(value, null, 2);
  return String(value);
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return value ? [asString(value)] : [];
  return value.map((item) => asString(item)).filter(Boolean);
}

function unwrapReviewCandidate(value: unknown): unknown {
  let current = value;
  for (let depth = 0; depth < 4; depth += 1) {
    if (!isRecord(current)) return current;
    const parsed = reviewOutputSchema.safeParse(current);
    if (parsed.success) return current;

    const record = current;
    const wrapperKey = reviewWrapperKeys.find((key) => isRecord(record[key]));
    if (!wrapperKey) return current;
    current = record[wrapperKey];
  }
  return current;
}

function normalizeAgentReview(value: unknown): z.infer<typeof agentReviewSchema> {
  const record = isRecord(value) ? value : {};
  return {
    summary: asString(record.summary ?? record.overview),
    strengths: asStringArray(record.strengths ?? record.positivePoints),
    weaknesses: asStringArray(
      record.weaknesses ??
        record.concerns ??
        record.limitations ??
        record.rejection_risks ??
        record.rejectionRisks
    ),
    questions: asStringArray(
      record.questions ??
        record.authorQuestions ??
        record.author_questions ??
        record.questions_for_authors
    ),
    recommendation: asString(record.recommendation ?? record.rating ?? record.decision),
    confidence:
      typeof record.confidence === "number" && Number.isFinite(record.confidence)
        ? Math.max(0, Math.min(1, record.confidence))
        : 0.5
  };
}

function normalizeRoleReview(
  value: unknown,
  fallbackRoleId: ReviewerAgentId
): z.infer<typeof roleReviewSchema> {
  const record = isRecord(value) ? value : {};
  const normalized = normalizeAgentReview(value);
  const requestedRole = asString(
    record.roleId ?? record.agent ?? record.id ?? fallbackRoleId,
    fallbackRoleId
  );
  const roleId = reviewerAgentIds.includes(requestedRole as ReviewerAgentId)
    ? (requestedRole as ReviewerAgentId)
    : fallbackRoleId;

  return roleReviewSchema.parse({
    ...normalized,
    roleId,
    roleName: asString(record.roleName ?? record.name, defaultRoleName(roleId)),
    focusAreas: asStringArray(record.focusAreas ?? record.focus_areas)
  });
}

function defaultRoleName(roleId: ReviewerAgentId): string {
  switch (roleId) {
    case "standard_reviewer":
      return "Standard Reviewer";
    case "hard_reviewer":
      return "Hard Reviewer";
    case "methodology_reviewer":
      return "Methodology Reviewer";
    case "related_work_reviewer":
      return "Related Work Reviewer";
    case "writing_reviewer":
      return "Writing Reviewer";
  }
}

function normalizeMetaReview(value: unknown): z.infer<typeof metaReviewSchema> {
  const record = isRecord(value) ? value : {};
  const readiness = asString(
    record.readiness ?? record.decision ?? record.verdict ?? "borderline"
  )
    .toLowerCase()
    .replace(/\s+/g, "_");

  return {
    readiness:
      readiness === "below_bar" ||
      readiness === "near_bar" ||
      readiness === "above_bar" ||
      readiness === "borderline"
        ? readiness
        : "borderline",
    decisionRationale: asString(
      record.decisionRationale ?? record.rationale ?? record.summary ?? record.verdict
    ),
    mostImportantRisks: asStringArray(record.mostImportantRisks ?? record.risks),
    highestLeverageFixes: asStringArray(
      record.highestLeverageFixes ??
        record.highest_leverage_fixes ??
        record.fixes ??
        record.suggestions_to_address
    )
  };
}

function normalizeSuggestions(value: unknown): ReviewSuggestion[] {
  if (!Array.isArray(value)) return [];
  return value.map((item, index) => {
    const record = isRecord(item) ? item : {};
    const agent = asString(record.agent || "improvement_analyzer");
    const targetType = asString(record.targetType || record.type || "general");
    const severity = asString(record.severity || "medium");

    return suggestionSchema.parse({
      id: asString(record.id || `suggestion-${index + 1}`),
      agent: reviewAgentIds.includes(agent as ReviewAgentId)
        ? agent
        : "improvement_analyzer",
      targetType: ["general", "section", "sentence", "figure", "table"].includes(targetType)
        ? targetType
        : "general",
      section: asString(record.section),
      anchorText: asString(record.anchorText ?? record.anchor),
      pageHint: typeof record.pageHint === "number" ? record.pageHint : undefined,
      severity: ["low", "medium", "high"].includes(severity) ? severity : "medium",
      confidence:
        typeof record.confidence === "number" && Number.isFinite(record.confidence)
          ? Math.max(0, Math.min(1, record.confidence))
          : 0.5,
      rationale: asString(record.rationale ?? record.comment ?? record.issue, "Review issue"),
      action: asString(record.action ?? record.suggestion ?? record.fix, "Revise this point."),
      rebuttalQuestion: asString(record.rebuttalQuestion)
    });
  });
}

function suggestionFromText(
  text: string,
  index: number,
  agent: ReviewAgentId,
  severity: "low" | "medium" | "high" = "medium"
): ReviewSuggestion {
  return suggestionSchema.parse({
    id: `${agent}-derived-${index + 1}`,
    agent,
    targetType: "general",
    section: "",
    anchorText: extractLikelyAnchor(text),
    severity,
    confidence: 0.55,
    rationale: text,
    action: text,
    rebuttalQuestion: "Where does the paper already address this concern?"
  });
}

function suggestionText(suggestion: ReviewSuggestion): string {
  return [suggestion.rationale, suggestion.action].filter(Boolean).join(" Action: ");
}

function fallbackSummary(items: string[], label: string): string {
  if (!items.length) return "";
  return `${label} found ${items.length} concrete concern${
    items.length === 1 ? "" : "s"
  }; see the listed items below.`;
}

function extractLikelyAnchor(text: string): string {
  const quoted = text.match(/["'“‘]([^"'”’]{16,160})["'”’]/)?.[1];
  if (quoted) return quoted;

  const tableClaim = text.match(
    /([A-Z][^.!?]*(?:Table|Figure|Section|Appendix|claim|improvement|coverage|baseline|benchmark)[^.!?]{12,180})/i
  )?.[1];
  if (tableClaim) return tableClaim;

  return text
    .replace(/\([^)]*\)/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
}

function looksLikeJsonText(value: string): boolean {
  const trimmed = value.trim();
  return (
    trimmed.startsWith("{") ||
    trimmed.startsWith("[") ||
    trimmed.startsWith("```json") ||
    trimmed.startsWith("```")
  );
}

function formatList(items: string[]): string {
  return items.length ? items.map((item) => `- ${item}`).join("\n") : "- Not specified";
}

function buildReadableReview(output: Omit<ReviewOutput, "completeReview">): string {
  const specialistReviews = output.roleReviews
    .filter(
      (review) =>
        review.roleId !== "standard_reviewer" && review.roleId !== "hard_reviewer"
    )
    .map(
      (review) => `${review.roleName || defaultRoleName(review.roleId)}
Summary: ${review.summary || "Not specified"}
Key concerns
${formatList(review.weaknesses)}
Questions
${formatList(review.questions)}`
    );

  return `Paper Brief
Title: ${output.paperBrief.title}
Summary: ${output.paperBrief.oneSentenceSummary || "Not specified"}

Claimed Contributions
${formatList(output.paperBrief.claimedContributions)}

Standard Review
Summary: ${output.standardReview.summary || "Not specified"}

Strengths
${formatList(output.standardReview.strengths)}

Weaknesses
${formatList(output.standardReview.weaknesses)}

Questions
${formatList(output.standardReview.questions)}

Recommendation
${output.standardReview.recommendation || "Not specified"} (confidence ${Math.round(
    output.standardReview.confidence * 100
  )}%)

Hard Reviewer Risks
${formatList(output.hardReview.weaknesses)}

Specialist Reviewer Notes
${specialistReviews.length ? specialistReviews.join("\n\n") : "- Not specified"}

Area Chair Assessment
Readiness: ${output.metaReview.readiness.replace("_", " ")}
Rationale: ${output.metaReview.decisionRationale || "Not specified"}

Highest Leverage Fixes
${formatList(output.metaReview.highestLeverageFixes)}

Improvement Plan
${formatList(output.improvementPlan)}`;
}

export function normalizeReviewOutputCandidate(
  value: unknown,
  rawText = ""
): ReviewOutput | null {
  const unwrapped = unwrapReviewCandidate(value);
  const strict = reviewOutputSchema.safeParse(unwrapped);
  if (strict.success) {
    if (!looksLikeJsonText(strict.data.completeReview)) return strict.data;
    const { completeReview: _completeReview, ...withoutCompleteReview } = strict.data;
    return {
      ...strict.data,
      completeReview: buildReadableReview(withoutCompleteReview)
    };
  }
  if (!isRecord(unwrapped)) return null;

  const reviewObject = isRecord(unwrapped.review) ? unwrapped.review : {};
  const topLevelRoleId = reviewerAgentIds.includes(asString(unwrapped.roleId) as ReviewerAgentId)
    ? (asString(unwrapped.roleId) as ReviewerAgentId)
    : null;
  const standardReviewSource =
    unwrapped.standardReview ??
    unwrapped.standard_review ??
    reviewObject.standardReview ??
    reviewObject.standard_review ??
    (topLevelRoleId === "standard_reviewer" ? unwrapped : undefined) ??
    reviewObject;
  const hardReviewSource =
    unwrapped.hardReview ??
    unwrapped.hard_review ??
    unwrapped.hardReviewerReview ??
    reviewObject.hardReview ??
    reviewObject.hard_review ??
    (topLevelRoleId === "hard_reviewer" ? unwrapped : undefined);
  const metaReviewSource =
    unwrapped.metaReview ??
    unwrapped.meta_review ??
    unwrapped.acReview ??
    unwrapped.ac_review ??
    unwrapped.areaChairReview ??
    reviewObject.metaReview ??
    reviewObject.meta_review ??
    reviewObject.acReview ??
    reviewObject.ac_review;
  const standardReview = normalizeAgentReview(standardReviewSource);
  const hardReview = normalizeAgentReview(hardReviewSource);
  const metaReview = normalizeMetaReview(metaReviewSource);
  const improvementPlan = asStringArray(
    unwrapped.improvementPlan ??
      unwrapped.improvement_plan ??
      unwrapped.recommendations ??
      (isRecord(hardReviewSource) ? hardReviewSource.suggestions_to_address : undefined)
  );
  const explicitSuggestions = normalizeSuggestions(
    unwrapped.suggestions ??
      unwrapped.actionItems ??
      (isRecord(hardReviewSource) ? hardReviewSource.suggestions_to_address : undefined)
  );
  const suggestionConcerns = explicitSuggestions.map(suggestionText);
  const hardSuggestionConcerns = explicitSuggestions
    .filter(
      (suggestion) =>
        suggestion.agent === "hard_reviewer" ||
        suggestion.agent === "ac_meta_reviewer" ||
        suggestion.severity === "high"
    )
    .map(suggestionText);
  const standardSuggestionConcerns = explicitSuggestions
    .filter(
      (suggestion) =>
        suggestion.agent === "standard_reviewer" ||
        (suggestion.severity !== "high" && suggestion.agent !== "hard_reviewer")
    )
    .map(suggestionText);
  const effectiveStandardReview = agentReviewSchema.parse({
    ...standardReview,
    summary:
      standardReview.summary ||
      fallbackSummary(standardSuggestionConcerns, "The standard reviewer"),
    weaknesses: standardReview.weaknesses.length
      ? standardReview.weaknesses
      : standardSuggestionConcerns,
    questions: standardReview.questions.length
      ? standardReview.questions
      : explicitSuggestions
          .filter((suggestion) => suggestion.rebuttalQuestion)
          .map((suggestion) => suggestion.rebuttalQuestion),
    recommendation:
      standardReview.recommendation ||
      asString(
        isRecord(reviewObject.standard_review)
          ? reviewObject.standard_review.recommendation
          : undefined
      )
  });
  const effectiveHardReview = agentReviewSchema.parse({
    ...hardReview,
    summary: hardReview.summary || fallbackSummary(hardSuggestionConcerns, "The hard reviewer"),
    weaknesses: hardReview.weaknesses.length ? hardReview.weaknesses : hardSuggestionConcerns,
    questions: hardReview.questions.length
      ? hardReview.questions
      : explicitSuggestions
          .filter((suggestion) => suggestion.agent === "hard_reviewer")
          .map((suggestion) => suggestion.rebuttalQuestion)
          .filter(Boolean)
  });
  const effectiveMetaReview = metaReviewSchema.parse({
    ...metaReview,
    decisionRationale:
      metaReview.decisionRationale ||
      fallbackSummary(
        metaReview.mostImportantRisks.length
          ? metaReview.mostImportantRisks
          : hardSuggestionConcerns,
        "The area chair"
      ),
    mostImportantRisks: metaReview.mostImportantRisks.length
      ? metaReview.mostImportantRisks
      : hardSuggestionConcerns,
    highestLeverageFixes: metaReview.highestLeverageFixes.length
      ? metaReview.highestLeverageFixes
      : improvementPlan.length
        ? improvementPlan
        : suggestionConcerns
  });
  const explicitRoleReviews = Array.isArray(unwrapped.roleReviews)
    ? unwrapped.roleReviews.map((item, index) =>
        normalizeRoleReview(item, reviewerAgentIds[index] ?? "standard_reviewer")
      )
    : topLevelRoleId
      ? [normalizeRoleReview(unwrapped, topLevelRoleId)]
      : [];
  const roleReviews = explicitRoleReviews.length
    ? explicitRoleReviews
    : [
        normalizeRoleReview(
          {
            ...effectiveStandardReview,
            roleId: "standard_reviewer",
            roleName: defaultRoleName("standard_reviewer")
          },
          "standard_reviewer"
        ),
        normalizeRoleReview(
          {
            ...effectiveHardReview,
            roleId: "hard_reviewer",
            roleName: defaultRoleName("hard_reviewer")
          },
          "hard_reviewer"
        )
      ];
  const derivedSuggestions = [
    ...effectiveStandardReview.weaknesses.map((item, index) =>
      suggestionFromText(item, index, "standard_reviewer", "medium")
    ),
    ...effectiveHardReview.weaknesses.map((item, index) =>
      suggestionFromText(item, index, "hard_reviewer", "high")
    ),
    ...asStringArray(
      isRecord(hardReviewSource) ? hardReviewSource.suggestions_to_address : undefined
    ).map((item, index) => suggestionFromText(item, index, "improvement_analyzer", "high")),
    ...effectiveMetaReview.highestLeverageFixes.map((item, index) =>
      suggestionFromText(item, index, "ac_meta_reviewer", "high")
    )
  ];

  const normalizedWithoutCompleteReview = {
    paperBrief: {
      title: asString(
        isRecord(unwrapped.paperBrief) ? unwrapped.paperBrief.title : unwrapped.title,
        "Uploaded paper"
      ),
      oneSentenceSummary: asString(
        isRecord(unwrapped.paperBrief)
          ? unwrapped.paperBrief.oneSentenceSummary ?? unwrapped.paperBrief.summary
          : topLevelRoleId
            ? reviewObject.summary
            : unwrapped.summary ?? reviewObject.summary
      ),
      claimedContributions: asStringArray(
        isRecord(unwrapped.paperBrief)
          ? unwrapped.paperBrief.claimedContributions
          : unwrapped.claimedContributions
      ),
      methods: asStringArray(isRecord(unwrapped.paperBrief) ? unwrapped.paperBrief.methods : []),
      experiments: asStringArray(
        isRecord(unwrapped.paperBrief) ? unwrapped.paperBrief.experiments : []
      ),
      limitations: asStringArray(
        isRecord(unwrapped.paperBrief) ? unwrapped.paperBrief.limitations : []
      )
    },
    standardReview: effectiveStandardReview,
    hardReview: effectiveHardReview,
    roleReviews,
    debateRounds: Array.isArray(unwrapped.debateRounds)
      ? unwrapped.debateRounds
      : Array.isArray(unwrapped.debate_rounds)
        ? unwrapped.debate_rounds
        : [],
    metaReview: effectiveMetaReview,
    improvementPlan,
    suggestions: explicitSuggestions.length ? explicitSuggestions : derivedSuggestions,
    sources: Array.isArray(unwrapped.sources)
      ? unwrapped.sources
          .map((source) => {
            const record = isRecord(source) ? source : {};
            return sourceSchema.safeParse({
              title: asString(record.title || record.name, "Source"),
              url: typeof record.url === "string" ? record.url : undefined,
              note: asString(record.note ?? record.description)
            });
          })
          .filter((result) => result.success)
          .map((result) => result.data)
      : [],
  };

  const providedCompleteReview = asString(
    unwrapped.completeReview ?? unwrapped.fullReview ?? unwrapped.reviewText
  );
  const completeReview =
    providedCompleteReview && !looksLikeJsonText(providedCompleteReview)
      ? providedCompleteReview
      : buildReadableReview(normalizedWithoutCompleteReview);

  const normalized = {
    ...normalizedWithoutCompleteReview,
    completeReview
  };

  return reviewOutputSchema.parse(normalized);
}

const stringArrayJsonSchema = { type: "array", items: { type: "string" } } as const;

export const paperBriefJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "title",
    "oneSentenceSummary",
    "claimedContributions",
    "methods",
    "experiments",
    "limitations"
  ],
  properties: {
    title: { type: "string" },
    oneSentenceSummary: { type: "string" },
    claimedContributions: stringArrayJsonSchema,
    methods: stringArrayJsonSchema,
    experiments: stringArrayJsonSchema,
    limitations: stringArrayJsonSchema
  }
} as const;

export const agentReviewJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "summary",
    "strengths",
    "weaknesses",
    "questions",
    "recommendation",
    "confidence"
  ],
  properties: {
    summary: { type: "string" },
    strengths: stringArrayJsonSchema,
    weaknesses: stringArrayJsonSchema,
    questions: stringArrayJsonSchema,
    recommendation: { type: "string" },
    confidence: { type: "number", minimum: 0, maximum: 1 }
  }
} as const;

export const roleReviewJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "roleId",
    "roleName",
    "focusAreas",
    "summary",
    "strengths",
    "weaknesses",
    "questions",
    "recommendation",
    "confidence"
  ],
  properties: {
    roleId: { type: "string", enum: reviewerAgentIds },
    roleName: { type: "string" },
    focusAreas: stringArrayJsonSchema,
    ...agentReviewJsonSchema.properties
  }
} as const;

export const metaReviewJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "readiness",
    "decisionRationale",
    "mostImportantRisks",
    "highestLeverageFixes"
  ],
  properties: {
    readiness: {
      type: "string",
      enum: ["below_bar", "borderline", "near_bar", "above_bar"]
    },
    decisionRationale: { type: "string" },
    mostImportantRisks: stringArrayJsonSchema,
    highestLeverageFixes: stringArrayJsonSchema
  }
} as const;

export const suggestionJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "agent",
    "targetType",
    "section",
    "anchorText",
    "severity",
    "confidence",
    "rationale",
    "action",
    "rebuttalQuestion"
  ],
  properties: {
    id: { type: "string" },
    agent: { type: "string", enum: reviewAgentIds },
    targetType: {
      type: "string",
      enum: ["general", "section", "sentence", "figure", "table"]
    },
    section: { type: "string" },
    anchorText: { type: "string" },
    pageHint: { type: "number" },
    severity: { type: "string", enum: ["low", "medium", "high"] },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    rationale: { type: "string" },
    action: { type: "string" },
    rebuttalQuestion: { type: "string" }
  }
} as const;

export const sourceJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["title", "note"],
  properties: {
    title: { type: "string" },
    url: { type: "string" },
    note: { type: "string" }
  }
} as const;

export const analyzerOutputJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["improvementPlan", "suggestions", "sources"],
  properties: {
    improvementPlan: stringArrayJsonSchema,
    suggestions: {
      type: "array",
      items: suggestionJsonSchema
    },
    sources: {
      type: "array",
      items: sourceJsonSchema
    }
  }
} as const;

export const reviewOutputJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "paperBrief",
    "standardReview",
    "hardReview",
    "roleReviews",
    "debateRounds",
    "metaReview",
    "improvementPlan",
    "suggestions",
    "sources",
    "completeReview"
  ],
  properties: {
    paperBrief: paperBriefJsonSchema,
    standardReview: agentReviewJsonSchema,
    hardReview: agentReviewJsonSchema,
    roleReviews: {
      type: "array",
      items: roleReviewJsonSchema
    },
    debateRounds: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["round", "roleReviews"],
        properties: {
          round: { type: "number", minimum: 1, maximum: 3 },
          roleReviews: {
            type: "array",
            items: roleReviewJsonSchema
          }
        }
      }
    },
    metaReview: metaReviewJsonSchema,
    improvementPlan: stringArrayJsonSchema,
    suggestions: {
      type: "array",
      items: suggestionJsonSchema
    },
    sources: {
      type: "array",
      items: sourceJsonSchema
    },
    completeReview: { type: "string" }
  }
} as const;
