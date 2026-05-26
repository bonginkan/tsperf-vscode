import { performance } from "perf_hooks";
import * as vscode from "vscode";
import * as ts from "typescript";
import { ComplexityResult, scoreType } from "./typeComplexity";
import { clearProjectCache, declarationName, findDeclarationNodes, findNodeAtOffset, loadProjectForFile } from "./tsProject";

interface TypeInspection {
  name: string;
  typeText: string;
  buildMs: number;
  resolveMs: number;
  fileCount: number;
  tsconfigPath?: string;
  complexity: ComplexityResult;
  cacheHit: boolean;
}

let output: vscode.OutputChannel;
let statusBar: vscode.StatusBarItem;

export function activate(context: vscode.ExtensionContext): void {
  output = vscode.window.createOutputChannel("TSPerf");
  statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 90);
  statusBar.command = "tsperf.inspectType";
  context.subscriptions.push(output, statusBar);

  context.subscriptions.push(
    vscode.commands.registerCommand("tsperf.inspectType", inspectTypeCommand),
    vscode.commands.registerCommand("tsperf.inspectFile", inspectFileCommand),
    vscode.commands.registerCommand("tsperf.clearProjectCache", clearProjectCacheCommand),
    vscode.languages.registerCodeLensProvider(
      [{ language: "typescript" }, { language: "typescriptreact" }],
      new TsPerfCodeLensProvider(),
    ),
  );

  refreshStatusVisibility();
  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(refreshStatusVisibility));
  context.subscriptions.push(vscode.workspace.onDidSaveTextDocument(() => clearProjectCache()));
}

export function deactivate(): void {
  statusBar?.dispose();
  output?.dispose();
}

async function inspectTypeCommand(uri?: vscode.Uri, position?: vscode.Position): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  const document = uri ? await vscode.workspace.openTextDocument(uri) : editor?.document;
  if (!document) {
    void vscode.window.showWarningMessage("Open a TypeScript file before running TSPerf.");
    return;
  }
  if (!isTypeScriptDocument(document)) {
    void vscode.window.showWarningMessage("TSPerf only supports TypeScript and TSX files.");
    return;
  }

  const targetPosition = position ?? editor?.selection.active ?? new vscode.Position(0, 0);
  await withProgress("Inspecting TypeScript type", async () => {
    const inspection = inspectNodeAt(document.fileName, document.offsetAt(targetPosition));
    renderInspection(document, targetPosition, inspection);
  });
}

async function inspectFileCommand(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || !isTypeScriptDocument(editor.document)) {
    void vscode.window.showWarningMessage("Open a TypeScript file before running TSPerf.");
    return;
  }

  await withProgress("Scoring TypeScript declarations", async () => {
    const project = loadProjectForFile(editor.document.fileName, { cacheEnabled: getProjectCacheEnabled() });
    const checker = project.program.getTypeChecker();
    const maxDepth = getMaxDepth();
    const rows = findDeclarationNodes(project.sourceFile)
      .slice(0, 300)
      .map((node) => {
        const start = performance.now();
        const type = checker.getTypeAtLocation(node);
        const resolveMs = performance.now() - start;
        return {
          name: declarationName(node),
          line: project.sourceFile.getLineAndCharacterOfPosition(node.getStart(project.sourceFile)).line + 1,
          resolveMs,
          complexity: scoreType(checker, type, { maxDepth }),
          typeText: checker.typeToString(type, node, ts.TypeFormatFlags.NoTruncation),
        };
      })
      .sort((a, b) => b.complexity.score - a.complexity.score || b.resolveMs - a.resolveMs)
      .slice(0, 25);

    output.clear();
    output.appendLine(`TSPerf file report: ${editor.document.fileName}`);
    output.appendLine(`Project build: ${project.buildMs.toFixed(1)} ms, source files: ${project.fileCount}`);
    output.appendLine(`Cache hit: ${project.cacheHit ? "yes" : "no"}`);
    output.appendLine("");
    for (const row of rows) {
      output.appendLine(
        `L${row.line} score=${row.complexity.score} resolve=${row.resolveMs.toFixed(1)}ms ${row.name}`,
      );
      output.appendLine(`  ${row.typeText.slice(0, 300)}`);
    }
    output.show(true);
  });
}

async function clearProjectCacheCommand(): Promise<void> {
  clearProjectCache();
  void vscode.window.showInformationMessage("TSPerf project cache cleared.");
}

