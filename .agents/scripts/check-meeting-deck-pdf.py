"""Render the actual partner PDF and retain a reproducible page inventory."""
import hashlib
import json
from pathlib import Path

import fitz
from PIL import Image, ImageDraw

source = Path(".local/outputs/Hasiba-AI-ERP.pdf")
out = Path("generated-artifacts/meeting-update/pdf-review")
out.mkdir(parents=True, exist_ok=True)
doc = fitz.open(source)
inventory = []
thumbs = []
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
    thumb = Image.open(image_path).convert("RGB")
    thumb.thumbnail((640, 360))
    canvas = Image.new("RGB", (660, 400), "white")
    canvas.paste(thumb, (10, 25))
    ImageDraw.Draw(canvas).text((10, 5), f"Page {index + 1}", fill="black")
    thumbs.append(canvas)

for offset in range(0, len(thumbs), 8):
    group = thumbs[offset:offset + 8]
    sheet = Image.new("RGB", (1320, 400 * ((len(group) + 1) // 2)), "#dddddd")
    for j, thumb in enumerate(group):
        sheet.paste(thumb, ((j % 2) * 660, (j // 2) * 400))
    sheet.save(out / f"contact-{offset // 8 + 1}.jpg", quality=90)

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
