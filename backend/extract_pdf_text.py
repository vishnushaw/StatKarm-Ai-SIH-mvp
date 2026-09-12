"""Extract logical reading-order text from a text-based PDF using pypdf."""

from pathlib import Path
import sys

from pypdf import PdfReader

# pypdf can return punctuation and language characters outside the active
# Windows console code page. The Node upload service consumes UTF-8 stdout.
sys.stdout.reconfigure(encoding="utf-8", errors="replace")


def main() -> int:
    if len(sys.argv) != 2:
        print("Usage: extract_pdf_text.py <pdf-path>", file=sys.stderr)
        return 2

    reader = PdfReader(Path(sys.argv[1]))
    pages = [(page.extract_text() or "").strip() for page in reader.pages]
    print("\n".join(page for page in pages if page))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
