import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

const serverFiles = [
  "apps/server/**/*.{ts,tsx}",
  "domains/**/src/public-server.ts",
];

const browserFiles = [
  "apps/web/src/**/*.{ts,tsx}",
  "domains/**/src/public-browser.ts",
];

export default tseslint.config(
  {
    ignores: ["**/node_modules/**", "**/dist/**", "**/coverage/**"],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.mjs"],
    languageOptions: {
      globals: {
        Buffer: "readonly",
        console: "readonly",
        process: "readonly",
      },
    },
  },
  {
    files: ["apps/web/public/sw.js"],
    languageOptions: {
      globals: {
        URL: "readonly",
        caches: "readonly",
        fetch: "readonly",
        self: "readonly",
      },
    },
  },
  {
    files: ["**/*.cjs"],
    languageOptions: {
      sourceType: "commonjs",
      globals: {
        module: "readonly",
        require: "readonly",
      },
    },
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
  {
    files: browserFiles,
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { group: ["node:*"], message: "Browser entry points cannot reach Node.js." },
            { group: ["pg", "postgres"], message: "Browser entry points cannot reach PostgreSQL." },
          ],
        },
      ],
    },
  },
  {
    files: serverFiles,
    rules: {
      "no-restricted-globals": [
        "error",
        { name: "document", message: "Server entry points cannot reach the DOM." },
        { name: "window", message: "Server entry points cannot reach the DOM." },
        { name: "indexedDB", message: "Server entry points cannot reach IndexedDB." },
      ],
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { group: ["react", "react-dom", "react-dom/*"], message: "Server entry points cannot reach React rendering." },
          ],
        },
      ],
    },
  },
);
