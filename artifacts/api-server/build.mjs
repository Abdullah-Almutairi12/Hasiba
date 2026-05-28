import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build as esbuild } from "esbuild";
import esbuildPluginPino from "esbuild-plugin-pino";
import { rm, cp } from "node:fs/promises";

// Plugins (e.g. 'esbuild-plugin-pino') may use `require` to resolve dependencies
globalThis.require = createRequire(import.meta.url);

const artifactDir = path.dirname(fileURLToPath(import.meta.url));

async function buildAll() {
  const distDir = path.resolve(artifactDir, "dist");
  await rm(distDir, { recursive: true, force: true });

  await esbuild({
    entryPoints: [path.resolve(artifactDir, "src/index.ts")],
    platform: "node",
    bundle: true,
    format: "esm",
    outdir: distDir,
    outExtension: { ".js": ".mjs" },
    logLevel: "info",
    // Some packages may not be bundleable, so we externalize them, we can add more here as needed.
    // Some of the packages below may not be imported or installed, but we're adding them in case they are in the future.
    // Examples of unbundleable packages:
    // - uses native modules and loads them dynamically (e.g. sharp)
    // - use path traversal to read files (e.g. @google-cloud/secret-manager loads sibling .proto files)
    external: [
      "*.node",
      "sharp",
      "better-sqlite3",
      "sqlite3",
      "canvas",
      "bcrypt",
      "argon2",
      "fsevents",
      "re2",
      "farmhash",
      "xxhash-addon",
      "bufferutil",
      "utf-8-validate",
      "ssh2",
      "cpu-features",
      "dtrace-provider",
      "isolated-vm",
      "lightningcss",
      "pg-native",
      "oracledb",
      "mongodb-client-encryption",
      "nodemailer",
      "handlebars",
      "knex",
      "typeorm",
      "protobufjs",
      "onnxruntime-node",
      "@tensorflow/*",
      "@prisma/client",
      "@mikro-orm/*",
      "@grpc/*",
      "@swc/*",
      "@aws-sdk/*",
      "@azure/*",
      "@opentelemetry/*",
      "@google-cloud/*",
      "@google/*",
      "googleapis",
      "firebase-admin",
      "@parcel/watcher",
      "@sentry/profiling-node",
      "@tree-sitter/*",
      "aws-sdk",
      "classic-level",
      "dd-trace",
      "ffi-napi",
      "grpc",
      "hiredis",
      "kerberos",
      "leveldown",
      "miniflare",
      "mysql2",
      "newrelic",
      "odbc",
      "piscina",
      "realm",
      "ref-napi",
      "rocksdb",
      "sass-embedded",
      "sequelize",
      "serialport",
      "snappy",
      "tinypool",
      "usb",
      "workerd",
      "wrangler",
      "zeromq",
      "zeromq-prebuilt",
      "playwright",
      "puppeteer",
      "puppeteer-core",
      "electron",
      // Large pure-JS runtime libs we don't need to bundle. Keeping
      // them external in node_modules drops the bundle from ~9MB
      // to ~1MB without changing runtime behaviour (Node resolves
      // them normally at startup). Saves cold-start parse cost.
      "openai",
      // @sentry/node lazy-requires @opentelemetry/instrumentation-* packages
      // (http, express, …) at init time. Externalising keeps the bundle from
      // pulling them in statically — @opentelemetry/* is already external
      // above. Without this, runtime fails with ERR_MODULE_NOT_FOUND.
      "@sentry/*",
      "exceljs",
      "pdfkit",
      "qrcode",
      "arabic-reshaper",
      "bidi-js",
      "google-auth-library",
      // NOTE: do NOT externalize `@peculiar/x509` / `node-forge` /
      // `tsyringe` — they require `reflect-metadata` to be loaded
      // before any of them resolve. Bundling guarantees esbuild's
      // module-init order; externalizing breaks the polyfill chain.
    ],
    sourcemap: "linked",
    plugins: [
      // pino relies on workers to handle logging, instead of externalizing it we use a plugin to handle it
      esbuildPluginPino({ transports: ["pino-pretty"] })
    ],
    // Make sure packages that are cjs only (e.g. express) but are bundled continue to work in our esm output file
    banner: {
      js: `import { createRequire as __bannerCrReq } from 'node:module';
import __bannerPath from 'node:path';
import __bannerUrl from 'node:url';

globalThis.require = __bannerCrReq(import.meta.url);
globalThis.__filename = __bannerUrl.fileURLToPath(import.meta.url);
globalThis.__dirname = __bannerPath.dirname(globalThis.__filename);
    `,
    },
  });

  // pdfkit reads its built-in font metric files (`.afm`) from disk at runtime
  // using a path relative to its own source. esbuild bundles the JS but not the
  // `.afm` data files, so we copy them next to the bundled output.
  try {
    const require = createRequire(import.meta.url);
    const pdfkitDir = path.dirname(require.resolve("pdfkit/package.json"));
    const dataSrc = path.resolve(pdfkitDir, "js/data");
    const dataDest = path.resolve(distDir, "data");
    await cp(dataSrc, dataDest, { recursive: true });
    console.log(`✓ Copied pdfkit font data → ${path.relative(artifactDir, dataDest)}`);
  } catch (err) {
    console.warn("⚠ pdfkit font data copy skipped:", err?.message || err);
  }

  // Bundle our own Arabic TTF font(s) next to the output so generated PDFs
  // (purchase orders, etc.) can register them at runtime with pdfkit.
  try {
    const fontsSrc = path.resolve(artifactDir, "src/lib/pdf/fonts");
    const fontsDest = path.resolve(distDir, "fonts");
    await cp(fontsSrc, fontsDest, { recursive: true });
    console.log(`✓ Copied PDF fonts → ${path.relative(artifactDir, fontsDest)}`);
  } catch (err) {
    console.warn("⚠ PDF font copy skipped:", err?.message || err);
  }
}

buildAll().catch((err) => {
  console.error(err);
  process.exit(1);
});
