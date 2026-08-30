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
    {
      name: "web-does-not-import-simulation",
      severity: "error",
      from: { path: "^apps/web/" },
      to: { path: "^(packages/simulation|@god-sim/simulation)" },
    },
    {
      name: "simulation-does-not-import-io-or-cognition",
      severity: "error",
      from: { path: "^packages/simulation/" },
      to: {
        path: "^(apps/|packages/(cognition|timeline|model-gateway|sqlite-store)/|@god-sim/(cognition|timeline|model-gateway|sqlite-store))",
      },
    },
    {
      name: "cognition-does-not-import-simulation",
      severity: "error",
      from: { path: "^packages/cognition/" },
      to: { path: "^(packages/simulation/|@god-sim/simulation)" },
    },
    {
      name: "no-workspace-deep-imports",
      severity: "error",
      from: { path: "^(apps|packages|plugins)/" },
      to: { path: "^@god-sim/[^/]+/.+" },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    exclude: "(^|/)(dist|coverage|node_modules)/",
    tsConfig: { fileName: "tsconfig.json" },
  },
};

