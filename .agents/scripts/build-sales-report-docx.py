"""Build a self-contained, logical-Unicode Arabic Word report without extra packages."""
from pathlib import Path
from xml.sax.saxutils import escape
import argparse
import json
import re
import subprocess
import zipfile
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[2]
W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"

def run(text, bold=False):
    parts = re.split(r"(`[^`]+`)", text)
    result = []
    for part in parts:
        if not part:
            continue
        code = part.startswith("`") and part.endswith("`")
        part = part[1:-1] if code else part.replace("**", "")
        rtl = "0" if code or not re.search(r"[\u0600-\u06ff]", part) else "1"
        result.append(f'<w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/><w:rtl w:val="{rtl}"/>'
                      + ("<w:b/><w:bCs/>" if bold else "")
                      + f'</w:rPr><w:t xml:space="preserve">{escape(part)}</w:t></w:r>')
    return "".join(result)

def paragraph(text, style="Normal"):
    return f'<w:p><w:pPr><w:pStyle w:val="{style}"/><w:bidi/><w:jc w:val="right"/></w:pPr>{run(text)}</w:p>'

def table(rows):
    count = max(len(r) for r in rows)
    widths = [620, 2800, 2000, 1200, 3000] if count == 5 else [9620 // count] * count
    body = ['<w:tbl><w:tblPr><w:tblW w:w="9620" w:type="dxa"/><w:bidiVisual/>'
            '<w:tblBorders><w:top w:val="single" w:sz="4" w:color="CBD5E1"/>'
            '<w:bottom w:val="single" w:sz="4" w:color="CBD5E1"/>'
            '<w:insideH w:val="single" w:sz="4" w:color="E2E8F0"/>'
            '<w:insideV w:val="single" w:sz="4" w:color="E2E8F0"/></w:tblBorders></w:tblPr><w:tblGrid>']
    body += [f'<w:gridCol w:w="{width}"/>' for width in widths]
    body.append('</w:tblGrid>')
    for row_index, row in enumerate(rows):
        body.append('<w:tr>' + ('<w:trPr><w:tblHeader/></w:trPr>' if row_index == 0 else ''))
        for index, cell in enumerate(row):
            body.append(f'<w:tc><w:tcPr><w:tcW w:w="{widths[index]}" w:type="dxa"/>'
                        + ('<w:shd w:fill="E2E8F0"/>' if row_index == 0 else '')
                        + '</w:tcPr>' + paragraph(cell, "TableText") + '</w:tc>')
        body.append('</w:tr>')
    body.append('</w:tbl>')
    return ''.join(body)

def markdown(text):
    output, rows = [], []
    def flush():
        if rows:
            output.append(table(rows))
            rows.clear()
    for line in text.splitlines():
        if line.startswith('|'):
            cells = [c.strip() for c in line.strip().strip('|').split('|')]
            if not all(re.fullmatch(r":?-+:?", c) for c in cells):
                rows.append(cells)
            continue
        flush()
        if not line.strip():
            continue
        if line.startswith('#'):
            level = len(line) - len(line.lstrip('#'))
            output.append(paragraph(line.lstrip('#').strip(), f"Heading{min(level,3)}"))
        else:
            output.append(paragraph("• " + line[2:] if line.startswith("- ") else line))
    flush()
    return ''.join(output)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--facts", type=Path, required=True)
    parser.add_argument("--output", type=Path, default=ROOT/"generated-artifacts/delivery/hasiba-implementation-report-ar.docx")
    args = parser.parse_args()
    facts = json.loads(args.facts.read_text())
    ledger = (ROOT/"docs/enterprise-requirements-ar.md").read_text()
    ids = set(re.findall(r"^\|\s*(\d{2}\.\d+)\s*\|", ledger, re.M))
    assert len(ids) == 73, f"Original requirement ID count changed: {len(ids)}"
    report = (ROOT/"docs/sales-documents-and-attribution-ar.md").read_text()
    body = paragraph("نتائج النسخة المسلّمة", "Heading1")
    body += ''.join(paragraph(f"{key}: {value}") for key, value in facts.items())
    body += markdown(report)
    changed = subprocess.check_output(
        ["git","diff","--name-only","before-document-identity-seller-20261023","HEAD"],
        cwd=ROOT, text=True,
    )
    body += paragraph("ملفات الدفعة المحفوظة في النسخة المحلية", "Heading1")
    body += ''.join(paragraph(f"`{p}`") for p in changed.splitlines() if p)
    body += paragraph("ملحق: سجل المتطلبات الأصلي وحالته — 73 معرفًا دون إعادة ترقيم", "Heading1") + markdown(ledger)
    document = f'<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="{W}"><w:body>{body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/></w:sectPr></w:body></w:document>'
    styles = f'<w:styles xmlns:w="{W}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="ar-SA" w:bidi="ar-SA"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:bidi/><w:spacing w:after="100" w:line="300" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>'
    styles += '<w:style w:type="paragraph" w:styleId="Normal"><w:name w:val="Normal"/></w:style>'
    for level, size in [(1,32),(2,28),(3,24)]:
        styles += f'<w:style w:type="paragraph" w:styleId="Heading{level}"><w:name w:val="heading {level}"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:outlineLvl w:val="{level-1}"/><w:spacing w:before="200" w:after="120"/></w:pPr><w:rPr><w:b/><w:bCs/><w:color w:val="124E66"/><w:sz w:val="{size}"/><w:szCs w:val="{size}"/></w:rPr></w:style>'
    styles += '<w:style w:type="paragraph" w:styleId="TableText"><w:name w:val="Table text"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="60"/></w:pPr><w:rPr><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr></w:style></w:styles>'
    files = {
        "[Content_Types].xml": '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>',
        "_rels/.rels": '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
        "word/document.xml": document,
        "word/styles.xml": styles,
        "word/_rels/document.xml.rels": '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    for value in files.values():
        ET.fromstring(value)
    with zipfile.ZipFile(args.output, "w", zipfile.ZIP_DEFLATED) as archive:
        for path, content in files.items():
            archive.writestr(path, content)
    with zipfile.ZipFile(args.output) as archive:
        assert archive.testzip() is None
        text = "".join(ET.fromstring(archive.read("word/document.xml")).itertext())
        assert "محاسبة" in text or "المحاسبة" in text
        assert all(reference in text for reference in ids)
    print(args.output.relative_to(ROOT))

if __name__ == "__main__":
    main()
