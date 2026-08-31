"use strict";

const { builtinModules } = require("node:module");

const nodeBuiltinPattern = builtinModules
  .map((moduleName) => moduleName.replace(/^node:/, ""))
  .map((moduleName) => moduleName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
  .join("|");

const domainImports = {
  surface: [],
  workspace: ["surface"],
  interaction: ["workspace", "surface"],
  "local-persistence": ["workspace", "surface"],
  identity: [],
  synchronization: ["workspace", "surface", "local-persistence", "identity"],
  asset: ["identity"],
  document: ["workspace", "surface", "asset"],
  "agent-integration": ["workspace", "surface", "interaction"],
};

const domainDirectionRules = Object.entries(domainImports).map(
  ([source, allowedTargets]) => {
    const visibleDomains = [source, ...allowedTargets].join("|");

    return {
      name: `${source}-domain-direction`,
      comment: `${source} may import only its declared Foldthink domains`,
      severity: "error",
      from: { path: `^domains/${source}(?:/|$)` },
      to: { path: `^domains/(?!(?:${visibleDomains})(?:/|$))` },
    };
  },
);

const publicEntryRules = Object.keys(domainImports).map((target) => ({
  name: `${target}-public-entry-only`,
  comment: `Other owners reach ${target} through an explicit public entry point`,
  severity: "error",
  from: {
    path: `^(?!(?:domains/${target})(?:/|$))(?:apps|domains|tests)(?:/|$)`,
  },
  to: {
    path: `^domains/${target}/src/(?!public(?:-(?:browser|server|protocol))?\\.tsx?$)`,
  },
}));

module.exports = {
  forbidden: [
    {
      name: "no-circular-domain-dependencies",
      comment: "An ownership graph must remain acyclic",
      severity: "error",
      from: {},
      to: { circular: true },
    },
    {
      name: "no-unresolved-imports",
      comment: "Package exports must resolve every admitted dependency",
      severity: "error",
      from: {},
      to: { couldNotResolve: true },
    },
    {
      name: "domains-never-import-apps",
      comment: "Composition roots depend on domains; domains never depend on apps",
      severity: "error",
      from: { path: "^domains(?:/|$)" },
      to: { path: "^apps(?:/|$)" },
    },
    {
      name: "domains-never-import-operational-owners",
      comment: "Product meaning does not depend on migration, operations, tests, or scripts",
      severity: "error",
      from: { path: "^domains(?:/|$)" },
      to: { path: "^(?:database|operations|tests|scripts)(?:/|$)" },
    },
    {
      name: "web-never-imports-server",
      comment: "Composition roots meet through domain APIs, never through each other",
      severity: "error",
      from: { path: "^apps/web(?:/|$)" },
      to: { path: "^apps/server(?:/|$)" },
    },
    {
      name: "server-never-imports-web",
      comment: "Composition roots meet through domain APIs, never through each other",
      severity: "error",
      from: { path: "^apps/server(?:/|$)" },
      to: { path: "^apps/web(?:/|$)" },
    },
    {
      name: "apps-never-import-operational-owners",
      comment: "Runtime composition does not depend on migration, operations, tests, or scripts",
      severity: "error",
      from: { path: "^apps(?:/|$)" },
      to: { path: "^(?:database|operations|tests|scripts)(?:/|$)" },
    },
    {
      name: "server-cannot-reach-browser-domains",
      comment: "A server graph cannot reach browser interaction or persistence",
      severity: "error",
      from: {
        path: "^(?:apps/server(?:/|$)|domains/.*/src/public-server\\.tsx?$)",
      },
      to: {
        path: "^domains/(?:interaction|local-persistence|agent-integration)(?:/|$)",
        reachable: true,
      },
    },
    {
      name: "browser-cannot-reach-server-entrypoints",
      comment: "A browser graph cannot cross into a server entry point",
      severity: "error",
      from: {
        path: "^(?:apps/web/src(?:/|$)|domains/.*/src/public-browser\\.tsx?$)",
      },
      to: { path: "^domains/.*/src/public-server\\.tsx?$", reachable: true },
    },
    {
      name: "server-cannot-reach-browser-entrypoints",
      comment: "A server graph cannot cross into a browser entry point",
      severity: "error",
      from: {
        path: "^(?:apps/server(?:/|$)|domains/.*/src/public-server\\.tsx?$)",
      },
      to: { path: "^domains/.*/src/public-browser\\.tsx?$", reachable: true },
    },
    {
      name: "browser-cannot-reach-node-core",
      comment: "Browser entry points cannot reach Node.js built-ins",
      severity: "error",
      from: {
        path: "^(?:apps/web/src(?:/|$)|domains/.*/src/public-browser\\.tsx?$)",
      },
      to: {
        path: `^(?:node:)?(?:${nodeBuiltinPattern})(?:/|$)`,
        reachable: true,
      },
    },
    {
      name: "browser-cannot-reach-postgresql",
      comment: "Browser entry points cannot reach a PostgreSQL driver",
      severity: "error",
      from: {
        path: "^(?:apps/web/src(?:/|$)|domains/.*/src/public-browser\\.tsx?$)",
      },
      to: {
        path: "(?:^|/)node_modules/(?:pg|postgres)(?:/|$)",
        reachable: true,
      },
    },
    {
      name: "server-cannot-reach-react",
      comment: "Server entry points cannot reach browser rendering",
      severity: "error",
      from: {
        path: "^(?:apps/server(?:/|$)|domains/.*/src/public-server\\.tsx?$)",
      },
      to: {
        path: "(?:^|/)node_modules/(?:react|react-dom)(?:/|$)",
        reachable: true,
      },
    },
    {
      name: "yjs-belongs-to-surface",
      comment: "Only the surface domain imports and interprets Yjs",
      severity: "error",
      from: { pathNot: "^domains/surface(?:/|$)" },
      to: { path: "(?:^|/)node_modules/yjs(?:/|$)" },
    },
    ...domainDirectionRules,
    ...publicEntryRules,
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    exclude: { path: "(?:^|/)(?:dist|coverage)(?:/|$)" },
    tsPreCompilationDeps: true,
    preserveSymlinks: false,
    tsConfig: { fileName: "tsconfig.base.json" },
  },
};
