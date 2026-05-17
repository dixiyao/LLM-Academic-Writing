# LLM Academic Writing

> Leveraging Large Language Models to supercharge your academic writing — from automated reviews to grammar polish.

[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[![Contributions Welcome](https://img.shields.io/badge/contributions-welcome-brightgreen.svg)](https://github.com/dixiyao/LLM-Academic-Writing/pulls)

---

## Featured: AIReviewer

**[AIReviewer](AIReviewer/)** — [Project Page](https://dixiyao.github.io/aireviewer)

A local, PDF-first agentic workspace for reviewing academic papers. Drop in a PDF, pick a venue rubric, and get structured multi-agent feedback in seconds — with inline highlighting, chat, and rebuttal support, all stored locally.

| Capability | Details |
|---|---|
| Venue rubrics | ICLR, NeurIPS, ICML |
| Review engine | Gemini (primary) · OpenRouter fallback |
| PDF support | Browser-based viewer, text indexing, suggestion-to-sentence highlighting |
| Interaction | General chat, targeted rebuttal on suggestions or selected PDF text |
| Persistence | Local SQLite — papers, reviews, annotations, chat, rebuttals, compacted memory |

**Quick start:**

```bash
cd AIReviewer
npm install
cp .env.example .env.local   # set GEMINI_API_KEY
npm run dev                  # open http://localhost:3000
```

---

## Other Tools

### GPT Reviewer
- **[GPT4Reviewer](GPTReviewer/)** — Generates structured paper reviews using GPT-4. Customize the [suggestion template](Prompts/suggestion_template.yml) to match your target venue.
- **[GrammarChecker](GPTReviewer/)** — Uses GPT to catch awkward phrasing and unnatural English, a useful complement to spellcheckers like Grammarly or [Writer](https://writer.com) for non-native speakers.

---

## LLM Options

### General-purpose
| Model | Notes |
|---|---|
| [ChatGPT 4o](https://chat.openai.com/) | Most widely used |
| [Llama 3-8B](https://huggingface.co/meta-llama/Meta-Llama-3-8B-Instruct) | Open weights, HF inference API |
| [Octopus-v2](GenerativeLLM/octopus.py) | Lightweight on-device option |

### Academic corpus
| Model | Notes |
|---|---|
| [GALACTICA](https://github.com/paperswithcode/galai) | Scientific language model |
| [BLOOM](https://huggingface.co/bigscience/bloom) | Autoregressive LLM, HF inference API |

### Document understanding
- [Scispace](https://typeset.io/) — paper Q&A and explanation
- [LayoutLM](https://huggingface.co/impira/layoutlm-document-qa) — document QA with layout awareness

---

## Prompt Engineering

OpenAI's guide: [Six strategies for better results](https://platform.openai.com/docs/guides/prompt-engineering/six-strategies-for-getting-better-results)

Suggestion template for our tools: [suggestion_template.yml](Prompts/suggestion_template.yml)

**Useful prompts for academic revision:**

```
Check the grammar, make my language more professional, and sound like a native speaker.
```

```
Summarize this paper in one sentence. List key insights and lessons learned.
Generate 3–5 questions for the authors. Suggest 3–5 future research directions.
List at least 5 relevant references. Paper: <paste here>
```

---

## IDE & Browser Extensions

| Tool | Platform | Description |
|---|---|---|
| [OverleafCopilot](https://chromewebstore.google.com/detail/overleaf-copilot/eoadabdpninlhkkbhngoddfjianhlghb) | Chrome | GPT-assisted writing inside Overleaf |
| [SciGPT](https://chromewebstore.google.com/detail/scigpt%EF%BC%9A%E6%80%BB%E7%BB%93%E7%A7%91%E5%AD%A6%E8%AE%BA%E6%96%87/paahiifbajkfokamacmmaakejigmgoke) | Chrome | Academic Q&A with curated prompts |
| [GitHub Copilot](https://marketplace.visualstudio.com/items?itemName=GitHub.copilot) | VS Code | Code and doc writing assistant |
| [Bito](https://marketplace.visualstudio.com/items?itemName=Bito.Bito) | VS Code | GPT-powered code and writing help |

---

## Research & Reading

- [Using LLMs as peer reviewers for revising essays](https://wac.colostate.edu/repository/collections/textgened/rhetorical-engagements/using-llms-as-peer-reviewers-for-revising-essays/)
- [LLM scientific feedback experiment](https://github.com/Weixin-Liang/LLM-scientific-feedback) — compare LLM reviews with real peer reviews
- [ReviewerGPT? (arXiv)](https://arxiv.org/pdf/2306.00622.pdf)

---

## Citation

```bibtex
@misc{yao2024llmwriting,
    author = {Dixi Yao},
    title  = {{LLM}s for Academic Writing},
    url    = {https://github.com/dixiyao/LLM-Academic-Writing},
    year   = {2024}
}
```

*License: [Apache 2.0](LICENSE)*

---

## Contributing

Contributions and collaborations are welcome — pull requests and suggestions are appreciated.
