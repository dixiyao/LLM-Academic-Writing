"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import {
  Bot,
  CheckCircle2,
  FileText,
  Highlighter,
  ImagePlus,
  MessageSquareText,
  Play,
  Search,
  Send,
  Upload,
  WandSparkles
} from "lucide-react";

import type {
  ProviderId,
  RebuttalTarget,
  ReviewAgentId,
  ReviewOutput,
  ReviewSuggestion,
  TextIndexItem
} from "@/lib/review-schema";
import { resolveSuggestionAnchor, resolveSuggestionAnchors } from "@/lib/anchors";
import { venues, type VenueId, type VenueMode } from "@/lib/venues";

type PaperState = {
  paperId: string;
  originalName: string;
  provider: string;
  providerUpload: {
    state: string;
    message?: string;
  };
};

type ProviderStatus = {
  gemini: { configured: boolean; model: string; fastModel: string };
  openrouter: { configured: boolean; model: string };
  fakeProviderEnabled: boolean;
};

type ProgressEvent = {
  step: string;
  status: "running" | "complete" | "error";
  message: string;
};

type AnnotationRow = {
  id: string;
  paperId?: string;
  reviewRunId?: string | null;
  suggestionId?: string | null;
  textIndexId?: string | null;
  type: string;
  position?: unknown;
  content?: { text?: string; comment?: string; severity?: string } | null;
  score: number;
};

type RebuttalRow = {
  id: string;
  suggestionId?: string | null;
  target?: RebuttalTarget | null;
  userMessage: string;
  agentJudgment: string;
  createdAt: number;
};

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

type ComposerAttachment = {
  id: string;
  name: string;
  mimeType: string;
  dataUrl: string;
};

type ComposerAgentTarget =
  | "general"
  | "standard_reviewer"
  | "hard_reviewer"
  | "ac_meta_reviewer";

const providerLabels: Record<string, string> = {
  gemini: "Gemini",
  openrouter: "OpenRouter",
  fake: "Fake"
};

const PdfPanel = dynamic(
  () => import("@/components/PdfPanel").then((module) => module.PdfPanel),
  {
    ssr: false,
    loading: () => (
      <div className="empty-state">
        <div className="empty-state-inner">
          <FileText size={38} />
          <h2>Loading PDF tools</h2>
          <p>The PDF viewer is loading in the browser.</p>
        </div>
      </div>
    )
  }
);

