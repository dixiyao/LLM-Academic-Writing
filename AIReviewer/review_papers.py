#!/usr/bin/env python3
"""
Standalone AI paper reviewer — no Next.js server required.

Directly replicates the multi-agent pipeline from the AIReviewer codebase:
  1. Briefing agent     — extracts paper structure
  2. 5 reviewer roles   — run in parallel
  3. N debate rounds    — each round runs all roles in parallel
  4. Meta reviewer      — AC-style synthesis
  5. Improvement analyzer — concrete suggestions

Requirements:
    pip install google-genai

Usage:
    python review_papers.py <input_folder> <gemini_api_key> [options]
    python review_papers.py ./papers AIzaSy... --venue iclr --debate-rounds 2
    python review_papers.py ./papers AIzaSy... --model gemini-2.5-pro-preview-05-06
"""

import argparse
import asyncio
import json
import sys
from pathlib import Path

# ---------------------------------------------------------------------------
# Venue configs (ported from src/lib/venues.ts)
# ---------------------------------------------------------------------------

VENUES = {
    "iclr": {
        "id": "iclr",
        "name": "ICLR 2026",
        "guideline_urls": ["https://iclr.cc/Conferences/2026/ReviewerGuide"],
        "rubric": (
            "ICLR reviews should be substantive, constructive, comprehensive, and clear about "
            "the core reasons for the recommendation. Reviews should summarize the contribution, "
            "list strengths and weaknesses, ask clarifying questions, and separate "
            "decision-critical concerns from improvement feedback."
        ),
        "review_form": [
            "Summary of claimed contributions",
            "Strengths",
            "Weaknesses",
            "Initial recommendation and rationale",
            "Questions for authors",
            "Additional improvement feedback",
        ],
    },
    "neurips": {
        "id": "neurips",
        "name": "NeurIPS 2026",
        "guideline_urls": ["https://neurips.cc/Conferences/2026/ReviewerGuidelines"],
        "rubric": (
            "NeurIPS reviews should evaluate quality, clarity, significance, and originality "
            "according to the contribution type. Technical soundness, support for claims, "
            "reproducibility, and useful community impact are central. Originality can include "
            "new insights, evaluations, framings, data, or combinations of existing techniques."
        ),
        "review_form": [
            "Quality",
            "Clarity",
            "Significance",
            "Originality",
            "Questions for authors",
            "Actionable improvement advice",
        ],
    },
    "icml": {
        "id": "icml",
        "name": "ICML 2026",
        "guideline_urls": [
            "https://icml.cc/Conferences/2026/ReviewerInstructions",
            "https://icml.cc/Conferences/2026/LLM-Policy",
        ],
        "rubric": (
            "ICML reviewers should read carefully, critically, and with empathy. The review "
            "should focus on technical correctness, empirical evidence, clarity, relevance to "
            "machine learning, ethics issues when applicable, and questions that help authors "
            "address uncertainty."
        ),
        "review_form": [
            "Summary",
            "Main strengths",
            "Main weaknesses",
            "Correctness and empirical support",
            "Questions for authors",
            "Recommendation and confidence",
        ],
    },
}

# ---------------------------------------------------------------------------
# Reviewer roles (ported from src/server/agents/roles.ts)
# ---------------------------------------------------------------------------

