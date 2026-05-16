import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { expect, test } from "@playwright/test";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

test("uploads a PDF and runs the fake multi-agent review", async ({ page }, testInfo) => {
  const pdfPath = await createSamplePdf(testInfo.outputPath("sample-paper.pdf"));

  await page.goto("/");
  await expect(page.getByText("AIReviewer")).toBeVisible();
  await expect(page.getByText(/fake-reviewer-v1 local test mode/i)).toBeVisible();

  await page.getByLabel("Upload PDF").setInputFiles(pdfPath);
  await expect(page.getByText(/Uploaded sample-paper.pdf/i)).toBeVisible({
    timeout: 20_000
  });
  const selectableSentence = page
    .locator(".pdf-viewer .textLayer")
    .getByText("In this paper we show that the proposed method improves robustness on shifted data.")
    .first();
  await expect(selectableSentence).toBeVisible({ timeout: 20_000 });
  const box = await selectableSentence.boundingBox();
  expect(box).not.toBeNull();
  if (box) {
    await page.mouse.move(box.x + 10, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width - 10, box.y + box.height / 2, {
      steps: 30
    });
    await page.mouse.up();
    await expect
      .poll(() => page.evaluate(() => window.getSelection()?.toString() ?? ""))
      .toContain("proposed method improves robustness");
  }

  await page.getByRole("button", { name: /run review/i }).click();
  await expect(page.getByText("Review complete", { exact: true })).toBeVisible({
    timeout: 30_000
  });
  await expect(page.getByText("Sample Uploaded Paper", { exact: true }).first()).toBeVisible();

  await page.getByRole("button", { name: /suggestions/i }).click();
  await page.getByText(/The claim sounds broad/i).click();
  await expect(page.getByText(/Jumping to|Matched sug-claim-evidence/i)).toBeVisible();
  await expect(page.locator(".TextHighlight--scrolledTo .TextHighlight__part").first()).toBeVisible();
});

async function createSamplePdf(filePath: string): Promise<string> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([612, 792]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const lines = [
    "Sample Paper for AIReviewer",
    "Abstract",
    "In this paper we show that the proposed method improves robustness on shifted data.",
    "The experiments compare against representative baselines and include an ablation study.",
    "Related work is discussed briefly and should be expanded before submission."
  ];

  lines.forEach((line, index) => {
    page.drawText(line, {
      x: 72,
      y: 720 - index * 26,
      size: index === 0 ? 18 : 12,
      font,
      color: rgb(0.08, 0.1, 0.09)
    });
  });

  await writeFile(filePath, await pdf.save());
  return filePath;
}
