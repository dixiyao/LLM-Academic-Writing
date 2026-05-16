"use client";

import { useEffect, useMemo, useRef } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import {
  extractSentences,
  PdfHighlighter,
  PdfLoader,
  TextHighlight,
  useHighlightContainerContext,
  viewportPositionToScaled,
  type Highlight,
  type PdfSelection,
  type PdfHighlighterUtils,
  type ScaledPosition
} from "react-pdf-highlighter-plus";

import type { RebuttalTarget, TextIndexItem } from "@/lib/review-schema";

type AnnotationRow = {
  id: string;
  suggestionId?: string | null;
  textIndexId?: string | null;
  type: string;
  position?: unknown;
  content?: { text?: string; comment?: string; severity?: string } | null;
  score: number;
};

type AppHighlight = Highlight & {
  comment?: string;
  severity?: string;
  suggestionId?: string | null;
  source?: "annotation" | "selection";
};

export function PdfPanel({
  paperId,
  annotations,
  selectedSuggestionId,
  selectedSuggestionPulse,
  markMode,
  onTextIndex,
  onSelection,
  onManualAnnotation,
  onSuggestionSelect
}: {
  paperId: string;
  annotations: AnnotationRow[];
  selectedSuggestionId: string | null;
  selectedSuggestionPulse: number;
  markMode: boolean;
  onTextIndex: (items: TextIndexItem[]) => void;
  onSelection: (target: RebuttalTarget) => void;
  onManualAnnotation: (annotation: AnnotationRow) => void;
  onSuggestionSelect: (suggestionId: string | null) => void;
}) {
  return (
    <div className="pdf-viewer">
      <PdfLoader document={`/api/papers/${paperId}/file`}>
        {(pdfDocument) => (
          <PdfDocumentView
            paperId={paperId}
            pdfDocument={pdfDocument}
            annotations={annotations}
            selectedSuggestionId={selectedSuggestionId}
            selectedSuggestionPulse={selectedSuggestionPulse}
            markMode={markMode}
            onTextIndex={onTextIndex}
            onSelection={onSelection}
            onManualAnnotation={onManualAnnotation}
            onSuggestionSelect={onSuggestionSelect}
          />
        )}
      </PdfLoader>
    </div>
  );
}