REVIEWER_ROLES = [
    {
        "id": "standard_reviewer",
        "name": "Standard Venue Reviewer",
        "stance": (
            "A balanced, constructive program-committee reviewer who evaluates the paper "
            "as a normal venue submission."
        ),
        "mission": [
            "Assess the core contribution, evidence, technical soundness, clarity, and likely reviewer form scores.",
            "Separate decision-critical weaknesses from ordinary polish suggestions.",
            "Keep the tone professional and author-helpful.",
        ],
        "focus_areas": ["contribution", "soundness", "significance", "clarity", "venue fit"],
        "output_guidance": [
            "Use the venue rubric explicitly when judging readiness.",
            "Write weaknesses as concerns a real reviewer could plausibly raise.",
            "Ask questions whose answers would change the review.",
        ],
        "uses_search": False,
    },
    {
        "id": "hard_reviewer",
        "name": "Skeptical Reviewer 2",
        "stance": (
            "A skeptical but fair reviewer who looks for rejection risks before submission, "
            "without performative harshness."
        ),
        "mission": [
            "Identify objections that would be difficult to fix during rebuttal.",
            "Stress-test broad claims, missing baselines, underspecified methodology, and novelty doubts.",
            "Flag fragile evidence even when the paper is otherwise promising.",
        ],
        "focus_areas": [
            "fatal risks",
            "claim overreach",
            "missing baselines",
            "unsupported novelty",
            "rebuttal-resistant objections",
        ],
        "output_guidance": [
            "Do not invent flaws; state when a risk is due to missing or unclear evidence in the PDF.",
            "Prioritize high-impact concerns over stylistic issues.",
            "Convert each hard concern into a fixable pre-submission action.",
        ],
        "uses_search": False,
    },
    {
        "id": "methodology_reviewer",
        "name": "Methodology and Experiments Reviewer",
        "stance": (
            "A technically focused reviewer who audits whether methods, baselines, ablations, "
            "statistics, and reproducibility support the claims."
        ),
        "mission": [
            "Check whether experiments isolate the claimed mechanism.",
            "Look for missing comparisons, datasets, stress tests, ablations, metrics, and implementation details.",
            "Evaluate reproducibility and fairness of the empirical setup.",
        ],
        "focus_areas": [
            "experimental design",
            "baselines",
            "ablations",
            "statistics",
            "reproducibility",
        ],
        "output_guidance": [
            "Name concrete missing experiments, controls, metrics, or dataset types when possible.",
            "Distinguish a missing experiment from an experiment that is present but underspecified.",
            "Focus on evidence that directly changes accept/reject confidence.",
        ],
        "uses_search": False,
    },
    {
        "id": "related_work_reviewer",
        "name": "Related Work and Novelty Reviewer",
        "stance": (
            "A positioning-focused reviewer who checks novelty, closest prior work, and whether "
            "claims are appropriately scoped."
        ),
        "mission": [
            "Assess whether the paper explains what is new relative to close prior work.",
            "Check if the related-work framing supports the claimed contribution.",
            "Use search only when enabled, and cite sources only when actually used.",
        ],
        "focus_areas": [
            "novelty",
            "closest related work",
            "positioning",
            "claim scope",
            "citation gaps",
        ],
        "output_guidance": [
            "Novelty is important, but do not overweight novelty over correctness and evidence.",
            "When search is disabled, limit conclusions to what the PDF and citations show.",
            "When search is enabled, surface adjacent work that could materially change reviewer perception.",
        ],
        "uses_search": True,
    },
    {
        "id": "writing_reviewer",
        "name": "Writing and Claim-Evidence Reviewer",
        "stance": (
            "A clarity-focused reviewer who checks whether the paper communicates claims, "
            "evidence, limitations, and reviewer-facing context cleanly."
        ),
        "mission": [
            "Find ambiguous claims, missing signposting, unclear limitations, and unsupported abstract/introduction wording.",
            "Audit whether each major claim points to evidence in a table, figure, theorem, or experiment.",
            "Suggest concise writing fixes that improve reviewer comprehension.",
        ],
        "focus_areas": [
            "clarity",
            "claim-evidence alignment",
            "limitations",
            "paper structure",
            "reviewer readability",
        ],
        "output_guidance": [
            "Avoid copyediting trivia unless it affects reviewer judgment.",
            "Prefer concrete rewrites, added signposts, or scoped claims.",
            "Flag text likely to create a preventable misunderstanding.",
        ],
        "uses_search": False,
    },
]

# ---------------------------------------------------------------------------
# Prompt builders (ported from src/server/agents/prompts.ts)
# ---------------------------------------------------------------------------


def _fmt_list(items: list[str]) -> str:
    return "\n".join(f"- {item}" for item in items) if items else "- Not specified"


