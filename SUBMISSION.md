# TSPerf Challenge Submission

## Summary

TSPerf is an MIT-licensed VS Code extension for inspecting TypeScript type complexity and type-checker load time at the cursor or across the current file.

The extension is built for the Algora TSPerf challenge and focuses on measurable developer workflow signals:

- Program build time and type resolution time for the selected node.
- A deterministic type-complexity score from unions, intersections, properties, signatures, and depth.
- CodeLens entry points for declarations in TypeScript and TSX files.
- File-level ranking of the heaviest declarations.
- Warm-project cache reuse with visible cache hit/miss reporting and a manual cache clear command.

## Install And Try

```Powershell
npm install --legacy-peer-deps;
npx tsc -p . --noEmit;
npx tsc -p .;
npx --yes @vscode/vsce package --no-dependencies;
code --install-extension .\\tsperf-vscode-0.1.0.vsix;
```

After installing, open a TypeScript or TSX file and run:

- `TSPerf: Inspect Type Under Cursor`
- `TSPerf: Inspect Current File`
- `TSPerf: Clear Project Cache`

## Validation

The current package was validated with:

```Powershell
npx tsc -p . --noEmit;
npx tsc -p .;
npx --yes @vscode/vsce package --no-dependencies;
```

The generated VSIX is intentionally ignored by git, but the package step verifies that the extension manifest, README, license, and compiled `dist` files assemble correctly.

## Submission Notes

- Repository: https://github.com/bonginkan/tsperf-vscode
- Implementation PR: https://github.com/bonginkan/tsperf-vscode/pull/1
- License: MIT
- VS Code engine: `^1.90.0`
- Primary differentiator: cold-vs-warm TypeScript project load measurement with explicit cache hit/miss visibility.