function PdfDocumentView({
  paperId,
  pdfDocument,
  annotations,
  selectedSuggestionId,
  selectedSuggestionPulse,
  markMode,
  onTextIndex,
  onSelection,
  onManualAnnotation,
  onSuggestionSelect
}: {
  paperId: string;
  pdfDocument: PDFDocumentProxy;
  annotations: AnnotationRow[];
  selectedSuggestionId: string | null;
  selectedSuggestionPulse: number;
  markMode: boolean;
  onTextIndex: (items: TextIndexItem[]) => void;
  onSelection: (target: RebuttalTarget) => void;
  onManualAnnotation: (annotation: AnnotationRow) => void;
  onSuggestionSelect: (suggestionId: string | null) => void;
}) {
  const utilsRef = useRef<PdfHighlighterUtils | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function indexPdf() {
      const sentences = await Promise.race([
        extractSentences(pdfDocument, {
          includePositions: true,
          includeSources: true,
          normalize: true,
          readingOrder: "auto"
        }),
        new Promise<null>((resolve) => window.setTimeout(() => resolve(null), 1800))
      ]);
      if (cancelled) return;
      const extractedItems: TextIndexItem[] = sentences
        ? sentences
            .filter((sentence) => sentence.text.trim().length > 12)
            .slice(0, 10_000)
            .map((sentence) => ({
              id: sentence.id,
              pageNumber: sentence.pageNumber,
              text: sentence.text,
              rawText: sentence.rawText,
              position: sentence.position
            }))
        : [];
      const items = extractedItems.length ? extractedItems : buildDomTextIndex();
      if (!items.length) {
        window.setTimeout(() => {
          if (!cancelled) void commitTextIndex(buildDomTextIndex());
        }, 900);
        return;
      }
      await commitTextIndex(items);
    }

    async function commitTextIndex(items: TextIndexItem[]) {
      if (!items.length) return;
      onTextIndex(items);
      await fetch(`/api/papers/${paperId}/text-index`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items })
      });
    }

    function buildDomTextIndex(): TextIndexItem[] {
      const viewer = utilsRef.current?.getViewer();
      if (!viewer) return [];

      const seen = new Set<string>();
      return Array.from(document.querySelectorAll<HTMLElement>(".pdf-viewer .textLayer span"))
        .map((span, index): TextIndexItem | null => {
          const text = span.textContent?.replace(/\s+/g, " ").trim() ?? "";
          if (text.length <= 12) return null;

          const pageElement = span.closest<HTMLElement>(".page");
          const pageNumber = Number(pageElement?.dataset.pageNumber);
          if (!pageElement || !Number.isFinite(pageNumber) || pageNumber <= 0) {
            return null;
          }

          const key = `${pageNumber}:${text}`;
          if (seen.has(key)) return null;
          seen.add(key);

          const rect = span.getBoundingClientRect();
          const pageRect = pageElement.getBoundingClientRect();
          if (!rect.width || !rect.height) return null;

          const boundingRect = {
            left: rect.left - pageRect.left,
            top: rect.top - pageRect.top,
            width: rect.width,
            height: rect.height,
            pageNumber
          };
          return {
            id: `dom-${pageNumber}-${index}`,
            pageNumber,
            text,
            rawText: text,
            position: viewportPositionToScaled(
              {
                boundingRect,
                rects: [boundingRect]
              },
              viewer
            )
          };
        })
        .filter((item): item is TextIndexItem => Boolean(item))
        .slice(0, 10_000);
    }

    void indexPdf();
    return () => {
      cancelled = true;
    };
  }, [paperId, pdfDocument, onTextIndex]);

  const highlights = useMemo(
    () =>
      annotations
        .filter((annotation) => annotation.position)
        .map(
          (annotation): AppHighlight => ({
            id: annotation.id,
            type: "text",
            position: annotation.position as ScaledPosition,
            content: { text: annotation.content?.text ?? "" },
            comment: annotation.content?.comment ?? "",
            severity: annotation.content?.severity ?? "medium",
            suggestionId: annotation.suggestionId,
            source: annotation.suggestionId ? "annotation" : "selection"
          })
        ),
    [annotations]
  );

  function handleSelection(selection: PdfSelection) {
    const selectedText = selection.content.text?.trim() ?? "";
    if (!selectedText) return;
    if (!markMode) return;

    const annotationId = `manual-${selection.position.boundingRect.pageNumber}-${Date.now()}`;
    onManualAnnotation({
      id: annotationId,
      suggestionId: null,
      textIndexId: null,
      type: "text",
      position: selection.position,
      content: {
        text: selectedText,
        comment: "User selected PDF text",
        severity: "low"
      },
      score: 1
    });
    onSelection({
      type: "selection",
      selectedText,
      pageNumber: selection.position.boundingRect.pageNumber,
      position: selection.position
    });
  }

  useEffect(() => {
    if (!selectedSuggestionId || !utilsRef.current) return;
    const highlight = highlights.find(
      (item) => item.suggestionId === selectedSuggestionId
    );
    if (highlight) {
      utilsRef.current.scrollToHighlight(highlight);
      const retry = window.setTimeout(() => {
        utilsRef.current?.scrollToHighlight(highlight);
      }, 120);
      return () => window.clearTimeout(retry);
    }
  }, [highlights, selectedSuggestionId, selectedSuggestionPulse]);

  function captureNativeSelection() {
    if (!markMode) return;
    window.setTimeout(() => {
      const text = window.getSelection()?.toString().trim();
      if (text) {
        onSelection({
          type: "selection",
          selectedText: text
        });
      }
    }, 0);
  }

  return (
    <div className="pdf-selection-surface" onMouseUp={captureNativeSelection}>
      <PdfHighlighter
        pdfDocument={pdfDocument}
        highlights={highlights}
        pdfScaleValue="page-width"
        onSelection={handleSelection}
        utilsRef={(utils) => {
          utilsRef.current = utils;
        }}
        enableAreaSelection={(event) => markMode && event.altKey}
      >
        <HighlightContainer onSuggestionSelect={onSuggestionSelect} />
      </PdfHighlighter>
    </div>
  );
}

function HighlightContainer({
  onSuggestionSelect
}: {
  onSuggestionSelect: (suggestionId: string | null) => void;
}) {
  const { highlight, isScrolledTo } = useHighlightContainerContext<AppHighlight>();
  const color =
    highlight.source === "selection"
      ? "rgba(46, 108, 159, 0.24)"
      : highlight.severity === "high"
      ? "rgba(179, 63, 63, 0.28)"
      : highlight.severity === "low"
        ? "rgba(46, 108, 159, 0.24)"
        : "rgba(252, 215, 104, 0.5)";

  return (
    <TextHighlight
      highlight={highlight}
      isScrolledTo={isScrolledTo}
      highlightColor={color}
      copyText={highlight.content?.text}
      onClick={() => onSuggestionSelect(highlight.suggestionId ?? null)}
    />
  );
}
