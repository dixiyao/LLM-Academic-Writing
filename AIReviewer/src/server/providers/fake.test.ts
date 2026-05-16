import { describe, expect, it } from "vitest";

import {
  analyzerOutputSchema,
  paperBriefSchema,
  reviewOutputSchema,
  roleReviewSchema
} from "@/lib/review-schema";
import { FakeProvider } from "@/server/providers/fake";

describe("FakeProvider", () => {
  it("returns a valid structured review output", async () => {
    const provider = new FakeProvider();
    const result = await provider.generateStructured({
      systemPrompt: "review",
      userPrompt: "review this paper",
      schema: reviewOutputSchema
    });

    expect(result.parsed.suggestions.length).toBeGreaterThan(0);
    expect(result.parsed.roleReviews.length).toBeGreaterThanOrEqual(5);
    expect(result.parsed.completeReview).toContain("Review outline");
  });

  it("returns schema-specific fake outputs for orchestrated agent calls", async () => {
    const provider = new FakeProvider();
    const briefing = await provider.generateStructured({
      systemPrompt: "review",
      userPrompt: "brief the paper",
      schema: paperBriefSchema
    });
    const methodology = await provider.generateStructured({
      systemPrompt: "review",
      userPrompt: "Role id: methodology_reviewer",
      schema: roleReviewSchema
    });
    const analyzer = await provider.generateStructured({
      systemPrompt: "review",
      userPrompt: "analyze improvements",
      schema: analyzerOutputSchema
    });

    expect(briefing.parsed.title).toBe("Sample Uploaded Paper");
    expect(methodology.parsed.roleId).toBe("methodology_reviewer");
    expect(methodology.parsed.weaknesses.join(" ")).toMatch(/stress test/i);
    expect(analyzer.parsed.suggestions.some((item) => item.agent === "writing_reviewer")).toBe(
      true
    );
  });
});