def _stringify(value) -> str:
    return json.dumps(value, indent=2, ensure_ascii=False)


def build_system_prompt(venue: dict) -> str:
    urls = _fmt_list(venue["guideline_urls"])
    return f"""You are AIReviewer, an agentic academic-review system for authors before submission.

Mission:
- Help authors maximize the chance that the paper is accepted.
- Do not imitate unhelpful harsh reviewer style.
- Surface likely reviewer objections early, especially objections that cannot be fixed in rebuttal.
- Be concrete: tie weaknesses to paper evidence, exact text, missing experiments, missing related work, or unclear claims.
- Treat novelty as one factor, but do not over-weight novelty relative to correctness, evidence, clarity, and usefulness.

Venue:
{venue['name']}

Guidelines:
{urls}

Rubric summary:
{venue['rubric']}

Output:
Return one JSON object that matches the provided schema exactly. When the schema includes suggestions, every actionable weakness must become a suggestion. If a suggestion maps to a sentence or local PDF region, set targetType to sentence/section/figure/table and include anchorText copied from the paper as short exact text. If no local anchor exists, use targetType general."""


def build_briefing_prompt(venue: dict) -> str:
    return f"""Read the uploaded paper and produce only the paper briefing JSON.

Venue context: {venue['name']}

Briefing requirements:
- Extract only information grounded in the PDF.
- Do not review yet; this pass is evidence gathering for later agents.
- Capture the paper's claimed contribution, method, experiments, and stated limitations.
- If a field is not clear from the paper, return an empty array or concise uncertainty rather than guessing.

Required JSON shape:
{{
  "title": string,
  "oneSentenceSummary": string,
  "claimedContributions": string[],
  "methods": string[],
  "experiments": string[],
  "limitations": string[]
}}"""


def build_reviewer_role_prompt(venue: dict, role: dict, paper_brief: dict, search_enabled: bool) -> str:
    if role["uses_search"] and search_enabled:
        search_instruction = (
            "Grounded search is enabled for this role. Use it to check close related work, "
            "common baselines, and claim scope. Mention searched evidence only when it "
            "materially changes the review."
        )
    else:
        search_instruction = (
            "Do not use web search for this role. Evaluate only the uploaded PDF, "
            "extracted briefing, venue rubric, and prior memory."
        )

    review_form = _fmt_list(venue["review_form"])
    mission = _fmt_list(role["mission"])
    focus_areas = _fmt_list(role["focus_areas"])
    output_guidance = _fmt_list(role["output_guidance"])

    return f"""You are acting as this AIReviewer role:
Role id: {role['id']}
Role name: {role['name']}
Stance: {role['stance']}

Mission:
{mission}

Focus areas:
{focus_areas}

Output guidance:
{output_guidance}

Venue: {venue['name']}
Venue review form:
{review_form}

{search_instruction}

Paper briefing from the briefing agent:
{_stringify(paper_brief)}

Return only this JSON shape:
{{
  "roleId": "{role['id']}",
  "roleName": "{role['name']}",
  "focusAreas": string[],
  "summary": string,
  "strengths": string[],
  "weaknesses": string[],
  "questions": string[],
  "recommendation": string,
  "confidence": number
}}

Review policy:
- Optimize for helping authors improve acceptance odds, not for imitating hostile reviewer style.
- Identify concrete weaknesses with paper evidence. Say "not shown" or "unclear" only when the PDF actually leaves it missing or ambiguous. Avoid common but no concrete weakness point.
- For experiment concerns, name the missing comparison, ablation, metric, stress test, dataset type, or reproducibility detail.
- Keep novelty concerns proportional; do not reject primarily for novelty if correctness, evidence, clarity, and usefulness are strong.
- Make every weakness actionable enough that the analyzer can turn it into a PDF annotation or general suggestion."""


