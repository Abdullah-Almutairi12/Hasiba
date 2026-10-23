"""Render only synthetic verification PDFs, never application/customer records."""
from pathlib import Path
import pymupdf

root = Path(__file__).resolve().parents[2]
directory = root / "generated-artifacts" / "document-evidence"
for source in sorted(directory.glob("*.pdf")):
    document = pymupdf.open(source)
    for number in sorted({0, len(document) - 1}):
        page = document[number]
        clip = pymupdf.Rect(0, 0, page.rect.width, min(page.rect.height, 900))
        target = source.with_name(f"{source.stem}-page-{number + 1}.png")
        page.get_pixmap(matrix=pymupdf.Matrix(1.6, 1.6), clip=clip).save(target)
    print(f"{source.name}: {len(document)} page(s), {document[0].rect.width * 25.4 / 72:.1f} mm")
