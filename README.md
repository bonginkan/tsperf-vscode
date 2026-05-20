# TSPerf

TSPerf is an MIT licensed VS Code extension that shows TypeScript type complexity and type-checker load time for the type under your cursor.

It is built for the Algora TSPerf challenge: <https://algora.io/challenges/tsperf>.

## Features

- Inspect the TypeScript type under the cursor.
- Measure program build time and type resolution time.
- Score type complexity from unions, intersections, properties, call signatures, and nesting depth.
- Show CodeLens actions above type aliases, interfaces, classes, enums, functions, and variable declarations.
- Inspect the current file and list the heaviest declarations.

## Usage

1. Open a TypeScript or TSX file.
2. Put the cursor on a symbol, expression, type alias, or declaration.
3. Run `TSPerf: Inspect Type Under Cursor` from the command palette.
4. Optionally run `TSPerf: Inspect Current File` to rank the file's declarations.

## Development

```Powershell
npm install --legacy-peer-deps;
npx tsc -p . --noEmit;
```

## License

MIT