export function AIReviewerApp() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [providerStatus, setProviderStatus] = useState<ProviderStatus | null>(null);
  const [providerId, setProviderId] = useState<ProviderId>("gemini");
  const [venueMode, setVenueMode] = useState<VenueMode>("preset");
  const [venueId, setVenueId] = useState<VenueId>("neurips");
  const [customVenueName, setCustomVenueName] = useState("");
  const [customVenueTemplatePath, setCustomVenueTemplatePath] = useState("");
  const [reviewContext, setReviewContext] = useState("");
  const [searchEnabled, setSearchEnabled] = useState(false);
  const [paper, setPaper] = useState<PaperState | null>(null);
  const [textIndex, setTextIndex] = useState<TextIndexItem[]>([]);
  const [reviewRunId, setReviewRunId] = useState<string | null>(null);
  const [review, setReview] = useState<ReviewOutput | null>(null);
  const [annotations, setAnnotations] = useState<AnnotationRow[]>([]);
  const [rebuttals, setRebuttals] = useState<RebuttalRow[]>([]);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [progress, setProgress] = useState<ProgressEvent[]>([]);
  const [selectedSuggestionId, setSelectedSuggestionId] = useState<string | null>(null);
  const [selectedSuggestionPulse, setSelectedSuggestionPulse] = useState(0);
  const [selectionTarget, setSelectionTarget] = useState<RebuttalTarget | null>(null);
  const [markMode, setMarkMode] = useState(false);
  const [composerText, setComposerText] = useState("");
  const [composerAgentTarget, setComposerAgentTarget] =
    useState<ComposerAgentTarget>("standard_reviewer");
  const [composerAttachments, setComposerAttachments] = useState<ComposerAttachment[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("Ready");
  const [activeTab, setActiveTab] = useState<
    "complete" | "context" | "suggestions" | "history" | "sources"
  >("complete");

  useEffect(() => {
    fetch("/api/providers/status")
      .then((response) => response.json())
      .then((data: ProviderStatus) => {
        setProviderStatus(data);
        if (data.fakeProviderEnabled) setProviderId("fake");
      })
      .catch(() => setProviderStatus(null));
  }, []);

  const modelStatus = useMemo(() => {
    if (!providerStatus) return "Checking providers";
    if (providerId === "gemini") {
      return `${providerStatus.gemini.model} ${
        providerStatus.gemini.configured ? "configured" : "missing key"
      }`;
    }
    if (providerId === "openrouter") {
      return `${providerStatus.openrouter.model} ${
        providerStatus.openrouter.configured ? "configured" : "missing key"
      }`;
    }
    return "fake-reviewer-v1 local test mode";
  }, [providerId, providerStatus]);

  const selectedSuggestion = useMemo(
    () => review?.suggestions.find((item) => item.id === selectedSuggestionId) ?? null,
    [review, selectedSuggestionId]
  );

  async function uploadPaper(file: File) {
    setBusy(true);
    setStatus("Uploading PDF");
    setReview(null);
    setAnnotations([]);
    setTextIndex([]);
    setReviewRunId(null);
    setSelectionTarget(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("provider", providerId);
      const response = await fetch("/api/papers", {
        method: "POST",
        body: formData
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Upload failed.");
      setPaper(data);
      setStatus(
        `Uploaded ${data.originalName}; PDF text indexing will start in the viewer.${
          data.providerUpload?.message ? ` ${data.providerUpload.message}` : ""
        }`
      );
    } catch (error) {
      setStatus(cleanUiMessage(error instanceof Error ? error.message : "Upload failed."));
    } finally {
      setBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function runReview() {
    if (!paper) return;
    setBusy(true);
    setProgress([]);
    setStatus("Starting review");
    setActiveTab("complete");
    try {
      const response = await fetch("/api/reviews/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          paperId: paper.paperId,
          venueMode,
          venueId,
          customVenueName,
          customVenueTemplatePath,
          reviewContext,
          providerId,
          searchEnabled,
          textIndex
        })
      });
      if (!response.ok || !response.body) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error ?? "Review failed to start.");
      }

      await readEventStream(response.body, (event, data) => {
        if (event === "progress") {
          const progressEvent = data as ProgressEvent & {
            review?: ReviewOutput;
            rawReview?: string;
          };
          setProgress((current) => [...current, progressEvent]);
          setStatus(progressEvent.message);
          if (progressEvent.review) {
            setReview(progressEvent.review);
            setActiveTab("complete");
          } else if (progressEvent.rawReview) {
            setReview(makeRawReview(progressEvent.rawReview));
            setActiveTab("complete");
          }
        }
        if (event === "final") {
          const result = data as {
            reviewRunId: string;
            output: ReviewOutput;
            annotations: AnnotationRow[];
          };
          setReviewRunId(result.reviewRunId);
          setReview(result.output);
          setAnnotations(
            mergeAnnotations(
              result.annotations,
              deriveClientAnnotations(
                paper.paperId,
                result.reviewRunId,
                result.output,
                textIndex
              )
            )
          );
          setStatus("Review complete");
        }
        if (event === "error") {
          const message = cleanUiMessage(
            (data as { message?: string }).message ?? "Review failed."
          );
          setStatus(message);
          setProgress((current) => [
            ...current,
            { step: "error", status: "error", message }
          ]);
        }
      });
    } catch (error) {
      setStatus(cleanUiMessage(error instanceof Error ? error.message : "Review failed."));
    } finally {
      setBusy(false);
    }
  }

  async function submitComposer(mode: "chat" | "rebuttal") {
    if (!paper || !composerText.trim()) return;
    const targetAgent =
      composerAgentTarget === "general" ? undefined : (composerAgentTarget as ReviewAgentId);
    const baseTarget =
      selectionTarget ??
      (selectedSuggestion
        ? ({
            type: "suggestion",
            suggestionId: selectedSuggestion.id,
            agent: selectedSuggestion.agent
          } satisfies RebuttalTarget)
        : ({ type: "general" } satisfies RebuttalTarget));
    const target = {
      ...baseTarget,
      agent: baseTarget.agent ?? targetAgent
    } satisfies RebuttalTarget;
    const attachments = composerAttachments.map(({ id: _id, ...attachment }) => attachment);

    setBusy(true);
    try {
      if (mode === "rebuttal" && reviewRunId) {
        const response = await fetch("/api/rebuttals", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            paperId: paper.paperId,
            reviewRunId,
            message: composerText,
            target,
            attachments
          })
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "Rebuttal failed.");
        setRebuttals((current) => [data.rebuttal, ...current]);
        setActiveTab("history");
      } else {
        setChatMessages((current) => [
          ...current,
          {
            id: crypto.randomUUID(),
            role: "user",
            content: attachments.length
              ? `[${agentTargetLabel(target.agent)}]\n${composerText}\n\n[Attached images: ${attachments.map((item) => item.name).join(", ")}]`
              : `[${agentTargetLabel(target.agent)}]\n${composerText}`
          }
        ]);
        const response = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            paperId: paper.paperId,
            reviewRunId,
            message: composerText,
            target,
            attachments
          })
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "Chat failed.");
        setChatMessages((current) => [...current, data.message]);
      }
      setComposerText("");
      setComposerAttachments([]);
      setSelectionTarget(null);
      setStatus("Response saved");
    } catch (error) {
      setStatus(cleanUiMessage(error instanceof Error ? error.message : "Request failed."));
    } finally {
      setBusy(false);
    }
  }

  function selectSuggestion(suggestion: ReviewSuggestion) {
    setSelectedSuggestionId(suggestion.id);
    setSelectedSuggestionPulse((current) => current + 1);

    const existingAnnotation = annotations.find(
      (annotation) => annotation.suggestionId === suggestion.id && annotation.position
    );
    if (existingAnnotation) {
      setStatus(`Jumping to ${suggestion.section || "matched paper text"}.`);
      return;
    }

    const match = resolveSuggestionAnchor(suggestion, textIndex, 0.12);
    if (!match?.position) {
      setStatus(
        `No PDF sentence match found for ${suggestion.id}. Try selecting the sentence manually with Mark PDF.`
      );
      return;
    }

    setAnnotations((current) => {
      if (
        current.some(
          (annotation) => annotation.suggestionId === suggestion.id && annotation.position
        )
      ) {
        return current;
      }
      return [
        ...current,
        annotationFromAnchorMatch(paper?.paperId ?? "client", reviewRunId, suggestion, match)
      ];
    });
    setStatus(`Matched ${suggestion.id} on page ${match.pageNumber}; jumping to it.`);
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">
            <Bot size={20} />
          </div>
          <div>
            <h1 className="brand-title">AIReviewer</h1>
            <p className="brand-subtitle">
              {paper ? paper.originalName : "Upload a paper to begin"}
            </p>
          </div>
        </div>

        <div className="toolbar">
          <input
            ref={fileInputRef}
            className="file-input"
            type="file"
            accept="application/pdf,.pdf"
            aria-label="Upload PDF"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void uploadPaper(file);
            }}
          />
          <button
            className="button"
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={busy}
          >
            <Upload size={16} />
            Upload PDF
          </button>
          <select
            className="select"
            aria-label="Venue mode"
            value={venueMode}
            onChange={(event) => setVenueMode(event.target.value as VenueMode)}
          >
            <option value="preset">Venue name</option>
            <option value="custom_template">Markdown template</option>
          </select>
          {venueMode === "preset" ? (
            <select
              className="select"
              aria-label="Venue"
              value={venueId}
              onChange={(event) => setVenueId(event.target.value as VenueId)}
            >
              {Object.values(venues).map((venue) => (
                <option key={venue.id} value={venue.id}>
                  {venue.name}
                </option>
              ))}
            </select>
          ) : (
            <>
              <input
                className="input compact-input"
                aria-label="Custom venue name"
                value={customVenueName}
                onChange={(event) => setCustomVenueName(event.target.value)}
                placeholder="Venue name"
              />
              <input
                className="input path-input"
                aria-label="Custom venue markdown path"
                value={customVenueTemplatePath}
                onChange={(event) => setCustomVenueTemplatePath(event.target.value)}
                placeholder="./review-guidelines.md"
              />
            </>
          )}
          <select
            className="select"
            aria-label="Provider"
            value={providerId}
            onChange={(event) => setProviderId(event.target.value as ProviderId)}
          >
            <option value="gemini">Gemini</option>
            <option value="openrouter">OpenRouter</option>
            {providerStatus?.fakeProviderEnabled ? <option value="fake">Fake</option> : null}
          </select>
          <label className="toggle">
            <input
              type="checkbox"
              checked={searchEnabled}
              onChange={(event) => setSearchEnabled(event.target.checked)}
            />
            <Search size={15} />
            Search
          </label>
          <button
            className="button primary"
            type="button"
            onClick={() => void runReview()}
            disabled={
              !paper ||
              busy ||
              (venueMode === "custom_template" && !customVenueTemplatePath.trim())
            }
          >
            <Play size={16} />
            Run Review
          </button>
        </div>
      </header>

      <section className="workspace">
        <section className="pdf-pane" aria-label="PDF viewer">
          <div className="pane-header">
            <div>
              <h2 className="pane-title">Paper PDF</h2>
              <div className="status-line">
                {textIndex.length
                  ? `${textIndex.length} text anchors indexed`
                  : "PDF text anchors will index after upload"}
              </div>
            </div>
            <div className="pane-actions">
              <button
                className={`button compact ${markMode ? "active" : ""}`}
                type="button"
                onClick={() => {
                  const next = !markMode;
                  setMarkMode(next);
                  setStatus(
                    next
                      ? "PDF mark mode on. Drag over PDF text to highlight it; Alt-drag still marks an area."
                      : "PDF mark mode off."
                  );
                }}
                disabled={!paper}
              >
                <Highlighter size={15} />
                Mark PDF
              </button>
              <span className="badge">{modelStatus}</span>
            </div>
          </div>
          {paper ? (
            <PdfPanel
              paperId={paper.paperId}
              annotations={annotations}
              selectedSuggestionId={selectedSuggestionId}
              selectedSuggestionPulse={selectedSuggestionPulse}
              markMode={markMode}
              onTextIndex={setTextIndex}
              onSelection={(target) => {
                setSelectionTarget({
                  ...target,
                  agent:
                    composerAgentTarget === "general"
                      ? undefined
                      : (composerAgentTarget as ReviewAgentId)
                });
                setStatus("PDF text selected. Add a comment in the composer.");
              }}
              onManualAnnotation={(annotation) =>
                setAnnotations((current) =>
                  current.some((item) => item.id === annotation.id)
                    ? current
                    : [...current, annotation]
                )
              }
              onSuggestionSelect={(id) => {
                setSelectedSuggestionId(id);
                setSelectedSuggestionPulse((current) => current + 1);
              }}
            />
          ) : (
            <EmptyPdfState />
          )}
        </section>

        <section className="review-pane" aria-label="Review workspace">
          <div className="pane-header">
            <div>
              <h2 className="pane-title">Review Workspace</h2>
              <div className="status-line">{status}</div>
            </div>
            {review ? (
              <span className={`badge ${readinessClass(review.metaReview.readiness)}`}>
                <CheckCircle2 size={14} />
                {review.metaReview.readiness.replaceAll("_", " ")}
              </span>
            ) : (
              <span className="badge">
                <WandSparkles size={14} />
                waiting
              </span>
            )}
          </div>

          <ProgressList progress={progress} />

          <div className="tabs" role="tablist" aria-label="Review tabs">
            {[
              ["complete", "Complete Review"],
              ["context", "Context"],
              ["suggestions", "Suggestions"],
              ["history", "Rebuttal History"],
              ["sources", "Sources"]
            ].map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={`tab ${activeTab === id ? "active" : ""}`}
                onClick={() => setActiveTab(id as typeof activeTab)}
              >
                {label}
              </button>
            ))}
          </div>

          <ReviewContent
            activeTab={activeTab}
            review={review}
            annotations={annotations}
            rebuttals={rebuttals}
            chatMessages={chatMessages}
            reviewContext={reviewContext}
            onReviewContextChange={setReviewContext}
            selectedSuggestionId={selectedSuggestionId}
            onSelectSuggestion={(suggestion) => {
              selectSuggestion(suggestion);
              setActiveTab("suggestions");
            }}
          />

          <Composer
            disabled={!paper || busy}
            canRebut={Boolean(reviewRunId)}
            target={selectionTarget}
            selectedSuggestion={selectedSuggestion}
            agentTarget={composerAgentTarget}
            onAgentTargetChange={setComposerAgentTarget}
            value={composerText}
            onChange={setComposerText}
            onClearTarget={() => {
              setSelectionTarget(null);
              setSelectedSuggestionId(null);
              setSelectedSuggestionPulse((current) => current + 1);
            }}
            attachments={composerAttachments}
            onAddAttachments={(attachments) =>
              setComposerAttachments((current) => [...current, ...attachments].slice(0, 6))
            }
            onRemoveAttachment={(id) =>
              setComposerAttachments((current) => current.filter((item) => item.id !== id))
            }
            onChat={() => void submitComposer("chat")}
            onRebuttal={() => void submitComposer("rebuttal")}
          />
        </section>
      </section>
    </main>
  );
}