def build_debate_prompt(
    venue: dict,
    role: dict,
    paper_brief: dict,
    round_num: int,
    total_rounds: int,
    own_prior: dict,
    all_reviews: list[dict],
    prior_rounds: list[dict],
) -> str:
    return f"""You are acting as this AIReviewer role in debate round {round_num} of {total_rounds}:
Role id: {role['id']}
Role name: {role['name']}
Stance: {role['stance']}

Mission:
{_fmt_list(role['mission'])}

Focus areas:
{_fmt_list(role['focus_areas'])}

Venue: {venue['name']}

Paper briefing:
{_stringify(paper_brief)}

Your prior review:
{_stringify(own_prior)}

Current reviewer positions before this round:
{_stringify(all_reviews)}

Prior debate rounds:
{_stringify(prior_rounds)}

Return only this JSON shape:
{{
  "roleId": "{role['id']}",
  "roleName": "{role['name']}",
  "focusAreas": string[],
  "summary": string,
  "strengths": string[],
  "weaknesses": string[],
  "questions": string[],
  "recommendation": string,
  "confidence": number
}}

Debate instructions:
- Revise your review after considering the other agents' strongest arguments.
- Explicitly keep concerns that remain decision-critical and drop or soften concerns another agent convincingly resolved.
- Add at most one new weakness unless it is grounded in paper evidence or follows directly from another agent's critique.
- Preserve your role stance, but do not repeat unsupported objections.
- By the final configured round, converge to your final position for the AC/meta reviewer.
- Keep the JSON compact: summary under 100 words; at most 5 strengths, 7 weaknesses, and 5 questions; each list item under 45 words."""


def build_meta_prompt(
    venue: dict,
    paper_brief: dict,
    role_reviews: list[dict],
    debate_rounds: list[dict],
    review_context: str = "",
) -> str:
    ctx = (
        f"User-provided review context and examples:\n{review_context}"
        if review_context.strip()
        else "User-provided review context: none."
    )
    return f"""Act as the {venue['name']} AC/meta-review agent for AIReviewer.

Your job is to synthesize the final reviewer roles after multi-agent debate. Do not average them mechanically. Identify the decision-critical risks, the highest-leverage fixes before submission, and whether the paper appears below, borderline, near, or above the venue bar.

Paper briefing:
{_stringify(paper_brief)}

Reviewer role outputs:
{_stringify(role_reviews)}

Three-round debate history:
{_stringify(debate_rounds)}

{ctx}

Return only this JSON shape:
{{
  "readiness": "below_bar" | "borderline" | "near_bar" | "above_bar",
  "decisionRationale": string,
  "mostImportantRisks": string[],
  "highestLeverageFixes": string[]
}}

Synthesis rules:
- Be specific about why the readiness label follows from the role outputs.
- Prioritize risks that affect acceptance, not cosmetic polish.
- If the skeptical role raises a concern that other roles contradict, resolve the conflict explicitly in the rationale.
- Novelty matters, but correctness, evidence, clarity, and usefulness also carry venue-bar weight."""


