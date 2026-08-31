import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

const revision =
  process.env.GITHUB_SHA ??
  execFileSync("git", ["rev-parse", "--short=12", "HEAD"], { encoding: "utf8" }).trim();

export default defineConfig({
  plugins: [react()],
  define: {
    "import.meta.env.VITE_REVISION": JSON.stringify(revision),
  },
  server: {
    headers: { "Access-Control-Allow-Origin": "*" },
    proxy: {
      "/api": "http://127.0.0.1:8787",
      "/sync": { target: "ws://127.0.0.1:8787", ws: true },
    },
  },
  preview: {
    headers: { "Access-Control-Allow-Origin": "*" },
    proxy: {
      "/api": "http://127.0.0.1:8787",
      "/sync": { target: "ws://127.0.0.1:8787", ws: true },
    },
  },
  build: {
    target: "es2022",
    rollupOptions: {
      input: {
        app: resolve(import.meta.dirname, "index.html"),
        "widget-frame": resolve(import.meta.dirname, "widget-frame.html"),
      },
      output: {
        entryFileNames: (chunk) =>
          chunk.name === "widget-frame" ? "assets/widget-frame.js" : "assets/app.js",
        chunkFileNames: "assets/[name].js",
        assetFileNames: (asset) =>
          asset.names.some((name) => name.endsWith(".css"))
            ? "assets/app.css"
            : "assets/[name][extname]",
      },
    },
  },
});
