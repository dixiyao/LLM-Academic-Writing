#!/usr/bin/env python3
"""
Simple Gemini paper reviewer.

Sends each PDF directly to Gemini with a single review prompt.
No multi-agent pipeline, no server required.

Requirements:
    pip install google-genai

Usage:
    python review_papers_gemini.py <input_folder> <gemini_api_key> [options]
    python review_papers_gemini.py ./papers AIzaSy...
    python review_papers_gemini.py ./papers AIzaSy... --model gemini-2.5-pro-preview-05-06
"""

import argparse
import json
import sys
from pathlib import Path

REVIEW_PROMPT = (
    "Please refer to the ICLR 2026 review guideline to have a fair and reasonable "
    "judge on the paper."
)


def review_paper(client, types, model: str, pdf_path: Path) -> str:
    uploaded = client.files.upload(
        file=str(pdf_path),
        config=types.UploadFileConfig(
            mime_type="application/pdf",
            display_name=pdf_path.name,
        ),
    )
    response = client.models.generate_content(
        model=model,
        contents=[
            types.Content(
                role="user",
                parts=[
                    types.Part.from_uri(
                        file_uri=uploaded.uri,
                        mime_type=uploaded.mime_type or "application/pdf",
                    ),
                    types.Part.from_text(text=REVIEW_PROMPT),
                ],
            )
        ],
    )
    return response.text or ""


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Review papers with a single Gemini call per paper",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument("input_folder", help="Folder containing PDF files")
    parser.add_argument("gemini_api_key", help="Gemini API key")
    parser.add_argument(
        "--model",
        default="gemini-2.5-pro-preview-05-06",
        help="Gemini model name (default: gemini-2.5-pro-preview-05-06)",
    )
    parser.add_argument(
        "--output",
        default="review_results_gemini.json",
        help="JSON output file (default: review_results_gemini.json)",
    )
    args = parser.parse_args()

    try:
        from google import genai
        from google.genai import types as gtypes
    except ImportError:
        print("Error: google-genai not found. Install with: pip install google-genai", file=sys.stderr)
        sys.exit(1)

    input_folder = Path(args.input_folder)
    if not input_folder.is_dir():
        print(f"Error: '{input_folder}' is not a directory.", file=sys.stderr)
        sys.exit(1)

    pdfs = sorted(input_folder.glob("*.pdf"))
    if not pdfs:
        print(f"No PDF files found in '{input_folder}'.", file=sys.stderr)
        sys.exit(1)

    client = genai.Client(api_key=args.gemini_api_key)
    print(f"Model:  {args.model}")
    print(f"Papers: {len(pdfs)}\n")

    results: dict = {}
    for i, pdf in enumerate(pdfs, 1):
        print(f"[{i}/{len(pdfs)}] {pdf.name} ...")
        try:
            review = review_paper(client, gtypes, args.model, pdf)
            results[pdf.name] = {"status": "ok", "review": review}
            print(review)
            print("=" * 72)
        except Exception as exc:
            print(f"  ERROR: {exc}", file=sys.stderr)
            results[pdf.name] = {"status": "error", "error": str(exc)}

    Path(args.output).write_text(json.dumps(results, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"\nResults saved to {args.output}")


if __name__ == "__main__":
    main()