def build_analyzer_prompt(
    venue: dict,
    paper_brief: dict,
    role_reviews: list[dict],
    debate_rounds: list[dict],
    meta_review: dict,
    search_enabled: bool,
    review_context: str = "",
) -> str:
    source_instruction = (
        "If grounded search was used, include source objects for concrete external related-work "
        "or guideline evidence used. Do not add sources for generic knowledge."
        if search_enabled
        else "Search was disabled; return sources only for venue guideline URLs already provided "
        "in the venue context when useful."
    )
    ctx = (
        f"User-provided review context and examples:\n{review_context}"
        if review_context.strip()
        else "User-provided review context: none."
    )
    guidelines = _fmt_list(venue["guideline_urls"])
    return f"""Act as the AIReviewer improvement analyzer.

Your input is the paper briefing, the final reviewer positions after the configured debate rounds, the debate history, and AC/meta synthesis. Convert them into concrete pre-submission fixes and annotation-ready suggestions.

Venue: {venue['name']}
Guideline URLs:
{guidelines}

Paper briefing:
{_stringify(paper_brief)}

Reviewer role outputs:
{_stringify(role_reviews)}

Three-round debate history:
{_stringify(debate_rounds)}

AC/meta synthesis:
{_stringify(meta_review)}

{ctx}

Return only this JSON shape:
{{
  "improvementPlan": string[],
  "suggestions": [
    {{
      "id": string,
      "agent": "standard_reviewer" | "hard_reviewer" | "methodology_reviewer" | "related_work_reviewer" | "writing_reviewer" | "ac_meta_reviewer" | "improvement_analyzer",
      "targetType": "general" | "section" | "sentence" | "figure" | "table",
      "section": string,
      "anchorText": string,
      "pageHint": number,
      "severity": "low" | "medium" | "high",
      "confidence": number,
      "rationale": string,
      "action": string,
      "rebuttalQuestion": string
    }}
  ],
  "sources": [
    {{ "title": string, "url": string, "note": string }}
  ]
}}

Suggestion policy:
- Create 4 to 10 suggestions, ranked by impact on acceptance odds.
- Use the agent field to credit the role that found the concern; use improvement_analyzer only for synthesized cross-role fixes.
- For localized issues, copy the shortest exact anchorText likely to appear in the PDF. For general issues, set targetType to "general" and anchorText to "".
- Experiment actions must name the missing baseline, ablation, stress test, metric, dataset, or reporting detail.
- Writing actions must name the claim, section, or wording that should change.
- Related-work actions must explain what comparison, positioning, or citation gap should be addressed.
- Every suggestion needs a rebuttalQuestion that lets the user point to evidence already in the PDF.
- {source_instruction}"""


def compose_complete_review(
    venue: dict,
    paper_brief: dict,
    role_reviews: list[dict],
    debate_rounds: list[dict],
    meta_review: dict,
    analyzer: dict,
) -> str:
    standard = next((r for r in role_reviews if r.get("roleId") == "standard_reviewer"), None)
    hard = next((r for r in role_reviews if r.get("roleId") == "hard_reviewer"), None)
    specialists = [
        r for r in role_reviews
        if r.get("roleId") not in ("standard_reviewer", "hard_reviewer")
    ]

    def fmt_role(review: dict | None) -> str:
        if not review:
            return "- Not specified"
        strengths = _fmt_list(review.get("strengths", []))
        weaknesses = _fmt_list(review.get("weaknesses", []))
        questions = _fmt_list(review.get("questions", []))
        conf = round(review.get("confidence", 0.5) * 100)
        return (
            f"{review.get('roleName', review.get('roleId', ''))}\n"
            f"Summary: {review.get('summary', 'Not specified')}\n"
            f"Strengths\n{strengths}\n"
            f"Weaknesses\n{weaknesses}\n"
            f"Questions\n{questions}\n"
            f"Recommendation: {review.get('recommendation', 'Not specified')} (confidence {conf}%)"
        )

    def fmt_debate(rounds: list[dict]) -> str:
        if not rounds:
            return "- Not specified"
        parts = []
        for rnd in rounds:
            lines = [f"Round {rnd['round']}"]
            for review in rnd.get("roleReviews", []):
                lines.append(
                    f"- {review.get('roleName', review.get('roleId', ''))}: "
                    f"{review.get('summary', 'No summary')} "
                    f"Recommendation: {review.get('recommendation', 'Not specified')}"
                )
            parts.append("\n".join(lines))
        return "\n\n".join(parts)

    specialists_text = (
        "\n\n".join(fmt_role(r) for r in specialists) if specialists else "- Not specified"
    )
    readiness = meta_review.get("readiness", "borderline").replace("_", " ")

    return f"""AIReviewer Complete Review for {venue['name']}

Paper Brief
Title: {paper_brief.get('title', 'Untitled')}
Summary: {paper_brief.get('oneSentenceSummary', 'Not specified')}

Claimed Contributions
{_fmt_list(paper_brief.get('claimedContributions', []))}

Standard Reviewer
{fmt_role(standard)}

Hard Reviewer
{fmt_role(hard)}

Specialist Reviewer Findings
{specialists_text}

Three-Round Reviewer Debate
{fmt_debate(debate_rounds)}

Area Chair Assessment
Readiness: {readiness}
Rationale: {meta_review.get('decisionRationale', 'Not specified')}

Most Important Risks
{_fmt_list(meta_review.get('mostImportantRisks', []))}

Highest Leverage Fixes
{_fmt_list(meta_review.get('highestLeverageFixes', []))}

Improvement Plan
{_fmt_list(analyzer.get('improvementPlan', []))}"""


