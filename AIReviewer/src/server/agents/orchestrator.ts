import { randomUUID } from "node:crypto";

import { and, eq } from "drizzle-orm";

import { resolveSuggestionAnchors } from "@/lib/anchors";
import {
  analyzerOutputJsonSchema,
  analyzerOutputSchema,
  metaReviewJsonSchema,
  metaReviewSchema,
  paperBriefJsonSchema,
  paperBriefSchema,
  reviewOutputSchema,
  roleReviewJsonSchema,
  roleReviewSchema,
  type DebateRound,
  type ProviderId,
  type ReviewAgentId,
  type ReviewOutput,
  type RoleReview,
  type TextIndexItem
} from "@/lib/review-schema";
import type { VenueId, VenueMode } from "@/lib/venues";
import {
  buildAnalyzerPrompt,
  buildBriefingPrompt,
  buildMetaReviewerPrompt,
  buildReviewerDebatePrompt,
  buildReviewerRolePrompt,
  buildSystemPrompt,
  composeCompleteReview
} from "@/server/agents/prompts";
import { reviewerRoles } from "@/server/agents/roles";
import { getDb, now } from "@/server/db/client";
import {
  agentOutputs,
  annotations,
  memorySummaries,
  papers,
  reviewRuns,
  textIndex
} from "@/server/db/schema";
import { serverEnv } from "@/server/env";
import { getMemoryContext } from "@/server/memory";
import { getProvider } from "@/server/providers";
import type { PaperAttachment } from "@/server/providers/types";
import { resolveVenueConfig } from "@/server/venue-resolver";

export type ReviewProgress = {
  step: string;
  status: "running" | "complete" | "error";
  message: string;
  review?: ReviewOutput;
  rawReview?: string;
};

export type RunReviewArgs = {
  paperId: string;
  venueMode?: VenueMode;
  venueId: VenueId;
  customVenueName?: string;
  customVenueTemplatePath?: string;
  reviewContext?: string;
  providerId: ProviderId;
  searchEnabled: boolean;
  onProgress?: (event: ReviewProgress) => void | Promise<void>;
};

export type RunReviewResult = {
  reviewRunId: string;
  output: ReviewOutput;
  annotations: Array<typeof annotations.$inferSelect>;
};

type StoredAgentOutput = {
  agent: ReviewAgentId;
  rawOutput: string;
  parsedOutput: unknown;
};

async function progress(
  args: RunReviewArgs,
  event: ReviewProgress
): Promise<void> {
  await args.onProgress?.(event);
}