function inspectNodeAt(fileName: string, offset: number): TypeInspection {
  const project = loadProjectForFile(fileName, { cacheEnabled: getProjectCacheEnabled() });
  const checker = project.program.getTypeChecker();
  const node = findNodeAtOffset(project.sourceFile, offset);
  const start = performance.now();
  const type = checker.getTypeAtLocation(node);
  const resolveMs = performance.now() - start;
  const typeText = checker.typeToString(
    type,
    node,
    ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.InTypeAlias | ts.TypeFormatFlags.UseAliasDefinedOutsideCurrentScope,
  );
  return {
    name: declarationName(node),
    typeText,
    buildMs: project.buildMs,
    resolveMs,
    fileCount: project.fileCount,
    tsconfigPath: project.tsconfigPath,
    complexity: scoreType(checker, type, { maxDepth: getMaxDepth() }),
    cacheHit: project.cacheHit,
  };
}

function renderInspection(document: vscode.TextDocument, position: vscode.Position, inspection: TypeInspection): void {
  const totalMs = inspection.buildMs + inspection.resolveMs;
  const label = `TSPerf $(pulse) ${inspection.complexity.score} / ${totalMs.toFixed(1)}ms`;
  statusBar.text = label;
  statusBar.tooltip = "TSPerf: complexity score / total project load plus type resolve time";

  output.clear();
  output.appendLine(`TSPerf: ${document.fileName}:${position.line + 1}:${position.character + 1}`);
  output.appendLine(`Node: ${inspection.name}`);
  output.appendLine(`Complexity score: ${inspection.complexity.score}`);
  output.appendLine(`Program build: ${inspection.buildMs.toFixed(1)} ms`);
  output.appendLine(`Type resolve: ${inspection.resolveMs.toFixed(1)} ms`);
  output.appendLine(`Total load: ${totalMs.toFixed(1)} ms`);
  output.appendLine(`Cache hit: ${inspection.cacheHit ? "yes" : "no"}`);
  output.appendLine(`Source files: ${inspection.fileCount}`);
  if (inspection.tsconfigPath) {
    output.appendLine(`tsconfig: ${inspection.tsconfigPath}`);
  }
  output.appendLine("");
  output.appendLine("Breakdown:");
  output.appendLine(`  nodes: ${inspection.complexity.nodes}`);
  output.appendLine(`  properties: ${inspection.complexity.properties}`);
  output.appendLine(`  call signatures: ${inspection.complexity.callSignatures}`);
  output.appendLine(`  construct signatures: ${inspection.complexity.constructSignatures}`);
  output.appendLine(`  index signatures: ${inspection.complexity.indexSignatures}`);
  output.appendLine(`  union parts: ${inspection.complexity.unionParts}`);
  output.appendLine(`  intersection parts: ${inspection.complexity.intersectionParts}`);
  output.appendLine(`  max depth: ${inspection.complexity.maxObservedDepth}`);
  output.appendLine(`  truncated: ${inspection.complexity.truncated ? "yes" : "no"}`);
  output.appendLine("");
  output.appendLine("Type:");
  output.appendLine(inspection.typeText);
  output.show(true);

  void vscode.window.showInformationMessage(`TSPerf score ${inspection.complexity.score}, load ${totalMs.toFixed(1)} ms`);
}

class TsPerfCodeLensProvider implements vscode.CodeLensProvider {
  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    if (!getShowCodeLens() || !isTypeScriptDocument(document)) {
      return [];
    }

    const sourceFile = ts.createSourceFile(document.fileName, document.getText(), ts.ScriptTarget.Latest, true);
    return findDeclarationNodes(sourceFile).slice(0, 200).map((node) => {
      const start = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
      const range = new vscode.Range(start.line, start.character, start.line, start.character);
      return new vscode.CodeLens(range, {
        title: "TSPerf: inspect",
        command: "tsperf.inspectType",
        arguments: [document.uri, new vscode.Position(start.line, start.character)],
      });
    });
  }
}

function refreshStatusVisibility(): void {
  if (getShowStatusBar()) {
    statusBar.show();
  } else {
    statusBar.hide();
  }
}

async function withProgress<T>(title: string, task: () => Promise<T> | T): Promise<T> {
  return vscode.window.withProgress(
    { location: vscode.ProgressLocation.Window, title, cancellable: false },
    async () => task(),
  );
}

function isTypeScriptDocument(document: vscode.TextDocument): boolean {
  return document.languageId === "typescript" || document.languageId === "typescriptreact";
}

function getMaxDepth(): number {
  return vscode.workspace.getConfiguration("tsperf").get<number>("maxDepth", 6);
}

function getShowCodeLens(): boolean {
  return vscode.workspace.getConfiguration("tsperf").get<boolean>("showDeclarationCodeLens", true);
}

function getShowStatusBar(): boolean {
  return vscode.workspace.getConfiguration("tsperf").get<boolean>("showStatusBar", true);
}

function getProjectCacheEnabled(): boolean {
  return vscode.workspace.getConfiguration("tsperf").get<boolean>("cacheProject", true);
}