function deriveClientAnnotations(
  paperId: string,
  reviewRunId: string,
  review: ReviewOutput,
  textIndex: TextIndexItem[]
): AnnotationRow[] {
  return resolveSuggestionAnchors(review.suggestions, textIndex).map((match) => {
    const suggestion = review.suggestions.find((item) => item.id === match.suggestionId);
    return annotationFromAnchorMatch(paperId, reviewRunId, suggestion, match);
  });
}

function annotationFromAnchorMatch(
  paperId: string,
  reviewRunId: string | null,
  suggestion: ReviewSuggestion | undefined,
  match: NonNullable<ReturnType<typeof resolveSuggestionAnchor>>
): AnnotationRow {
  return {
    id: `client-${match.suggestionId}-${match.textIndexId}`,
    paperId,
    reviewRunId,
    suggestionId: match.suggestionId,
    textIndexId: match.textIndexId,
    type: "text",
    position: match.position,
    content: {
      text: match.matchedText,
      comment: suggestion?.action ?? suggestion?.rationale ?? "",
      severity: suggestion?.severity ?? "medium"
    },
    score: match.score
  };
}

function mergeAnnotations(
  serverAnnotations: AnnotationRow[],
  clientAnnotations: AnnotationRow[]
): AnnotationRow[] {
  const merged = [...serverAnnotations];
  const coveredSuggestionIds = new Set(
    serverAnnotations.map((annotation) => annotation.suggestionId).filter(Boolean)
  );
  for (const annotation of clientAnnotations) {
    if (!annotation.suggestionId || coveredSuggestionIds.has(annotation.suggestionId)) {
      continue;
    }
    coveredSuggestionIds.add(annotation.suggestionId);
    merged.push(annotation);
  }
  return merged.length ? merged : clientAnnotations;
}

