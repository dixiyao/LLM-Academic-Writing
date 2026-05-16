import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AIReviewerApp } from "@/components/AIReviewerApp";

vi.mock("react-pdf-highlighter-plus", () => ({
  PdfLoader: ({ children }: { children: (doc: unknown) => React.ReactNode }) =>
    children({}),
  PdfHighlighter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  TextHighlight: () => <mark>highlight</mark>,
  useHighlightContainerContext: () => ({
    highlight: { id: "h1", content: { text: "text" } },
    isScrolledTo: false
  }),
  extractSentences: vi.fn(async () => [])
}));

describe("AIReviewerApp", () => {
  beforeEach(() => {
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/providers/status")) {
        return new Response(
          JSON.stringify({
            gemini: {
              configured: false,
              model: "gemini-3-pro-preview",
              fastModel: "gemini-3-flash-preview"
            },
            openrouter: { configured: false, model: "openai/gpt-5.2" },
            fakeProviderEnabled: true
          }),
          { status: 200 }
        );
      }
      return new Response("{}", { status: 200 });
    }) as typeof fetch;
  });

  it("renders upload, venue, provider, search, and run controls", async () => {
    render(<AIReviewerApp />);

    expect(await screen.findByText(/fake-reviewer-v1/i)).toBeInTheDocument();
    expect(screen.getByText("AIReviewer")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /upload pdf/i })).toBeInTheDocument();
    expect(screen.getByLabelText("Venue")).toHaveValue("neurips");
    expect(screen.getByLabelText("Provider")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /context/i })).toBeInTheDocument();
    expect(screen.getByLabelText("Search")).not.toBeChecked();
    expect(screen.getByRole("button", { name: /run review/i })).toBeDisabled();
  });

  it("toggles search mode", async () => {
    const user = userEvent.setup();
    render(<AIReviewerApp />);

    await screen.findByText(/fake-reviewer-v1/i);
    const search = screen.getByLabelText("Search");
    await user.click(search);
    expect(search).toBeChecked();
  });
});
