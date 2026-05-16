export const venueIds = ["iclr", "neurips", "icml"] as const;
export const venueModes = ["preset", "custom_template"] as const;

export type VenueId = (typeof venueIds)[number];
export type VenueMode = (typeof venueModes)[number];

export type VenueConfig = {
  id: string;
  name: string;
  guidelineUrls: string[];
  rubric: string;
  reviewForm: string[];
};

export const venues: Record<VenueId, VenueConfig> = {
  iclr: {
    id: "iclr",
    name: "ICLR 2026",
    guidelineUrls: ["https://iclr.cc/Conferences/2026/ReviewerGuide"],
    rubric:
      "ICLR reviews should be substantive, constructive, comprehensive, and clear about the core reasons for the recommendation. Reviews should summarize the contribution, list strengths and weaknesses, ask clarifying questions, and separate decision-critical concerns from improvement feedback.",
    reviewForm: [
      "Summary of claimed contributions",
      "Strengths",
      "Weaknesses",
      "Initial recommendation and rationale",
      "Questions for authors",
      "Additional improvement feedback"
    ]
  },
  neurips: {
    id: "neurips",
    name: "NeurIPS 2026",
    guidelineUrls: ["https://neurips.cc/Conferences/2026/ReviewerGuidelines"],
    rubric:
      "NeurIPS reviews should evaluate quality, clarity, significance, and originality according to the contribution type. Technical soundness, support for claims, reproducibility, and useful community impact are central. Originality can include new insights, evaluations, framings, data, or combinations of existing techniques.",
    reviewForm: [
      "Quality",
      "Clarity",
      "Significance",
      "Originality",
      "Questions for authors",
      "Actionable improvement advice"
    ]
  },
  icml: {
    id: "icml",
    name: "ICML 2026",
    guidelineUrls: [
      "https://icml.cc/Conferences/2026/ReviewerInstructions",
      "https://icml.cc/Conferences/2026/LLM-Policy"
    ],
    rubric:
      "ICML reviewers should read carefully, critically, and with empathy. The review should focus on technical correctness, empirical evidence, clarity, relevance to machine learning, ethics issues when applicable, and questions that help authors address uncertainty.",
    reviewForm: [
      "Summary",
      "Main strengths",
      "Main weaknesses",
      "Correctness and empirical support",
      "Questions for authors",
      "Recommendation and confidence"
    ]
  }
};

export function getVenue(id: string): VenueConfig {
  if (venueIds.includes(id as VenueId)) {
    return venues[id as VenueId];
  }
  throw new Error(`Unsupported venue: ${id}`);
}
