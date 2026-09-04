import { readdir, readFile } from "node:fs/promises";
import { dirname, extname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";

const SOURCE_ROOTS = ["apps", "packages", "plugins"];
const SOURCE_EXTENSIONS = new Set([".cjs", ".js", ".mjs", ".ts", ".tsx"]);
const TEST_FILE = /\.(?:spec|test)\.[cm]?[jt]sx?$/u;
const EXCLUDED_DIRECTORY = /(?:^|\/)(?:dist|dist-types|node_modules|testing)(?:\/|$)/u;
const SNAPSHOT_MIGRATION = /(?:^|\/)snapshot-migrations(?:\/|$)/u;

const RULE_POLICY_NAMES = [
  "attenuationpercloseddoor",
  "attenuationperopendoor",
  "attenuationpertile",
  "attenuationperwall",
  "attentionbudgettokens",
  "capacityunits",
  "defaultdurationticks",
  "deletionthreshold",
  "forcedsleepthreshold",
  "fullcontentthreshold",
  "halflifedays",
  "initialstrength",
  "maxdurationticks",
  "maxreturntokensperoperation",
  "secondspergametick",
  "technicalhardlimittokens",
  "timepressurefullatticks",
  "timeweight",
  "tickspercell",
  "tokenweight",
  "unclearcontentthreshold",
];

const RULE_POLICY_PATHS = new Set([
  "rankingweights.currentstrength",
  "rankingweights.keywordmatch",
  "rankingweights.semanticsimilarity",
  "speaksourcestrength.loud",
  "speaksourcestrength.normal",
  "speaksourcestrength.quiet",
]);

const CORE_DURATION_NAMES = ["durationticks", "totalticks"];

function normalizeName(value) {
  return value.replace(/[^a-z0-9]/giu, "").toLowerCase();
}

function propertyName(node) {
  if (ts.isIdentifier(node) || ts.isStringLiteralLike(node)) return node.text;
  return null;
}

function matchingPolicyName(value) {
  const normalized = normalizeName(value);
  return RULE_POLICY_NAMES.find((name) => normalized.includes(name)) ?? null;
}

function matchingDurationName(value) {
  const normalized = normalizeName(value);
  return CORE_DURATION_NAMES.find((name) => normalized.includes(name)) ?? null;
}

function nearestNamedDeclaration(node) {
  let current = node.parent;
  while (current && !ts.isSourceFile(current)) {
    if (
      ts.isPropertyAssignment(current) ||
      ts.isPropertyDeclaration(current) ||
      ts.isVariableDeclaration(current)
    ) {
      return current;
    }
    current = current.parent;
  }
  return null;
}

function declarationName(node) {
  if (ts.isVariableDeclaration(node)) {
    return ts.isIdentifier(node.name) ? node.name.text : null;
  }
  return propertyName(node.name);
}

function containsFiniteCheck(node, checkedExpressionText, source) {
  let found = false;
  const visit = (current) => {
    if (
      ts.isPrefixUnaryExpression(current) &&
      current.operator === ts.SyntaxKind.ExclamationToken &&
      ts.isCallExpression(current.operand) &&
      ts.isPropertyAccessExpression(current.operand.expression) &&
      current.operand.expression.expression.getText(source) === "Number" &&
      current.operand.expression.name.text === "isFinite" &&
      current.operand.arguments.length === 1 &&
      current.operand.arguments[0]?.getText(source) === checkedExpressionText
    ) {
      found = true;
      return;
    }
    ts.forEachChild(current, visit);
  };
  visit(node);
  return found;
}

function isFiniteValidationBoundary(node, source) {
  if (node.text !== "0" || !ts.isBinaryExpression(node.parent)) return false;
  const comparison = node.parent;
  const boundaryTokens = new Set([
    ts.SyntaxKind.GreaterThanEqualsToken,
    ts.SyntaxKind.GreaterThanToken,
    ts.SyntaxKind.LessThanEqualsToken,
    ts.SyntaxKind.LessThanToken,
  ]);
  if (!boundaryTokens.has(comparison.operatorToken.kind)) return false;
  const checkedExpression = comparison.left === node
    ? comparison.right
    : comparison.left;
  let condition = comparison;
  while (
    ts.isBinaryExpression(condition.parent) ||
    ts.isParenthesizedExpression(condition.parent)
  ) {
    condition = condition.parent;
  }
  if (
    !ts.isIfStatement(condition.parent) ||
    condition.parent.expression !== condition
  ) {
    return false;
  }
  const ifStatement = condition.parent;
  const throws =
    ts.isThrowStatement(ifStatement.thenStatement) ||
    (ts.isBlock(ifStatement.thenStatement) &&
      ifStatement.thenStatement.statements.some(ts.isThrowStatement));
  return throws && containsFiniteCheck(
    ifStatement.expression,
    checkedExpression.getText(source),
    source,
  );
}

function isStructuralNumericLiteral(node, source) {
  const parent = node.parent;
  if (
    ts.isElementAccessExpression(parent) &&
    parent.argumentExpression === node
  ) {
    return true;
  }
  if (
    node.text === "0" &&
    ts.isBinaryExpression(parent) &&
    parent.right === node &&
    [
      ts.SyntaxKind.EqualsEqualsEqualsToken,
      ts.SyntaxKind.EqualsEqualsToken,
      ts.SyntaxKind.ExclamationEqualsEqualsToken,
      ts.SyntaxKind.ExclamationEqualsToken,
    ].includes(parent.operatorToken.kind) &&
    ts.isBinaryExpression(parent.left) &&
    parent.left.operatorToken.kind === ts.SyntaxKind.PercentToken
  ) {
    return true;
  }
  if (isFiniteValidationBoundary(node, source)) return true;
  return (
    node.text === "1" &&
    ts.isBinaryExpression(parent) &&
    parent.operatorToken.kind === ts.SyntaxKind.MinusToken &&
    parent.right === node &&
    ts.isPropertyAccessExpression(parent.left) &&
    parent.left.name.text === "length"
  );
}

function propertyPath(node) {
  if (!ts.isPropertyAssignment(node)) return [];
  const names = [];
  let current = node;
  while (ts.isPropertyAssignment(current)) {
    const name = propertyName(current.name);
    if (name === null) break;
    names.unshift(normalizeName(name));
    const object = current.parent;
    if (!ts.isObjectLiteralExpression(object) || !ts.isPropertyAssignment(object.parent)) {
      break;
    }
    current = object.parent;
  }
  return names;
}

function matchingPolicyPath(path) {
  for (let start = 0; start < path.length; start += 1) {
    const candidate = path.slice(start).join(".");
    if (RULE_POLICY_PATHS.has(candidate)) return candidate;
  }
  return null;
}

function identifiersIn(node) {
  const names = [];
  const visit = (current) => {
    if (ts.isIdentifier(current)) names.push(current.text);
    ts.forEachChild(current, visit);
  };
  visit(node);
  return names;
}

function comparisonPolicyName(node) {
  let current = node.parent;
  while (current && !ts.isStatement(current) && !ts.isSourceFile(current)) {
    if (ts.isBinaryExpression(current)) {
      const comparisonTokens = new Set([
        ts.SyntaxKind.EqualsEqualsEqualsToken,
        ts.SyntaxKind.EqualsEqualsToken,
        ts.SyntaxKind.GreaterThanEqualsToken,
        ts.SyntaxKind.GreaterThanToken,
        ts.SyntaxKind.LessThanEqualsToken,
        ts.SyntaxKind.LessThanToken,
      ]);
      if (!comparisonTokens.has(current.operatorToken.kind)) return null;
      const other = current.left === node ? current.right : current.left;
      for (const name of identifiersIn(other)) {
        const match = matchingPolicyName(name) ?? matchingDurationName(name);
        if (match !== null) return match;
      }
      return null;
    }
    current = current.parent;
  }
  return null;
}

function isAllowedVersionedDuration(filename, policyName) {
  if (!CORE_DURATION_NAMES.includes(policyName)) return false;
  return filename.startsWith("plugins/") || SNAPSHOT_MIGRATION.test(filename);
}

function isExcludedSource(filename) {
  return TEST_FILE.test(filename) || EXCLUDED_DIRECTORY.test(filename);
}

export function findPolicyLiteralViolations(sourceText, filename) {
  const normalizedFilename = filename.replaceAll("\\", "/");
  if (isExcludedSource(normalizedFilename)) return [];
  const kind = normalizedFilename.endsWith(".tsx")
    ? ts.ScriptKind.TSX
    : normalizedFilename.endsWith(".ts")
      ? ts.ScriptKind.TS
      : ts.ScriptKind.JS;
  const source = ts.createSourceFile(
    normalizedFilename,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    kind,
  );
  const violations = [];

  const visit = (node) => {
    if (ts.isNumericLiteral(node)) {
      if (isStructuralNumericLiteral(node, source)) {
        ts.forEachChild(node, visit);
        return;
      }
      const declaration = nearestNamedDeclaration(node);
      const name = declaration === null ? null : declarationName(declaration);
      const policyName =
        (name === null
          ? null
          : matchingPolicyName(name) ?? matchingDurationName(name)) ??
        (declaration === null
          ? null
          : matchingPolicyPath(propertyPath(declaration))) ??
        comparisonPolicyName(node);

      if (
        policyName !== null &&
        !isAllowedVersionedDuration(normalizedFilename, policyName)
      ) {
        const position = source.getLineAndCharacterOfPosition(node.getStart(source));
        violations.push({
          column: position.character + 1,
          filename: normalizedFilename,
          line: position.line + 1,
          policyName,
          value: node.text,
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return violations;
}

async function sourceFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await sourceFiles(path)));
    else if (entry.isFile() && SOURCE_EXTENSIONS.has(extname(entry.name))) files.push(path);
  }
  return files;
}

export async function scanSimulationPolicyLiterals(projectRoot) {
  const violations = [];
  for (const sourceRoot of SOURCE_ROOTS) {
    const root = resolve(projectRoot, sourceRoot);
    for (const filename of await sourceFiles(root)) {
      const relativeFilename = relative(projectRoot, filename).replaceAll("\\", "/");
      if (isExcludedSource(relativeFilename)) continue;
      violations.push(
        ...findPolicyLiteralViolations(
          await readFile(filename, "utf8"),
          relativeFilename,
        ),
      );
    }
  }
  return violations;
}

async function main() {
  const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const violations = await scanSimulationPolicyLiterals(projectRoot);
  if (violations.length === 0) return;
  for (const violation of violations) {
    process.stderr.write(
      `${violation.filename}:${violation.line}:${violation.column} ` +
        `simulation policy ${violation.policyName} uses literal ${violation.value}\n`,
    );
  }
  process.stderr.write(
    "Move adjustable simulation values to the world-locked rules or versioned content.\n",
  );
  process.exitCode = 1;
}

if (
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await main();
}
