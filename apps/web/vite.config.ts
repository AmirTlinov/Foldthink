import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { execFileSync } from "node:child_process";

const revision =
  process.env.GITHUB_SHA ??
  execFileSync("git", ["rev-parse", "--short=12", "HEAD"], { encoding: "utf8" }).trim();

export default defineConfig({
  plugins: [react()],
  define: {
    "import.meta.env.VITE_REVISION": JSON.stringify(revision),
  },
  server: {
    proxy: {
      "/api": "http://localhost:8787",
      "/sync": { target: "ws://localhost:8787", ws: true },
    },
  },
  preview: {
    proxy: {
      "/api": "http://localhost:8787",
      "/sync": { target: "ws://localhost:8787", ws: true },
    },
  },
  build: {
    target: "es2022",
    rollupOptions: {
      output: {
        entryFileNames: "assets/app.js",
        chunkFileNames: "assets/[name].js",
        assetFileNames: (asset) =>
          asset.names.some((name) => name.endsWith(".css"))
            ? "assets/app.css"
            : "assets/[name][extname]",
      },
    },
  },
});
