"use strict";

// ExcelJS 4 expects the old synchronous factory; Archiver 8 exports classes.
// Node 22.12+ supports require(ESM). Keep this adapter ZIP-only: it must fail
// visibly, rather than silently substitute a different archive format.
const { ZipArchive } = require("archiver");
const { PassThrough } = require("node:stream");
module.exports = function excelArchive(format, options) {
  if (format !== "zip") throw new TypeError("Excel archive adapter supports ZIP only");
  const archive = new ZipArchive(options);
  const append = archive.append;
  archive.append = function appendExcelSource(source, data) {
    // ExcelJS StreamBuf implements pipe() but does not initialise native stream
    // state. Archiver 8 correctly requires a readable/writable stream. Bridge
    // that legacy pipe contract, including errors, without buffering the XLSX.
    if (source && typeof source.pipe === "function" && !source.readable && !source.writable) {
      const legacy = source;
      const bridge = new PassThrough();
      const forwardError = error => bridge.destroy(error);
      legacy.on("error", forwardError);
      bridge.once("close", () => legacy.removeListener("error", forwardError));
      legacy.pipe(bridge);
      source = bridge;
    }
    return append.call(this, source, data);
  };
  return archive;
};
