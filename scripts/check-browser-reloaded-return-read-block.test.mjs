import { test } from "node:test";
import assert from "node:assert/strict";
import { evidence as reopenedEvidence } from "./check-browser-reopened-return.test.mjs";
import { checkBrowserReloadedReturnReadBlock as check } from "./check-browser-reloaded-return-read-block.mjs";

function evidence() {
  const { proxy: p, browser: b } = reopenedEvidence();
  const stage = (observedAt) => ({ ...structuredClone(b.afterLostResponse), timeOrigin: 115, observedAt });
  b.beforeBlockedSave = stage(130);
  b.afterBlockedSave = { ...stage(140),
    error: "تعذر حفظ مفتاح العملية بأمان. لم يُرسل الطلب؛ فعّل تخزين الجلسة وأعد المحاولة." };
  b.restored = { ...stage(150), originalGetItemRestored: true, originalSetItemRestored: true,
    originalRemoveItemRestored: true, originalFetchRestored: true, financialWriteReadRemoved: true };
  b.afterSuccess.timeOrigin = 115;
  Object.assign(b, { faultMethod: "getItem", faultName: "SecurityError",
    blockedKeys: [p.events[0].storageKey], financialWriteKeys: [], financialRemoveKeys: [],
    unrelatedStorageWorked: true, blockedReturnPostCount: 0, recoveryReturnPostCount: 1 });
  const blocked = structuredClone(p);
  blocked.events.pop();
  blocked.returnPostCount = 1;
  blocked.receiptsObservedAt = 160;
  return [p, b, blocked];
}

test("accepts persisted uncertain return read fault after real reload then replay", () => check(...evidence()));
for (const [name, mutate] of [
  ["no reload", ([, b]) => { b.beforeBlockedSave.timeOrigin = 1; }],
  ["changed data", ([, b]) => { b.afterBlockedSave.fields.quantity = "2"; }],
  ["missing key", ([, b]) => { b.beforeBlockedSave.entries = []; }],
  ["replaced key", ([, b]) => { b.restored.entries[0][1] = "new"; }],
  ["wrong operation", ([, b]) => { b.blockedKeys[0] = "other"; }],
  ["wrong fault", ([, b]) => { b.faultMethod = "setItem"; }],
  ["wrong exception", ([, b]) => { b.faultName = "Error"; }],
  ["write attempted", ([, b]) => { b.financialWriteKeys.push("key"); }],
  ["remove attempted", ([, b]) => { b.financialRemoveKeys.push("key"); }],
  ["browser POST during fault", ([, b]) => { b.blockedReturnPostCount++; }],
  ["proxy POST during fault", ([,, p]) => { p.returnPostCount++; }],
  ["missing storage message", ([, b]) => { b.afterBlockedSave.error = "network error"; }],
  ["form closed", ([, b]) => { b.afterBlockedSave.formOpen = false; }],
  ["getter not restored", ([, b]) => { b.restored.originalGetItemRestored = false; }],
  ["probe failed", ([, b]) => { b.restored.financialWriteReadRemoved = false; }],
  ["unrelated storage blocked", ([, b]) => { b.unrelatedStorageWorked = false; }],
  ["stale blocked snapshot", ([,, p]) => { p.receiptsObservedAt = 139; }],
  ["blocked snapshot after replay", ([,, p]) => { p.receiptsObservedAt = 201; }],
  ["foreign run", ([,, p]) => { p.runId = "other"; }],
  ["extra restock while blocked", ([,, p]) => { p.finalReturnState.stock++; }],
  ["new key on recovery", ([p]) => { p.events[1].key = "new"; }],
  ["no replay", ([p]) => { p.events[1].replayed = false; }],
  ["extra stock after replay", ([p]) => { p.finalReturnState.stock++; }],
  ["no recovery request", ([, b]) => { b.recoveryReturnPostCount = 0; }],
]) {
  test(`rejects ${name}`, () => {
    const args = evidence();
    mutate(args);
    assert.throws(() => check(...args));
  });
}
