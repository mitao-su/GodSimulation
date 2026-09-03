const workspaceModules = [
  { name: "@god-sim/protocol", root: "packages/protocol", allowed: [] },
  {
    name: "@god-sim/plugin-sdk",
    root: "packages/plugin-sdk",
    allowed: ["@god-sim/protocol"],
  },
  {
    name: "@god-sim/simulation",
    root: "packages/simulation",
    allowed: ["@god-sim/plugin-sdk", "@god-sim/protocol"],
  },
  {
    name: "@god-sim/cognition",
    root: "packages/cognition",
    allowed: ["@god-sim/plugin-sdk", "@god-sim/protocol"],
  },
  {
    name: "@god-sim/timeline",
    root: "packages/timeline",
    allowed: ["@god-sim/protocol"],
  },
  {
    name: "@god-sim/model-gateway",
    root: "packages/model-gateway",
    allowed: ["@god-sim/protocol"],
  },
  {
    name: "@god-sim/sqlite-store",
    root: "packages/sqlite-store",
    allowed: ["@god-sim/protocol", "@god-sim/timeline"],
  },
  { name: "@god-sim/web", root: "apps/web", allowed: ["@god-sim/protocol"] },
  {
    name: "@god-sim/simulation-worker",
    root: "apps/simulation-worker",
    allowed: [
      "@god-sim/cognition",
      "@god-sim/plugin-sdk",
      "@god-sim/protocol",
      "@god-sim/simulation",
    ],
  },
  {
    name: "@god-sim/local-server",
    root: "apps/local-server",
    allowed: [
      "@god-sim/model-gateway",
      "@god-sim/protocol",
      "@god-sim/sqlite-store",
      "@god-sim/timeline",
    ],
  },
  {
    name: "@god-sim/spatial-objects",
    root: "plugins/spatial-objects",
    allowed: ["@god-sim/plugin-sdk", "@god-sim/protocol"],
    plugin: true,
  },
  {
    name: "@god-sim/home-objects",
    root: "plugins/home-objects",
    allowed: ["@god-sim/plugin-sdk", "@god-sim/protocol"],
    plugin: true,
  },
  {
    name: "@god-sim/starter-agents",
    root: "plugins/starter-agents",
    allowed: ["@god-sim/plugin-sdk", "@god-sim/protocol"],
    plugin: true,
  },
];

const nonPluginModules = workspaceModules.filter((module) => !module.plugin);
const officialPlugins = workspaceModules.filter((module) => module.plugin);

function escapeRegex(value) {
  return value.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
}

function targetPattern(modules) {
  const roots = modules.map((module) => escapeRegex(module.root)).join("|");
  const aliases = modules
    .map((module) => escapeRegex(module.name.replace("@god-sim/", "")))
    .join("|");
  return "^(?:(?:" + roots + ")(?:/|$)|@god-sim/(?:" + aliases + ")(?:/|$))";
}

function workspaceAllowListRule(module) {
  const allowed = new Set([module.name, ...module.allowed]);
  const disallowed = nonPluginModules.filter((candidate) => !allowed.has(candidate.name));
  return {
    name: module.name.slice("@god-sim/".length) + "-workspace-allow-list",
    severity: "error",
    from: { path: "^" + escapeRegex(module.root) + "/src(?:/|$)" },
    to: { path: targetPattern(disallowed) },
  };
}

function officialPluginCompositionRule(module) {
  const disallowed = officialPlugins.filter((candidate) => candidate.name !== module.name);
  return {
    name: module.name.slice("@god-sim/".length) + "-no-production-plugin-composition",
    severity: "error",
    from: {
      path: "^" + escapeRegex(module.root) + "/src(?:/|$)",
      pathNot: "\\.(?:test|spec)\\.[cm]?[jt]sx?$",
    },
    to: { path: targetPattern(disallowed) },
  };
}

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "no-circular",
      severity: "error",
      from: {},
      to: { circular: true },
    },
    {
      name: "packages-do-not-import-apps",
      severity: "error",
      from: { path: "^(packages|plugins)/" },
      to: { path: "^apps/" },
    },
    ...workspaceModules.map(workspaceAllowListRule),
    ...workspaceModules.map(officialPluginCompositionRule),
    {
      name: "no-workspace-deep-imports",
      severity: "error",
      from: { path: "^(apps|packages|plugins)/" },
      to: { path: "^@god-sim/[^/]+/.+" },
    },
    {
      // Inner simulation layers must depend on the narrow operation
      // runtime registry protocol, never on the engine composition root.
      name: "simulation-inner-layers-skip-composition-root",
      severity: "error",
      from: { path: "^packages/simulation/src/(execution|decision)(?:/|$)" },
      to: { path: "^packages/simulation/src/engine/simulation-registry" },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    exclude: "(^|/)(dist|coverage|node_modules)/",
    tsConfig: { fileName: "tsconfig.json" },
  },
};