function EmptyPdfState() {
  return (
    <div className="empty-state">
      <div className="empty-state-inner">
        <FileText size={42} />
        <h2>Upload a paper PDF</h2>
        <p>
          The app will display the paper, index PDF text anchors, and attach
          reviewer suggestions to matching locations.
        </p>
      </div>
    </div>
  );
}

function ProgressList({ progress }: { progress: ProgressEvent[] }) {
  if (!progress.length) {
    return (
      <div className="progress-list">
        <span className="progress-pill">No review run yet</span>
      </div>
    );
  }
  return (
    <div className="progress-list">
      {progress.slice(-6).map((item, index) => (
        <span key={`${item.step}-${index}`} className={`progress-pill ${item.status}`}>
          {item.step}: {item.message}
        </span>
      ))}
    </div>
  );
}

function ReviewContent({
  activeTab,
  review,
  annotations,
  rebuttals,
  chatMessages,
  reviewContext,
  onReviewContextChange,
  selectedSuggestionId,
  onSelectSuggestion
}: {
  activeTab: "complete" | "context" | "suggestions" | "history" | "sources";
  review: ReviewOutput | null;
  annotations: AnnotationRow[];
  rebuttals: RebuttalRow[];
  chatMessages: ChatMessage[];
  reviewContext: string;
  onReviewContextChange: (value: string) => void;
  selectedSuggestionId: string | null;
  onSelectSuggestion: (suggestion: ReviewSuggestion) => void;
}) {
  if (activeTab === "context") {
    return (
      <ContextEditor value={reviewContext} onChange={onReviewContextChange} />
    );
  }

  if (!review) {
    return (
      <div className="tab-content">
        <div className="empty-state">
          <div className="empty-state-inner">
            <MessageSquareText size={38} />
            <h2>No review yet</h2>
            <p>Run the multi-agent review after uploading and indexing a PDF.</p>
          </div>
        </div>
      </div>
    );
  }

  if (activeTab === "suggestions") {
    return (
      <div className="tab-content">
        <div className="summary-grid">
          <div className="metric">
            <span className="metric-label">PDF annotations</span>
            <span className="metric-value">{annotations.length}</span>
          </div>
          <div className="metric">
            <span className="metric-label">Suggestions</span>
            <span className="metric-value">{review.suggestions.length}</span>
          </div>
        </div>
        <div className="suggestion-list">
          {review.suggestions.map((suggestion) => (
            <SuggestionItem
              key={suggestion.id}
              suggestion={suggestion}
              selected={selectedSuggestionId === suggestion.id}
              annotated={annotations.some(
                (annotation) => annotation.suggestionId === suggestion.id
              )}
              onSelect={() => onSelectSuggestion(suggestion)}
            />
          ))}
        </div>
      </div>
    );
  }

  if (activeTab === "history") {
    return (
      <div className="tab-content">
        <div className="history-list">
          {rebuttals.map((item) => (
            <div key={item.id} className="history-item">
              <strong>Author:</strong>
              <p>{item.userMessage}</p>
              <strong>AIReviewer judgment:</strong>
              <p>{item.agentJudgment}</p>
            </div>
          ))}
          {chatMessages.map((message) => (
            <div key={message.id} className={`chat-message ${message.role}`}>
              <strong>{message.role === "user" ? "You" : "AIReviewer"}</strong>
              <p>{message.content}</p>
            </div>
          ))}
          {!rebuttals.length && !chatMessages.length ? (
            <div className="history-item">No rebuttal or chat history yet.</div>
          ) : null}
        </div>
      </div>
    );
  }

  if (activeTab === "sources") {
    return (
      <div className="tab-content">
        <div className="source-list">
          {review.sources.map((source, index) => (
            <div key={`${source.title}-${index}`} className="source-item">
              <strong>{source.title}</strong>
              {source.url ? (
                <p>
                  <a className="link" href={source.url} target="_blank" rel="noreferrer">
                    {source.url}
                  </a>
                </p>
              ) : null}
              <p>{source.note}</p>
            </div>
          ))}
          {!review.sources.length ? (
            <div className="source-item">No external sources were returned.</div>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="tab-content">
      <div className="summary-grid">
        <div className="metric">
          <span className="metric-label">Paper</span>
          <span className="metric-value">{review.paperBrief.title}</span>
        </div>
        <div className="metric">
          <span className="metric-label">Venue readiness</span>
          <span className="metric-value">
            {review.metaReview.readiness.replaceAll("_", " ")}
          </span>
        </div>
        <div className="metric">
          <span className="metric-label">Reviewer roles</span>
          <span className="metric-value">{review.roleReviews.length}</span>
        </div>
      </div>
      <StructuredReview review={review} />
    </div>
  );
}

function ContextEditor({
  value,
  onChange
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="tab-content">
      <div className="context-editor">
        <div>
          <h3>Review Context</h3>
          <p>
            Add domain-specific rubric notes, review examples, meta-prompts, or
            critique patterns. This context is used by the AC synthesis and
            suggestion-generation agents on the next run.
          </p>
        </div>
        <textarea
          className="textarea context-textarea"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={`Example:\nFor CHI submissions, weigh contribution to HCI knowledge, study validity, participant population, ethics, accessibility, and design implications. Good suggestions should name the exact claim, the missing evidence, and the revision or study detail needed.`}
        />
      </div>
    </div>
  );
}

function StructuredReview({ review }: { review: ReviewOutput }) {
  const specialistReviews = review.roleReviews.filter(
    (roleReview) =>
      roleReview.roleId !== "standard_reviewer" && roleReview.roleId !== "hard_reviewer"
  );
  const debateRounds = review.debateRounds
    .map((round) => ({
      ...round,
      roleReviews: round.roleReviews.filter(
        (roleReview) =>
          hasText(roleReview.summary) ||
          hasText(roleReview.recommendation) ||
          hasItems(roleReview.weaknesses)
      )
    }))
    .filter((round) => round.roleReviews.length > 0);

  return (
    <div className="structured-review">
      <ReviewPanel
        title="Paper Brief"
        visible={
          hasText(review.paperBrief.oneSentenceSummary) ||
          hasItems(review.paperBrief.claimedContributions) ||
          hasItems(review.paperBrief.methods) ||
          hasItems(review.paperBrief.experiments)
        }
      >
        <ReviewParagraph value={review.paperBrief.oneSentenceSummary} />
        <ReviewList title="Claimed contributions" items={review.paperBrief.claimedContributions} />
        <ReviewList title="Methods" items={review.paperBrief.methods} />
        <ReviewList title="Experiments" items={review.paperBrief.experiments} />
      </ReviewPanel>

      <ReviewPanel
        title="Standard Review"
        visible={
          hasText(review.standardReview.summary) ||
          hasItems(review.standardReview.strengths) ||
          hasItems(review.standardReview.weaknesses) ||
          hasItems(review.standardReview.questions) ||
          hasText(review.standardReview.recommendation)
        }
      >
        <ReviewParagraph value={review.standardReview.summary} />
        <ReviewList title="Strengths" items={review.standardReview.strengths} />
        <ReviewList title="Weaknesses" items={review.standardReview.weaknesses} />
        <ReviewList title="Questions" items={review.standardReview.questions} />
        <RecommendationLine review={review.standardReview} />
      </ReviewPanel>

      <ReviewPanel
        title="Hard Reviewer"
        visible={
          hasText(review.hardReview.summary) ||
          hasItems(review.hardReview.weaknesses) ||
          hasItems(review.hardReview.questions) ||
          hasText(review.hardReview.recommendation)
        }
      >
        <ReviewParagraph value={review.hardReview.summary} />
        <ReviewList title="Likely rejection risks" items={review.hardReview.weaknesses} />
        <ReviewList title="Author questions" items={review.hardReview.questions} />
        <RecommendationLine review={review.hardReview} />
      </ReviewPanel>

      {specialistReviews.map((roleReview) => (
        <ReviewPanel
          key={roleReview.roleId}
          title={roleReview.roleName || roleReview.roleId}
          visible={
            hasText(roleReview.summary) ||
            hasItems(roleReview.focusAreas) ||
            hasItems(roleReview.weaknesses) ||
            hasItems(roleReview.questions) ||
            hasText(roleReview.recommendation)
          }
        >
          <ReviewParagraph value={roleReview.summary} />
          <ReviewList title="Focus areas" items={roleReview.focusAreas} />
          <ReviewList title="Role-specific risks" items={roleReview.weaknesses} />
          <ReviewList title="Questions" items={roleReview.questions} />
          <RecommendationLine review={roleReview} />
        </ReviewPanel>
      ))}

      <ReviewPanel title="Three-Round Debate" visible={debateRounds.length > 0}>
        <div className="debate-rounds">
          {debateRounds.map((round) => (
            <div className="debate-round" key={round.round}>
              <h4>Round {round.round}</h4>
              <ul>
                {round.roleReviews.map((roleReview) => (
                  <li key={`${round.round}-${roleReview.roleId}`}>
                    <strong>{roleReview.roleName || roleReview.roleId}:</strong>{" "}
                    {firstSpecified(roleReview.summary, roleReview.recommendation)}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </ReviewPanel>

      <ReviewPanel
        title="Area Chair Assessment"
        visible={
          hasText(review.metaReview.decisionRationale) ||
          hasItems(review.metaReview.mostImportantRisks) ||
          hasItems(review.metaReview.highestLeverageFixes)
        }
      >
        <ReviewParagraph value={review.metaReview.decisionRationale} />
        <ReviewList title="Most important risks" items={review.metaReview.mostImportantRisks} />
        <ReviewList title="Highest leverage fixes" items={review.metaReview.highestLeverageFixes} />
      </ReviewPanel>

      <ReviewPanel title="Improvement Plan" visible={hasItems(review.improvementPlan)}>
        <ReviewList title="Concrete next steps" items={review.improvementPlan} />
      </ReviewPanel>

      {review.completeReview.trim() ? (
        <details className="raw-review-details">
          <summary>Full generated review text</summary>
          <div className="review-markdown">{stripJsonFence(review.completeReview)}</div>
        </details>
      ) : null}
    </div>
  );
}

function ReviewPanel({
  title,
  children,
  visible = true
}: {
  title: string;
  children: ReactNode;
  visible?: boolean;
}) {
  if (!visible) return null;
  return (
    <section className="review-panel">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

function ReviewList({ title, items }: { title: string; items: string[] }) {
  const cleanItems = cleanStringList(items);
  if (!cleanItems.length) return null;

  return (
    <div className="review-list-block">
      <h4>{title}</h4>
      <ul>
        {cleanItems.map((item, index) => (
          <li key={`${title}-${index}`}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

function ReviewParagraph({ value }: { value: string }) {
  return hasText(value) ? <p>{value}</p> : null;
}

function RecommendationLine({ review }: { review: { recommendation: string } }) {
  if (!hasText(review.recommendation)) return null;
  return (
    <p>
      <strong>Recommendation:</strong> {review.recommendation}
    </p>
  );
}

function stripJsonFence(value: string): string {
  return value.replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim();
}

function hasText(value: string | null | undefined): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return Boolean(normalized) && normalized !== "not specified";
}

function cleanStringList(items: string[]): string[] {
  return items.filter(hasText);
}

function hasItems(items: string[]): boolean {
  return cleanStringList(items).length > 0;
}

function firstSpecified(...values: string[]): string {
  return values.find(hasText) ?? "";
}

function SuggestionItem({
  suggestion,
  selected,
  annotated,
  onSelect
}: {
  suggestion: ReviewSuggestion;
  selected: boolean;
  annotated: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      className={`suggestion ${selected ? "selected" : ""}`}
      onClick={onSelect}
    >
      <div className="suggestion-header">
        <span className={`badge ${suggestion.severity}`}>{suggestion.severity}</span>
        <span className="badge">{annotated ? "annotated" : suggestion.targetType}</span>
      </div>
      <small>
        {suggestion.section || "General"} · confidence{" "}
        {Math.round(suggestion.confidence * 100)}%
      </small>
      <p>{suggestion.rationale}</p>
      <p>
        <strong>Action:</strong> {suggestion.action}
      </p>
      {suggestion.anchorText ? <small>Anchor: {suggestion.anchorText}</small> : null}
    </button>
  );
}

function Composer({
  disabled,
  canRebut,
  target,
  selectedSuggestion,
  agentTarget,
  onAgentTargetChange,
  value,
  onChange,
  onClearTarget,
  attachments,
  onAddAttachments,
  onRemoveAttachment,
  onChat,
  onRebuttal
}: {
  disabled: boolean;
  canRebut: boolean;
  target: RebuttalTarget | null;
  selectedSuggestion: ReviewSuggestion | null;
  agentTarget: ComposerAgentTarget;
  onAgentTargetChange: (target: ComposerAgentTarget) => void;
  value: string;
  onChange: (value: string) => void;
  onClearTarget: () => void;
  attachments: ComposerAttachment[];
  onAddAttachments: (attachments: ComposerAttachment[]) => void;
  onRemoveAttachment: (id: string) => void;
  onChat: () => void;
  onRebuttal: () => void;
}) {
  const imageInputRef = useRef<HTMLInputElement | null>(null);

  async function handleImageFiles(files: FileList | null) {
    if (!files?.length) return;
    const images = await Promise.all(
      Array.from(files)
        .filter((file) => file.type.startsWith("image/"))
        .slice(0, 6)
        .map(async (file) => ({
          id: crypto.randomUUID(),
          name: file.name,
          mimeType: file.type,
          dataUrl: await fileToDataUrl(file)
        }))
    );
    onAddAttachments(images);
    if (imageInputRef.current) imageInputRef.current.value = "";
  }

  return (
    <div className="composer">
      <div className="reviewer-chat-tabs" role="tablist" aria-label="Reviewer chat target">
        {[
          ["standard_reviewer", "Standard"],
          ["hard_reviewer", "Hard"],
          ["ac_meta_reviewer", "AC"],
          ["general", "General"]
        ].map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={`reviewer-chat-tab ${agentTarget === id ? "active" : ""}`}
            onClick={() => onAgentTargetChange(id as ComposerAgentTarget)}
          >
            {label}
          </button>
        ))}
      </div>
      {(target || selectedSuggestion) && (
        <div className="target-box">
          <strong>
            Target:{" "}
            {target?.type === "selection"
              ? `PDF selection on page ${target.pageNumber}`
              : selectedSuggestion
                ? selectedSuggestion.id
                : "general"}{" "}
            · {agentTargetLabel(target?.agent ?? selectedSuggestion?.agent ?? agentTarget)}
          </strong>
          {target?.selectedText ? (
            <div className="selected-text">{target.selectedText}</div>
          ) : selectedSuggestion ? (
            <div className="selected-text">{selectedSuggestion.rationale}</div>
          ) : null}
          <button className="button ghost" type="button" onClick={onClearTarget}>
            Clear target
          </button>
        </div>
      )}
      {attachments.length ? (
        <div className="attachment-strip">
          {attachments.map((attachment) => (
            <div className="attachment-chip" key={attachment.id}>
              <img alt={attachment.name} src={attachment.dataUrl} />
              <span>{attachment.name}</span>
              <button type="button" onClick={() => onRemoveAttachment(attachment.id)}>
                Remove
              </button>
            </div>
          ))}
        </div>
      ) : null}
      <div className="composer-row">
        <textarea
          className="textarea"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={`Chat with ${agentTargetLabel(agentTarget)}, draft a rebuttal, or point to selected PDF text...`}
          disabled={disabled}
        />
        <div className="suggestion-list">
          <input
            ref={imageInputRef}
            className="file-input"
            type="file"
            accept="image/*"
            multiple
            aria-label="Attach images"
            onChange={(event) => void handleImageFiles(event.target.files)}
          />
          <button
            className="button"
            type="button"
            onClick={() => imageInputRef.current?.click()}
            disabled={disabled}
          >
            <ImagePlus size={16} />
            Image
          </button>
          <button className="button" type="button" onClick={onChat} disabled={disabled}>
            <Send size={16} />
            Chat
          </button>
          <button
            className="button primary"
            type="button"
            onClick={onRebuttal}
            disabled={disabled || !canRebut}
          >
            <MessageSquareText size={16} />
            Rebut
          </button>
        </div>
      </div>
    </div>
  );
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read image."));
    reader.readAsDataURL(file);
  });
}

function agentTargetLabel(agent?: string): string {
  switch (agent) {
    case "standard_reviewer":
      return "Standard Reviewer";
    case "hard_reviewer":
      return "Hard Reviewer";
    case "ac_meta_reviewer":
      return "Area Chair";
    case "methodology_reviewer":
      return "Methodology Reviewer";
    case "related_work_reviewer":
      return "Related Work Reviewer";
    case "writing_reviewer":
      return "Writing Reviewer";
    default:
      return "AIReviewer";
  }
}

function cleanUiMessage(message: string): string {
  const cleaned = message
    .replace(/data:[^"'\\\s)]+;base64,[A-Za-z0-9+/=]+/g, "[data-url omitted]")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.length > 900 ? `${cleaned.slice(0, 900)}...` : cleaned;
}

async function readEventStream(
  stream: ReadableStream<Uint8Array>,
  onEvent: (event: string, data: unknown) => void
) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let boundary = buffer.indexOf("\n\n");
    while (boundary !== -1) {
      const chunk = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      boundary = buffer.indexOf("\n\n");

      const event = chunk.match(/^event: (.+)$/m)?.[1] ?? "message";
      const data = chunk
        .split("\n")
        .filter((line) => line.startsWith("data: "))
        .map((line) => line.slice(6))
        .join("\n");
      if (data) onEvent(event, JSON.parse(data));
    }
  }
}

function readinessClass(readiness: ReviewOutput["metaReview"]["readiness"]) {
  if (readiness === "above_bar" || readiness === "near_bar") return "low";
  if (readiness === "borderline") return "medium";
  return "high";
}

function makeRawReview(rawReview: string): ReviewOutput {
  return {
    paperBrief: {
      title: "Raw model review",
      oneSentenceSummary:
        "The model returned review text that is being shown before schema normalization.",
      claimedContributions: [],
      methods: [],
      experiments: [],
      limitations: []
    },
    standardReview: {
      summary: "",
      strengths: [],
      weaknesses: [],
      questions: [],
      recommendation: "",
      confidence: 0.5
    },
    hardReview: {
      summary: "",
      strengths: [],
      weaknesses: [],
      questions: [],
      recommendation: "",
      confidence: 0.5
    },
    roleReviews: [],
    debateRounds: [],
    metaReview: {
      readiness: "borderline",
      decisionRationale: "Raw review shown before structured parsing completed.",
      mostImportantRisks: [],
      highestLeverageFixes: []
    },
    improvementPlan: [],
    suggestions: [],
    sources: [],
    completeReview: rawReview
  };
}