export async function runReview(args: RunReviewArgs): Promise<RunReviewResult> {
  const db = await getDb();
  const [paper] = await db.select().from(papers).where(eq(papers.id, args.paperId));
  if (!paper) throw new Error("Paper not found.");

  const venue = await resolveVenueConfig(args);
  const provider = getProvider(args.providerId);
  const reviewRunId = randomUUID();
  const createdAt = now();
  const storedAgentOutputs: StoredAgentOutput[] = [];

  await db.insert(reviewRuns).values({
    id: reviewRunId,
    paperId: args.paperId,
    venueId: venue.id,
    provider: provider.id,
    model: provider.model,
    searchEnabled: args.searchEnabled,
    status: "running",
    progress: [],
    output: null,
    error: null,
    createdAt,
    updatedAt: createdAt
  });

  try {
    await progress(args, {
      step: "briefing",
      status: "running",
      message: "Preparing venue rubric, PDF attachment, and memory context."
    });

    const attachment: PaperAttachment = {
      localPath: paper.localPath,
      originalName: paper.originalName,
      mimeType: paper.mimeType,
      providerFileUri: paper.providerFileUri,
      providerMimeType: paper.providerMimeType
    };
    const memory = await getMemoryContext(args.paperId);
    const systemPrompt = buildSystemPrompt(venue);

    const briefingGenerated = await provider.generateStructured({
      systemPrompt,
      userPrompt: buildBriefingPrompt({
        venue,
        priorMemory: memory
      }),
      paper: attachment,
      searchEnabled: false,
      schema: paperBriefSchema,
      jsonSchema: paperBriefJsonSchema
    });
    const paperBrief = paperBriefSchema.parse(briefingGenerated.parsed);
    storedAgentOutputs.push({
      agent: "paper_briefing",
      rawOutput: briefingGenerated.raw,
      parsedOutput: paperBrief
    });

    await progress(args, {
      step: "agents",
      status: "running",
      message: `Running ${reviewerRoles.length} independent reviewer roles.`
    });

    const roleResults = await Promise.all(
      reviewerRoles.map(async (role) => {
        const generated = await provider.generateStructured({
          systemPrompt,
          userPrompt: buildReviewerRolePrompt({
            venue,
            role,
            paperBrief,
            priorMemory: memory,
            searchEnabled: args.searchEnabled
          }),
          paper: attachment,
          searchEnabled: Boolean(args.searchEnabled && role.usesSearch),
          schema: roleReviewSchema,
          jsonSchema: roleReviewJsonSchema
        });
        const parsed = roleReviewSchema.parse({
          ...generated.parsed,
          roleId: role.id,
          roleName: role.name,
          focusAreas: generated.parsed.focusAreas.length
            ? generated.parsed.focusAreas
            : role.focusAreas
        });

        return {
          agent: role.id,
          rawOutput: generated.raw,
          parsedOutput: parsed,
          roleReview: parsed
        };
      })
    );

    storedAgentOutputs.push(
      ...roleResults.map((result) => ({
        agent: result.agent,
        rawOutput: result.rawOutput,
        parsedOutput: result.parsedOutput
      }))
    );
    let roleReviews = roleResults.map((result) => result.roleReview);

    const debateRounds: DebateRound[] = [];
    const debateRoundCount = serverEnv.debateRounds;
    for (let round = 1; round <= debateRoundCount; round += 1) {
      await progress(args, {
        step: `debate-${round}`,
        status: "running",
        message: `Running multi-agent debate round ${round} of ${debateRoundCount}.`
      });

      const currentRoleReviews = roleReviews;
      const roundResults = await Promise.all(
        reviewerRoles.map(async (role) => {
          const ownPriorReview = findRoleReview(currentRoleReviews, role.id);
          const generated = await provider.generateStructured({
            systemPrompt,
            userPrompt: buildReviewerDebatePrompt({
              venue,
              role,
              paperBrief,
              round,
              totalRounds: debateRoundCount,
              ownPriorReview,
              currentRoleReviews,
              debateRounds,
              priorMemory: memory
            }),
            paper: attachment,
            searchEnabled: false,
            schema: roleReviewSchema,
            jsonSchema: roleReviewJsonSchema
          });
          const parsed = roleReviewSchema.parse({
            ...generated.parsed,
            roleId: role.id,
            roleName: role.name,
            focusAreas: generated.parsed.focusAreas.length
              ? generated.parsed.focusAreas
              : role.focusAreas
          });

          return {
            agent: role.id,
            rawOutput: generated.raw,
            parsedOutput: { round, roleReview: parsed },
            roleReview: parsed
          };
        })
      );

      roleReviews = roundResults.map((result) => result.roleReview);
      debateRounds.push({ round, roleReviews });
      storedAgentOutputs.push(
        ...roundResults.map((result) => ({
          agent: result.agent,
          rawOutput: result.rawOutput,
          parsedOutput: result.parsedOutput
        }))
      );
    }

    await progress(args, {
      step: "meta",
      status: "running",
      message: "Synthesizing debated reviewer positions into an AC-style readiness assessment."
    });

    const metaGenerated = await provider.generateStructured({
      systemPrompt,
      userPrompt: buildMetaReviewerPrompt({
        venue,
        paperBrief,
        roleReviews,
        debateRounds,
        reviewContext: args.reviewContext
      }),
      paper: attachment,
      searchEnabled: false,
      schema: metaReviewSchema,
      jsonSchema: metaReviewJsonSchema
    });
    const metaReview = metaReviewSchema.parse(metaGenerated.parsed);
    storedAgentOutputs.push({
      agent: "ac_meta_reviewer",
      rawOutput: metaGenerated.raw,
      parsedOutput: metaReview
    });

    await progress(args, {
      step: "analysis",
      status: "running",
      message: "Turning role findings into concrete fixes and annotation anchors."
    });

    const analyzerGenerated = await provider.generateStructured({
      systemPrompt,
      userPrompt: buildAnalyzerPrompt({
        venue,
        paperBrief,
        roleReviews,
        debateRounds,
        metaReview,
        searchEnabled: args.searchEnabled,
        reviewContext: args.reviewContext
      }),
      paper: attachment,
      searchEnabled: args.searchEnabled,
      schema: analyzerOutputSchema,
      jsonSchema: analyzerOutputJsonSchema
    });
    const analyzer = analyzerOutputSchema.parse(analyzerGenerated.parsed);
    storedAgentOutputs.push({
      agent: "improvement_analyzer",
      rawOutput: analyzerGenerated.raw,
      parsedOutput: analyzer
    });

    const standardReview = findRoleReview(roleReviews, "standard_reviewer");
    const hardReview = findRoleReview(roleReviews, "hard_reviewer");
    const rawReview = formatRawAgentOutputs(storedAgentOutputs);
    const output = reviewOutputSchema.parse({
      paperBrief,
      standardReview,
      hardReview,
      roleReviews,
      debateRounds,
      metaReview,
      improvementPlan: analyzer.improvementPlan,
      suggestions: analyzer.suggestions,
      sources: analyzer.sources,
      completeReview: composeCompleteReview({
        venue,
        paperBrief,
        roleReviews,
        debateRounds,
        metaReview,
        analyzer
      })
    });
    const normalizedOutput = normalizeSuggestionIds(output);

    await progress(args, {
      step: "review",
      status: "complete",
      message: "Multi-agent review parsed. Showing review before PDF annotation matching.",
      review: normalizedOutput,
      rawReview
    });

    await progress(args, {
      step: "annotations",
      status: "running",
      message: "Resolving suggestion anchors against extracted PDF text."
    });

    const indexRows = await db
      .select()
      .from(textIndex)
      .where(eq(textIndex.paperId, args.paperId));
    const textItems: TextIndexItem[] = indexRows.map((item) => ({
      id: item.id,
      pageNumber: item.pageNumber,
      text: item.text,
      rawText: item.rawText ?? undefined,
      position: item.position ?? undefined
    }));
    const matches = resolveSuggestionAnchors(normalizedOutput.suggestions, textItems);

    const annotationRows = matches.map((match) => {
      const suggestion = normalizedOutput.suggestions.find(
        (item) => item.id === match.suggestionId
      );
      return {
        id: randomUUID(),
        paperId: args.paperId,
        reviewRunId,
        suggestionId: match.suggestionId,
        textIndexId: match.textIndexId,
        type: "text",
        position: match.position,
        content: {
          text: match.matchedText,
          comment: suggestion?.action ?? "",
          severity: suggestion?.severity ?? "medium"
        },
        score: match.score,
        createdAt: now()
      };
    });

    if (annotationRows.length) {
      await db.insert(annotations).values(annotationRows);
    }

    for (const agentOutput of storedAgentOutputs) {
      await db.insert(agentOutputs).values({
        id: randomUUID(),
        reviewRunId,
        agent: agentOutput.agent,
        rawOutput: agentOutput.rawOutput,
        parsedOutput: agentOutput.parsedOutput,
        createdAt: now()
      });
    }

    await db.insert(memorySummaries).values({
      id: randomUUID(),
      paperId: args.paperId,
      reviewRunId,
      summary: `Initial review for ${venue.name}: ${normalizedOutput.metaReview.decisionRationale}`,
      tokenEstimate: Math.ceil(normalizedOutput.completeReview.length / 4),
      createdAt: now()
    });

    await db
      .update(reviewRuns)
      .set({
        status: "complete",
        output: normalizedOutput,
        updatedAt: now()
      })
      .where(eq(reviewRuns.id, reviewRunId));

    await progress(args, {
      step: "complete",
      status: "complete",
      message: "Review complete."
    });

    const persistedAnnotations = annotationRows.length
      ? await db
          .select()
          .from(annotations)
          .where(
            and(
              eq(annotations.paperId, args.paperId),
              eq(annotations.reviewRunId, reviewRunId)
            )
          )
      : [];

    return {
      reviewRunId,
      output: normalizedOutput,
      annotations: persistedAnnotations
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Review failed.";
    await db
      .update(reviewRuns)
      .set({
        status: "error",
        error: message,
        updatedAt: now()
      })
      .where(eq(reviewRuns.id, reviewRunId));

    throw error;
  }
}

function normalizeSuggestionIds(output: ReviewOutput): ReviewOutput {
  return {
    ...output,
    suggestions: output.suggestions.map((suggestion, index) => ({
      ...suggestion,
      id: suggestion.id || `suggestion-${index + 1}`
    }))
  };
}

function findRoleReview(roleReviews: RoleReview[], roleId: RoleReview["roleId"]): RoleReview {
  const roleReview = roleReviews.find((review) => review.roleId === roleId);
  if (roleReview) return roleReview;
  if (roleReviews[0]) return roleReviews[0];
  return roleReviewSchema.parse({
    roleId,
    roleName: roleId,
    focusAreas: [],
    summary: "",
    strengths: [],
    weaknesses: [],
    questions: [],
    recommendation: "",
    confidence: 0.5
  });
}

function formatRawAgentOutputs(outputs: StoredAgentOutput[]): string {
  return outputs
    .map((output) => `## ${output.agent}\n${output.rawOutput}`)
    .join("\n\n");
}
