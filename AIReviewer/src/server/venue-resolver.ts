import fs from "node:fs/promises";
import path from "node:path";

import {
  getVenue,
  venueIds,
  type VenueConfig,
  type VenueId,
  type VenueMode
} from "@/lib/venues";
import { resolveFromCwd, serverEnv } from "@/server/env";

export type VenueSelection = {
  venueMode?: VenueMode;
  venueId?: VenueId;
  customVenueName?: string;
  customVenueTemplatePath?: string;
};

const customReviewForm = [
  "Summary",
  "Strengths",
  "Weaknesses",
  "Questions for authors",
  "Recommendation and confidence",
  "Actionable improvement advice"
];

export async function resolveVenueConfig(
  selection: VenueSelection
): Promise<VenueConfig> {
  const venueMode = selection.venueMode ?? serverEnv.venueMode;

  if (venueMode === "custom_template") {
    return loadCustomTemplateVenue(selection);
  }

  const venueId = venueIds.includes(selection.venueId ?? (serverEnv.venueId as VenueId))
    ? selection.venueId ?? (serverEnv.venueId as VenueId)
    : "neurips";
  return getVenue(venueId);
}

async function loadCustomTemplateVenue(
  selection: VenueSelection
): Promise<VenueConfig> {
  const templatePath = (
    selection.customVenueTemplatePath || serverEnv.customVenueTemplatePath
  ).trim();
  if (!templatePath) {
    throw new Error("Custom venue template path is required for markdown template mode.");
  }

  if (path.extname(templatePath).toLowerCase() !== ".md") {
    throw new Error("Custom venue template path must point to a .md file.");
  }

  const resolvedPath = resolveFromCwd(templatePath);
  const rubric = await fs.readFile(resolvedPath, "utf8");
  const fallbackName = path.basename(resolvedPath, ".md");
  const name = (
    selection.customVenueName ||
    serverEnv.customVenueName ||
    fallbackName
  ).trim();

  return {
    id: `custom:${name}`,
    name,
    guidelineUrls: [],
    rubric,
    reviewForm: customReviewForm
  };
}