# ---------------------------------------------------------------------------
# JSON parsing helpers
# ---------------------------------------------------------------------------


def _strip_fences(text: str) -> str:
    text = text.strip()
    if text.startswith("```"):
        text = text[text.index("\n") + 1:] if "\n" in text else text[3:]
    if text.endswith("```"):
        text = text[: text.rfind("```")]
    return text.strip()


def parse_json_response(raw: str) -> dict:
    raw = _strip_fences(raw)
    return json.loads(raw)


# ---------------------------------------------------------------------------
# Gemini client
# ---------------------------------------------------------------------------


class GeminiClient:
    def __init__(self, api_key: str, model: str):
        try:
            from google import genai
            from google.genai import types as gtypes
        except ImportError:
            print("Error: google-genai package not found. Install it with: pip install google-genai", file=sys.stderr)
            sys.exit(1)

        self._genai = genai
        self._types = gtypes
        self._client = genai.Client(api_key=api_key)
        self.model = model
        self._file_uri: str | None = None
        self._file_mime: str = "application/pdf"

    async def upload_pdf(self, pdf_path: Path) -> None:
        print(f"  Uploading {pdf_path.name} to Gemini Files API ...")
        loop = asyncio.get_event_loop()
        uploaded = await loop.run_in_executor(
            None,
            lambda: self._client.files.upload(
                file=str(pdf_path),
                config=self._types.UploadFileConfig(
                    mime_type="application/pdf",
                    display_name=pdf_path.name,
                ),
            ),
        )
        self._file_uri = uploaded.uri
        self._file_mime = uploaded.mime_type or "application/pdf"
        print(f"  Uploaded (uri={self._file_uri})")

    async def generate_structured(
        self,
        system_prompt: str,
        user_prompt: str,
        search_enabled: bool = False,
    ) -> dict:
        types = self._types

        pdf_part = types.Part.from_uri(
            file_uri=self._file_uri,
            mime_type=self._file_mime,
        )
        text_part = types.Part.from_text(text=user_prompt)

        config_kwargs: dict = {
            "system_instruction": system_prompt,
            "response_mime_type": "application/json",
        }
        if search_enabled:
            config_kwargs["tools"] = [types.Tool(google_search=types.GoogleSearch())]

        loop = asyncio.get_event_loop()
        response = await loop.run_in_executor(
            None,
            lambda: self._client.models.generate_content(
                model=self.model,
                contents=[
                    types.Content(
                        role="user",
                        parts=[pdf_part, text_part],
                    )
                ],
                config=types.GenerateContentConfig(**config_kwargs),
            ),
        )
        raw = response.text or ""
        return parse_json_response(raw)


# ---------------------------------------------------------------------------
# Multi-agent review orchestrator
# ---------------------------------------------------------------------------


