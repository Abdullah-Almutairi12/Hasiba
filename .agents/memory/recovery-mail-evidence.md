---
name: Recovery mail evidence
description: Distinguish relay acceptance from mailbox receipt, and security retries from financial retries.
---
SMTP acceptance is not proof of mailbox delivery. A recovery mail retry must reuse the original token and expiry; a lost acknowledgement can cause a duplicate email, not a new recovery authority.

**Why:** The user required isolated provider tests without external sends and prohibited claiming receipt before a real-channel acceptance test. SMTP and PostgreSQL cannot commit atomically; calling the relay result “delivered” would overstate evidence.

**How to apply:** Keep account recovery delivery explicitly opt-in even when other modules have SMTP configured. Test failures and lost acknowledgements on loopback. Report live mailbox acceptance separately. Do not apply email's permissible duplicate-message semantics to financial transactions.
