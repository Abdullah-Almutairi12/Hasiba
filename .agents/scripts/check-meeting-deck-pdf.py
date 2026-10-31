"""Render the actual partner PDF and retain a reproducible page inventory."""
import hashlib
import json
from pathlib import Path

import fitz

source = Path(".local/outputs/Hasiba-AI-ERP.pdf")
out = Path("generated-artifacts/meeting-update/pdf-review")
out.mkdir(parents=True, exist_ok=True)
doc = fitz.open(source)
inventory = []
for index, page in enumerate(doc):
    pix = page.get_pixmap(matrix=fitz.Matrix(0.8, 0.8), alpha=False)
    image_path = out / f"page-{index + 1:02d}.png"
    pix.save(image_path)
    text = page.get_text()
    bounds = page.rect
    outside = []
    for block in page.get_text("dict")["blocks"]:
        if block.get("type") != 0:
            continue
        rect = fitz.Rect(block["bbox"])
        if not (bounds + (-1, -1, 1, 1)).contains(rect):
            outside.append(list(rect))
    inventory.append({
        "page": index + 1, "width": bounds.width, "height": bounds.height,
        "textCharacters": len(text), "outOfPageTextBlocks": outside,
        "image": str(image_path),
    })

for offset in range(0, len(doc), 8):
    count = min(8, len(doc) - offset)
    sheet_doc = fitz.open()
    sheet = sheet_doc.new_page(width=1320, height=400 * ((count + 1) // 2))
    for j in range(count):
        x, y = (j % 2) * 660, (j // 2) * 400
        sheet.insert_text((x + 10, y + 18), f"Page {offset + j + 1}", fontsize=12)
        sheet.show_pdf_page(fitz.Rect(x + 10, y + 25, x + 650, y + 385), doc, offset + j)
    sheet.get_pixmap(alpha=False).save(out / f"contact-{offset // 8 + 1}.png")
    sheet_doc.close()

result = {
    "file": str(source), "sha256": hashlib.sha256(source.read_bytes()).hexdigest(),
    "bytes": source.stat().st_size, "pages": len(doc),
    "allPagesHaveText": all(row["textCharacters"] > 10 for row in inventory),
    "outOfPageTextBlocks": sum(len(row["outOfPageTextBlocks"]) for row in inventory),
    "inventory": inventory,
    "note": "Geometry and text inventory are not a substitute for visual Arabic/RTL review.",
}
(out / "inventory.json").write_text(json.dumps(result, ensure_ascii=False, indent=2))
print(json.dumps({key: value for key, value in result.items() if key != "inventory"}, ensure_ascii=False))
