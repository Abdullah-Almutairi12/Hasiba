// Same no-send invariants as the write-failure check, but require a rejected read.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checkBrowserReturnStorageBlock } from "./check-browser-return-storage-block.mjs";

export function checkBrowserReturnStorageReadBlock(proxy, browser) {
  checkBrowserReturnStorageBlock(proxy, browser, "getItem");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = new URL("../generated-artifacts/verification/", import.meta.url);
  checkBrowserReturnStorageReadBlock(
    JSON.parse(readFileSync(new URL("browser-return-storage-block-proxy.json", dir), "utf8")),
    JSON.parse(readFileSync(new URL("browser-return-storage-read-block.json", dir), "utf8")),
  );
  console.log("PASS: return key read rejected before any write; form retained; zero browser/proxy POSTs; no return, financial receipt or stock restoration; storage restored.");
}