async def run_review(
    client: GeminiClient,
    venue: dict,
    debate_rounds: int,
    search_enabled: bool,
    review_context: str = "",
    on_progress=None,
) -> dict:

    def progress(step: str, message: str) -> None:
        if on_progress:
            on_progress(step, message)
        else:
            print(f"  [{step}] {message}")

    system_prompt = build_system_prompt(venue)

    # ---- 1. Briefing -------------------------------------------------------
    progress("briefing", "Extracting paper structure ...")
    paper_brief = await client.generate_structured(
        system_prompt=system_prompt,
        user_prompt=build_briefing_prompt(venue),
    )

    # ---- 2. Initial role reviews (parallel) --------------------------------
    progress("agents", f"Running {len(REVIEWER_ROLES)} reviewer roles in parallel ...")

    async def review_role(role: dict) -> dict:
        result = await client.generate_structured(
            system_prompt=system_prompt,
            user_prompt=build_reviewer_role_prompt(venue, role, paper_brief, search_enabled),
            search_enabled=search_enabled and role["uses_search"],
        )
        result.setdefault("roleId", role["id"])
        result.setdefault("roleName", role["name"])
        result.setdefault("focusAreas", role["focus_areas"])
        return result

    role_reviews: list[dict] = list(
        await asyncio.gather(*[review_role(role) for role in REVIEWER_ROLES])
    )

    # ---- 3. Debate rounds --------------------------------------------------
    all_debate_rounds: list[dict] = []
    for round_num in range(1, debate_rounds + 1):
        progress(
            f"debate-{round_num}",
            f"Debate round {round_num}/{debate_rounds} — all roles in parallel ...",
        )
        current_reviews = list(role_reviews)

        async def debate_role(role: dict) -> dict:
            own_prior = next(
                (r for r in current_reviews if r.get("roleId") == role["id"]),
                current_reviews[0] if current_reviews else {},
            )
            result = await client.generate_structured(
                system_prompt=system_prompt,
                user_prompt=build_debate_prompt(
                    venue, role, paper_brief,
                    round_num, debate_rounds,
                    own_prior, current_reviews, all_debate_rounds,
                ),
            )
            result.setdefault("roleId", role["id"])
            result.setdefault("roleName", role["name"])
            result.setdefault("focusAreas", role["focus_areas"])
            return result

        round_results: list[dict] = list(
            await asyncio.gather(*[debate_role(role) for role in REVIEWER_ROLES])
        )
        role_reviews = round_results
        all_debate_rounds.append({"round": round_num, "roleReviews": round_results})

    # ---- 4. Meta review ----------------------------------------------------
    progress("meta", "AC/meta-reviewer synthesizing final positions ...")
    meta_review = await client.generate_structured(
        system_prompt=system_prompt,
        user_prompt=build_meta_prompt(
            venue, paper_brief, role_reviews, all_debate_rounds, review_context
        ),
    )

    # ---- 5. Improvement analyzer ------------------------------------------
    progress("analysis", "Improvement analyzer producing concrete suggestions ...")
    analyzer = await client.generate_structured(
        system_prompt=system_prompt,
        user_prompt=build_analyzer_prompt(
            venue, paper_brief, role_reviews, all_debate_rounds,
            meta_review, search_enabled, review_context,
        ),
        search_enabled=search_enabled,
    )

    # ---- Assemble final output --------------------------------------------
    standard_review = next(
        (r for r in role_reviews if r.get("roleId") == "standard_reviewer"), role_reviews[0]
    )
    hard_review = next(
        (r for r in role_reviews if r.get("roleId") == "hard_reviewer"),
        role_reviews[0],
    )

    complete_review = compose_complete_review(
        venue, paper_brief, role_reviews, all_debate_rounds, meta_review, analyzer
    )

    return {
        "paperBrief": paper_brief,
        "standardReview": standard_review,
        "hardReview": hard_review,
        "roleReviews": role_reviews,
        "debateRounds": all_debate_rounds,
        "metaReview": meta_review,
        "improvementPlan": analyzer.get("improvementPlan", []),
        "suggestions": analyzer.get("suggestions", []),
        "sources": analyzer.get("sources", []),
        "completeReview": complete_review,
    }


# ---------------------------------------------------------------------------
# Output formatting
# ---------------------------------------------------------------------------


