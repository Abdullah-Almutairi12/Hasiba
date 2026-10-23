"""Render only synthetic print evidence; keep outputs out of source history."""
from pathlib import Path
import sys, json
import pymupdf as fitz
for name in sys.argv[1:]:
    path = Path(name)
    document = fitz.open(path)
    for index, page in enumerate(document):
        out = path.with_name(f"{path.stem}-page-{index+1}.png")
        page.get_pixmap(matrix=fitz.Matrix(1.5,1.5)).save(str(out))
    path.with_suffix(".text.txt").write_text("\n".join(p.get_text() for p in document))
    print(json.dumps({"file":str(path),"pages":len(document),"size":[list(p.rect) for p in document]},ensure_ascii=False))
