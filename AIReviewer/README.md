# AIReviewer

AIReviewer is a local PDF-first agentic review workspace for academic papers. It supports:

- PDF upload and browser-based PDF viewing
- ICLR, NeurIPS, and ICML venue rubrics
- Gemini-first review generation with optional web-grounded search
- OpenRouter fallback
- Structured multi-agent review output
- PDF text indexing and suggestion-to-sentence highlighting
- General chat and targeted rebuttal against suggestions or selected PDF text
- Local SQLite persistence for papers, reviews, annotations, chat, rebuttals, and compacted memory

## Setup

```bash
cd AIReviewer
npm install
cp .env.example .env.local
```

Set at least `GEMINI_API_KEY` in `.env.local` for real review runs. `OPENROUTER_API_KEY` is optional.

```bash
npm run dev
```

Open `http://localhost:3000`.

## Environment

- `GEMINI_API_KEY`: server-side Gemini API key.
- `OPENROUTER_API_KEY`: optional OpenRouter API key.
- `GEMINI_MODEL`: default `gemini-3-pro-preview`.
- `GEMINI_FAST_MODEL`: default `gemini-3-flash-preview`.
- `OPENROUTER_MODEL`: default `openai/gpt-5.2`.
- `AI_REVIEWER_DB_PATH`: SQLite file path, default `./data/aireviewer.sqlite`.
- `AI_REVIEWER_UPLOAD_DIR`: PDF storage directory, default `./data/uploads`.

## Verification

```bash
npm run typecheck
npm run lint
npm test
npm run e2e
```

The e2e test runs with `AI_REVIEWER_ALLOW_FAKE_PROVIDER=1`, so it does not require API keys.