def format_summary(filename: str, result: dict) -> str:
    meta = result.get("metaReview", {})
    brief = result.get("paperBrief", {})
    readiness = meta.get("readiness", "unknown").replace("_", " ").upper()
    title = brief.get("title", filename)
    rationale = meta.get("decisionRationale", "")
    risks = meta.get("mostImportantRisks", [])
    fixes = meta.get("highestLeverageFixes", [])
    suggestions = result.get("suggestions", [])

    lines = [
        "=" * 72,
        f"File:      {filename}",
        f"Title:     {title}",
        f"Readiness: {readiness}",
        "",
        f"Rationale: {rationale}",
        "",
    ]
    if risks:
        lines.append("Most Important Risks:")
        lines.extend(f"  [{s.get('severity','?').upper()[:1]}] {r}" for r, s in zip(risks, suggestions))
        lines.append("")
    if fixes:
        lines.append("Highest-Leverage Fixes:")
        lines.extend(f"  - {f}" for f in fixes)
        lines.append("")
    if suggestions:
        lines.append(f"Suggestions ({len(suggestions)} total):")
        for s in suggestions[:5]:
            sev = s.get("severity", "medium").upper()
            lines.append(f"  [{sev}] {s.get('action', s.get('rationale', ''))[:120]}")
        if len(suggestions) > 5:
            lines.append(f"  ... and {len(suggestions) - 5} more (see JSON output)")
        lines.append("")
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


async def process_papers(
    pdfs: list[Path],
    api_key: str,
    model: str,
    venue: dict,
    debate_rounds: int,
    search: bool,
    output_path: Path,
) -> None:
    results: dict = {}

    for i, pdf in enumerate(pdfs, 1):
        print(f"\n[{i}/{len(pdfs)}] {pdf.name}")
        client = GeminiClient(api_key=api_key, model=model)
        try:
            await client.upload_pdf(pdf)
            result = await run_review(
                client=client,
                venue=venue,
                debate_rounds=debate_rounds,
                search_enabled=search,
            )
            results[pdf.name] = {"status": "ok", "review": result}
            print(format_summary(pdf.name, result))
        except Exception as exc:
            print(f"  ERROR: {exc}", file=sys.stderr)
            results[pdf.name] = {"status": "error", "error": str(exc)}

    output_path.write_text(json.dumps(results, indent=2, ensure_ascii=False))
    print(f"\nResults saved to {output_path}")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Batch review papers with the AIReviewer multi-agent pipeline",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument("input_folder", help="Folder containing PDF files")
    parser.add_argument("gemini_api_key", help="Gemini API key")
    parser.add_argument(
        "--venue",
        default="neurips",
        choices=list(VENUES.keys()),
        help="Target venue (default: neurips)",
    )
    parser.add_argument(
        "--debate-rounds",
        type=int,
        default=3,
        choices=[0, 1, 2, 3],
        help="Number of multi-agent debate rounds (default: 3)",
    )
    parser.add_argument(
        "--search",
        action="store_true",
        help="Enable web search for the related-work reviewer",
    )
    parser.add_argument(
        "--model",
        default="gemini-2.5-pro-preview-05-06",
        help="Gemini model name (default: gemini-2.5-pro-preview-05-06)",
    )
    parser.add_argument(
        "--output",
        default="review_results.json",
        help="JSON output file (default: review_results.json)",
    )
    args = parser.parse_args()

    input_folder = Path(args.input_folder)
    if not input_folder.is_dir():
        print(f"Error: '{input_folder}' is not a directory.", file=sys.stderr)
        sys.exit(1)

    pdfs = sorted(input_folder.glob("*.pdf"))
    if not pdfs:
        print(f"No PDF files found in '{input_folder}'.", file=sys.stderr)
        sys.exit(1)

    venue = VENUES[args.venue]
    print(f"Venue:         {venue['name']}")
    print(f"Model:         {args.model}")
    print(f"Debate rounds: {args.debate_rounds}")
    print(f"Web search:    {'enabled' if args.search else 'disabled'}")
    print(f"Papers found:  {len(pdfs)}")

    asyncio.run(
        process_papers(
            pdfs=pdfs,
            api_key=args.gemini_api_key,
            model=args.model,
            venue=venue,
            debate_rounds=args.debate_rounds,
            search=args.search,
            output_path=Path(args.output),
        )
    )


if __name__ == "__main__":
    main()
