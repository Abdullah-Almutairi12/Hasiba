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

Distinguish cold Chromium startup failures from Arabic shaping, PDF generation and financial transaction failures.

**Why:** Under the full verification load, the first receipt launch exceeded its startup budget although later receipts and financial assertions succeeded. Raising only a test's deadline could not fix the real HTTP 500.

**How to apply:** Diagnose the failing stage from the native renderer log. Keep a bounded startup allowance separate from content/output deadlines, preserve concurrency and network restrictions, and retain real PDF assertions rather than skipping printing.

Continuous DOM measurements do not prove Chromium's named-page print fragmentation will preserve a thermal tail.

**Why:** Even a measured sheet with apparent free space pushed its QR and note onto another full-height page; adding a small height allowance or inheriting the named page did not resolve it.

**How to apply:** Verify actual PDF page counts, content bounds and QR placement. For variable thermal lengths, isolate each bounded sheet in the native renderer and preserve its vector pages when assembling; fail on an unexpected extra page instead of cropping or accepting blank paper.
