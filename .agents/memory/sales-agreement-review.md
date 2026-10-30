---
name: Commercial agreement review
description: Distinguish draft entry estimates from confirmed server-priced agreements.
---

The original sales UI must not treat a local entry estimate as a confirmed
commercial agreement. Users must see the persisted server-priced amount and
discount sources before confirming an order.

**Why:** Automatic pricing rules can legitimately change a local draft estimate;
implicitly confirming during save makes an undisclosed adjustment look agreed.
The user requires review before agreement, not a prohibition on automatic rules.

**How to apply:** Keep draft creation distinct from confirmation in the native
workflow. Preserve historic agreed prices and existing approval/tax controls.
Never recompute an old agreement from today's catalogue merely to match a draft.
