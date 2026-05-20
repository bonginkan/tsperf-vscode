import * as ts from "typescript";

export interface ComplexityOptions {
  maxDepth: number;
}

export interface ComplexityResult {
  score: number;
  nodes: number;
  properties: number;
  callSignatures: number;
  constructSignatures: number;
  indexSignatures: number;
  unionParts: number;
  intersectionParts: number;
  maxObservedDepth: number;
  truncated: boolean;
}

export function scoreType(checker: ts.TypeChecker, type: ts.Type, options: ComplexityOptions): ComplexityResult {
  const result: ComplexityResult = {
    score: 0,
    nodes: 0,
    properties: 0,
    callSignatures: 0,
    constructSignatures: 0,
    indexSignatures: 0,
    unionParts: 0,
    intersectionParts: 0,
    maxObservedDepth: 0,
    truncated: false,
  };
  const seen = new Set<string>();

  visit(type, 0);
  result.score += Math.ceil(result.properties * 0.7);
  result.score += result.callSignatures * 3;
  result.score += result.constructSignatures * 3;
  result.score += result.indexSignatures * 2;
  result.score += result.unionParts * 2;
  result.score += result.intersectionParts * 3;
  result.score += result.maxObservedDepth * 4;
  return result;

  function visit(current: ts.Type, depth: number): void {
    if (depth > options.maxDepth) {
      result.truncated = true;
      return;
    }

    const key = typeKey(checker, current);
    if (seen.has(key)) {
      return;
    }
    seen.add(key);

    result.nodes += 1;
    result.score += 1;
    result.maxObservedDepth = Math.max(result.maxObservedDepth, depth);

    if (checker.isArrayType(current) || checker.isTupleType(current)) {
      for (const typeArgument of checker.getTypeArguments(current as ts.TypeReference)) {
        visit(typeArgument, depth + 1);
      }
      return;
    }

    if (current.isUnion()) {
      result.unionParts += current.types.length;
      current.types.forEach((part) => visit(part, depth + 1));
    }
    if (current.isIntersection()) {
      result.intersectionParts += current.types.length;
      current.types.forEach((part) => visit(part, depth + 1));
    }

    const properties = checker.getPropertiesOfType(current);
    result.properties += properties.length;
    for (const property of properties.slice(0, 64)) {
      const declaration = property.valueDeclaration ?? property.declarations?.[0];
      if (!declaration || isStandardLibraryDeclaration(declaration)) {
        continue;
      }
      const propertyType = checker.getTypeOfSymbolAtLocation(property, declaration);
      visit(propertyType, depth + 1);
    }
    if (properties.length > 64) {
      result.truncated = true;
      result.score += Math.ceil((properties.length - 64) * 0.2);
    }

    const callSignatures = current.getCallSignatures();
    const constructSignatures = current.getConstructSignatures();
    result.callSignatures += callSignatures.length;
    result.constructSignatures += constructSignatures.length;
    for (const signature of [...callSignatures, ...constructSignatures].slice(0, 24)) {
      visit(checker.getReturnTypeOfSignature(signature), depth + 1);
      for (const parameter of signature.getParameters().slice(0, 24)) {
        const declaration = parameter.valueDeclaration ?? parameter.declarations?.[0];
        if (declaration) {
          visit(checker.getTypeOfSymbolAtLocation(parameter, declaration), depth + 1);
        }
      }
    }

    const indexInfos = checker.getIndexInfosOfType(current);
    result.indexSignatures += indexInfos.length;
    for (const indexInfo of indexInfos) {
      visit(indexInfo.type, depth + 1);
    }
  }
}

function typeKey(checker: ts.TypeChecker, type: ts.Type): string {
  const internalId = (type as { id?: number }).id;
  if (typeof internalId === "number") {
    return `id:${internalId}`;
  }
  return checker.typeToString(type);
}

function isStandardLibraryDeclaration(node: ts.Node): boolean {
  const fileName = node.getSourceFile().fileName.replace(/\\/g, "/");
  return /typescript\/lib\/lib\.[^/]+\.d\.ts$/.test(fileName);
}
