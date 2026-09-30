import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: { index: "src/index.ts" },
    format: ["esm"],
    target: "es2022",
    platform: "neutral",
    dts: true,
    splitting: false,
  },
  // standalone browser bundle, exposed as the `typhonjs` global (unpkg/jsdelivr)
  {
    entry: { index: "src/index.ts" },
    format: ["iife"],
    globalName: "typhonjs",
    target: "es2022",
    platform: "browser",
    minify: true,
    noExternal: [/.*/],
    outExtension: () => ({ js: ".min.js" }),
  },
]);
