import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const SOURCE_ROOTS = [path.resolve("src"), path.resolve("electron")];
const NAMED_FUNCTION_SCOPE = new Set([
  path.resolve("src/App.tsx"),
  path.resolve("src/components/SubModePanel.tsx"),
  path.resolve("src/components/SubTimelineEditor.tsx"),
  path.resolve("src/lib/api.ts"),
  path.resolve("src/lib/subtitles.ts"),
  path.resolve("src/lib/useSubOperations.ts"),
  path.resolve("src/lib/useModelPreparation.ts"),
]);
const JAPANESE_TEXT = /[\u3040-\u30ff\u3400-\u9fff]/;

function productionSources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return productionSources(target);
    if (!/\.tsx?$/.test(entry.name) || /\.(test|spec)\.tsx?$/.test(entry.name) || entry.name.endsWith(".d.ts")) return [];
    return [target];
  });
}

function isExported(node: ts.Node): boolean {
  return Boolean(ts.getCombinedModifierFlags(node as ts.Declaration) & ts.ModifierFlags.Export);
}

function jsdocText(node: ts.Node): string {
  return ts.getJSDocCommentsAndTags(node).map((item) => item.getText()).join("\n");
}

function callableExport(statement: ts.VariableStatement): boolean {
  if (!isExported(statement)) return false;
  return statement.declarationList.declarations.some((declaration) => {
    const initializer = declaration.initializer;
    if (!initializer) return false;
    if (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer)) return true;
    return ts.isCallExpression(initializer)
      && initializer.arguments.some((argument) => ts.isArrowFunction(argument) || ts.isFunctionExpression(argument));
  });
}

function undocumentedFunctions(filePath: string): string[] {
  const sourceText = readFileSync(filePath, "utf8");
  const sourceFile = ts.createSourceFile(
    filePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    filePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const failures: string[] = [];
  const relative = path.relative(process.cwd(), filePath).replaceAll("\\", "/");

  function inspect(node: ts.Node) {
    if (ts.isFunctionDeclaration(node) && node.name) {
      if (isExported(node) || NAMED_FUNCTION_SCOPE.has(filePath)) {
        if (!JAPANESE_TEXT.test(jsdocText(node))) {
          failures.push(`${relative}:${sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1} ${node.name.text}`);
        }
      }
    } else if (ts.isVariableStatement(node) && callableExport(node)) {
      if (!JAPANESE_TEXT.test(jsdocText(node))) {
        for (const declaration of node.declarationList.declarations) {
          failures.push(`${relative}:${sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1} ${declaration.name.getText()}`);
        }
      }
    }
    ts.forEachChild(node, inspect);
  }

  inspect(sourceFile);
  return failures;
}

describe("日本語JSDoc contract", () => {
  it("公開関数と変更対象の名前付き関数に日本語の責務説明がある", () => {
    const failures = SOURCE_ROOTS.flatMap(productionSources).flatMap(undocumentedFunctions);
    expect(failures, failures.join("\n")).toEqual([]);
  });
});
