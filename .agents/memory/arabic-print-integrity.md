---
name: Arabic print integrity
description: Why visual Arabic correctness alone is insufficient for printable and searchable documents.
---

Pass logical Unicode to one shaping/bidi pipeline; do not pre-shape and reverse Arabic before another shaping engine.

**Why:** The previous mixed pipeline corrupted Arabic, and native fallback could fail on font positioning. A replacement initially looked correct but copied lam-alef words in the wrong order.

**How to apply:** Require rendered-page inspection plus extracted words such as «سلام» و«الإقرار» and mixed Arabic/Latin identifiers. Check both font weights are embedded from bundled, licensed files in a clean built runtime. A CSS font shorthand resets OpenType feature settings: put deliberate ligature settings after it, and repeat copy/search checks when fonts or typography change.

Include signed amounts embedded in Arabic prose as well as standalone table cells.

**Why:** Correct numeric columns did not prevent a minus sign from moving in a free-text Arabic note.

**How to apply:** Isolate complete signed tokens without treating hyphens inside ISO dates or document references as negative amounts; verify both the visual sign and extracted logical text.

Do not wait for a style-tag load event in a Chromium page with JavaScript disabled.

**Why:** Playwright's style injection waited until the PDF deadline even for inline page sizing in that configuration.

**How to apply:** Prepare the stylesheet before rendering or synchronously insert the page-size rule after measurement. Retain the existing single native Arabic text pipeline.
