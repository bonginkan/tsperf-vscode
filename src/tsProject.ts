import * as path from "path";
import { performance } from "perf_hooks";
import * as ts from "typescript";

export interface ProjectLoadResult {
  program: ts.Program;
  sourceFile: ts.SourceFile;
  tsconfigPath?: string;
  fileCount: number;
  buildMs: number;
  cacheHit: boolean;
}

interface CachedProject {
  program: ts.Program;
  fileCount: number;
  tsconfigPath?: string;
  tsconfigMtimeMs?: number;
  targetMtimeMs?: number;
  lastBuildMs: number;
}

const projectCache = new Map<string, CachedProject>();

export function clearProjectCache(): void {
  projectCache.clear();
}

export function loadProjectForFile(fileName: string, opts: { cacheEnabled?: boolean } = {}): ProjectLoadResult {
  const start = performance.now();
  const searchDir = path.dirname(fileName);
  const tsconfigPath = ts.findConfigFile(searchDir, ts.sys.fileExists, "tsconfig.json");
  const cacheKey = tsconfigPath ? `tsconfig:${tsconfigPath}` : `file:${fileName}`;

  const cacheEnabled = opts.cacheEnabled ?? true;
  if (cacheEnabled) {
    const cached = projectCache.get(cacheKey);
    if (cached) {
      const currentTsconfigMtime = tsconfigPath ? ts.sys.getModifiedTime?.(tsconfigPath)?.getTime() : undefined;
      const currentTargetMtime = ts.sys.getModifiedTime?.(fileName)?.getTime();
      const tsconfigFresh = !tsconfigPath || cached.tsconfigMtimeMs === currentTsconfigMtime;
      const targetFresh = cached.targetMtimeMs === currentTargetMtime;
      if (tsconfigFresh && targetFresh) {
        const sourceFile = cached.program.getSourceFile(fileName);
        if (sourceFile) {
          return {
            program: cached.program,
            sourceFile,
            tsconfigPath: cached.tsconfigPath,
            fileCount: cached.fileCount,
            buildMs: 0,
            cacheHit: true,
          };
        }
      }
    }
  }

  let program: ts.Program;
  if (tsconfigPath) {
    const configFile = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
    if (configFile.error) {
      throw new Error(formatDiagnostic(configFile.error));
    }
    const parsed = ts.parseJsonConfigFileContent(
      configFile.config,
      ts.sys,
      path.dirname(tsconfigPath),
      undefined,
      tsconfigPath,
    );
    if (parsed.errors.length > 0) {
      throw new Error(parsed.errors.map(formatDiagnostic).join("\n"));
    }
    program = ts.createProgram(parsed.fileNames, parsed.options);
  } else {
    program = ts.createProgram([fileName], {
      allowJs: false,
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.CommonJS,
      noEmit: true,
      strict: true,
      target: ts.ScriptTarget.ES2020,
    });
  }

  const sourceFile = program.getSourceFile(fileName);
  if (!sourceFile) {
    throw new Error(`Could not load TypeScript source file: ${fileName}`);
  }

  const buildMs = performance.now() - start;
  if (cacheEnabled) {
    projectCache.set(cacheKey, {
      program,
      fileCount: program.getSourceFiles().filter((file) => !file.isDeclarationFile).length,
      tsconfigPath,
      tsconfigMtimeMs: tsconfigPath ? ts.sys.getModifiedTime?.(tsconfigPath)?.getTime() : undefined,
      targetMtimeMs: ts.sys.getModifiedTime?.(fileName)?.getTime(),
      lastBuildMs: buildMs,
    });
  }

  return {
    program,
    sourceFile,
    tsconfigPath,
    fileCount: program.getSourceFiles().filter((file) => !file.isDeclarationFile).length,
    buildMs,
    cacheHit: false,
  };
}

export function findNodeAtOffset(sourceFile: ts.SourceFile, offset: number): ts.Node {
  let best: ts.Node = sourceFile;

  function visit(node: ts.Node): void {
    const start = node.getStart(sourceFile);
    const end = node.getEnd();
    if (offset >= start && offset <= end) {
      best = node;
      ts.forEachChild(node, visit);
    }
  }

  visit(sourceFile);
  return best;
}

export function findDeclarationNodes(sourceFile: ts.SourceFile): ts.Node[] {
  const declarations: ts.Node[] = [];

  function visit(node: ts.Node): void {
    if (
      ts.isTypeAliasDeclaration(node) ||
      ts.isInterfaceDeclaration(node) ||
      ts.isClassDeclaration(node) ||
      ts.isEnumDeclaration(node) ||
      ts.isFunctionDeclaration(node) ||
      ts.isVariableDeclaration(node)
    ) {
      declarations.push(node);
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return declarations;
}

export function declarationName(node: ts.Node): string {
  const named = node as ts.Node & { name?: ts.Node };
  if (named.name && ts.isIdentifier(named.name)) {
    return named.name.text;
  }
  return node.getText().slice(0, 80).replace(/\s+/g, " ");
}

function formatDiagnostic(diagnostic: ts.Diagnostic): string {
  const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
  if (!diagnostic.file || diagnostic.start === undefined) {
    return message;
  }
  const position = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
  return `${diagnostic.file.fileName}:${position.line + 1}:${position.character + 1} ${message}`;
}
