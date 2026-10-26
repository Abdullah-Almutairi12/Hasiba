---
name: Settings ownership and operational authority
description: Legacy configuration ownership and the boundary between stored preferences and authoritative operating policies
---

Unassigned historic application settings must remain unassigned until ownership
is evidenced. Never adopt the singleton for the first company or silently copy its
credentials into new company defaults.

**Why:** The old application used one shared settings record without tenant
provenance. Its contents cannot establish who owns them; adopting it would expose
one organization's credentials or identity to another.

**How to apply:** Preserve the historic/platform record, use explicit company and
branch ownership for new preferences, and require an independently reviewed
ownership decision before any selective legacy transfer.

Saving a generic settings preference is not evidence that a financial, tax,
device, mail, or subscription engine consumes or activates it.

**Why:** Authoritative policies and issued evidence already live in dedicated
services. Treating a settings checkbox as activation would create a second,
inconsistent authority source and unsupported claims.

**How to apply:** Trace each operating setting to its real consumer before
claiming functional inheritance; preserve dedicated service authorization and
historical documents. Bind save intent to the company as well as the revision,
since revisions can coincide across companies.
