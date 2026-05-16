import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { resolveVenueConfig } from "@/server/venue-resolver";

let tempDir: string | null = null;

afterEach(async () => {
  if (tempDir) {
    await fs.rm(tempDir, { force: true, recursive: true });
    tempDir = null;
  }
});

describe("resolveVenueConfig", () => {
  it("loads custom venue guidelines from a markdown template", async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "aireviewer-venue-"));
    const templatePath = path.join(tempDir, "chi-review.md");
    await fs.writeFile(
      templatePath,
      "# CHI Review Guide\n\nEvaluate contribution, method fit, ethics, and HCI impact."
    );

    const venue = await resolveVenueConfig({
      venueMode: "custom_template",
      customVenueName: "CHI Tutorial Template",
      customVenueTemplatePath: templatePath
    });

    expect(venue.id).toBe("custom:CHI Tutorial Template");
    expect(venue.name).toBe("CHI Tutorial Template");
    expect(venue.rubric).toContain("HCI impact");
    expect(venue.reviewForm).toContain("Questions for authors");
  });

  it("rejects custom templates that are not markdown files", async () => {
    await expect(
      resolveVenueConfig({
        venueMode: "custom_template",
        customVenueTemplatePath: "/tmp/review-guidelines.txt"
      })
    ).rejects.toThrow(/\.md/);
  });
});
