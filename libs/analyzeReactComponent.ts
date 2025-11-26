// libs/analyzeReactComponent.ts
import { parse } from "@babel/parser";
import traverse, { type NodePath } from "@babel/traverse";
import * as t from "@babel/types";

export type HookKind =
  | "useState"
  | "useRef"
  | "useReducer"
  | "useEffect"
  | "useLayoutEffect"
  | "useCallback"
  | "useMemo"
  | "zustand"
  | "react-query"
  | "custom";

export type StateScope = "local" | "global" | "external";

export interface AnalyzedHook {
  id: string;
  name: string;
  hookKind: HookKind;
  scope: StateScope;
  definedAt: {
    line: number;
    column: number;
  } | null;
  meta?: Record<string, unknown>;
}

export interface EffectDependency {
  name: string;
  isGlobal: boolean;
}

export interface AnalyzedEffect {
  id: string;
  hookKind: "useEffect" | "useLayoutEffect";
  dependencies: EffectDependency[];
  setters: string[];
  refs: string[];
  definedAt: {
    line: number;
    column: number;
  } | null;
}

export interface AnalyzedCallback {
  id: string;
  name: string | null;
  dependencies: string[];
  setters: string[];
  definedAt: {
    line: number;
    column: number;
  } | null;
}

export interface AnalyzedJsxNode {
  id: string;
  component: string;
  depth: number;
  props: string[];
  definedAt: {
    line: number;
    column: number;
  } | null;
}

export interface ComponentAnalysis {
  source: string;
  fileName?: string;
  componentName: string | null;

  hooks: AnalyzedHook[];
  effects: AnalyzedEffect[];
  callbacks: AnalyzedCallback[];
  jsxNodes: AnalyzedJsxNode[];

  meta: {
    exportedComponents: string[];
    defaultExport: string | null;
  };

  // UI에서 analysis.errors.length, analysis.errors.map 사용
  errors: string[];
}

/**
 * 소스 → AST
 */
function parseSourceToAst(source: string): t.File {
  return parse(source, {
    sourceType: "module",
    plugins: ["jsx", "typescript"],
  });
}

/**
 * export 정보 수집
 */
interface ExportInfo {
  defaultExport: string | null;
  namedExports: string[];
}

function collectExportedComponents(ast: t.File): ExportInfo {
  const info: ExportInfo = {
    defaultExport: null,
    namedExports: [],
  };

  traverse(ast, {
    ExportDefaultDeclaration(path: NodePath<t.ExportDefaultDeclaration>) {
      const decl = path.node.declaration;
      if (t.isIdentifier(decl)) {
        info.defaultExport = decl.name;
      } else if (t.isFunctionDeclaration(decl) && decl.id) {
        info.defaultExport = decl.id.name;
      }
    },
    ExportNamedDeclaration(path: NodePath<t.ExportNamedDeclaration>) {
      const decl = path.node.declaration;
      if (t.isFunctionDeclaration(decl) && decl.id) {
        info.namedExports.push(decl.id.name);
      }
      path.node.specifiers.forEach((spec) => {
        if (t.isExportSpecifier(spec) && t.isIdentifier(spec.exported)) {
          info.namedExports.push(spec.exported.name);
        }
      });
    },
  });

  return info;
}

/**
 * 주요 컴포넌트 선택
 */
function pickPrimaryComponent(
  exportInfo: ExportInfo,
  fileName?: string,
): string | null {
  if (exportInfo.defaultExport) return exportInfo.defaultExport;
  if (exportInfo.namedExports.length === 1) return exportInfo.namedExports[0];

  if (fileName) {
    const base = fileName.replace(/\.[^/.]+$/, "");
    const matched = exportInfo.namedExports.find((name) => name === base);
    if (matched) return matched;
  }

  return exportInfo.namedExports[0] ?? null;
}

/**
 * 훅 이름 → HookKind
 */
function classifyHookKind(
  calleeName: string,
  importSource: string | null,
): HookKind {
  if (calleeName === "useState") return "useState";
  if (calleeName === "useRef") return "useRef";
  if (calleeName === "useReducer") return "useReducer";
  if (calleeName === "useEffect") return "useEffect";
  if (calleeName === "useLayoutEffect") return "useLayoutEffect";
  if (calleeName === "useCallback") return "useCallback";
  if (calleeName === "useMemo") return "useMemo";

  // Zustand 추정
  if (
    calleeName.startsWith("use") &&
    calleeName.endsWith("Store") &&
    importSource &&
    importSource.includes("zustand")
  ) {
    return "zustand";
  }

  // React Query 추정
  if (
    importSource &&
    (importSource.includes("reactQuery") ||
      importSource.includes("@tanstack/react-query"))
  ) {
    const lower = calleeName.toLowerCase();
    if (lower.includes("mutation")) return "react-query";
    if (lower.includes("query")) return "react-query";
  }

  return "custom";
}

/**
 * import 맵
 */
interface ImportMap {
  [localName: string]: string;
}

function collectImportMap(ast: t.File): ImportMap {
  const map: ImportMap = {};

  ast.program.body.forEach((node) => {
    if (t.isImportDeclaration(node)) {
      const src = node.source.value;
      node.specifiers.forEach(
        (
          spec:
            | t.ImportSpecifier
            | t.ImportDefaultSpecifier
            | t.ImportNamespaceSpecifier,
        ) => {
          if (
            t.isImportSpecifier(spec) ||
            t.isImportDefaultSpecifier(spec) ||
            t.isImportNamespaceSpecifier(spec)
          ) {
            if (t.isIdentifier(spec.local)) {
              map[spec.local.name] = src;
            }
          }
        },
      );
    }
  });

  return map;
}

/**
 * path.get(key) 결과를 단일 NodePath로 정리하는 헬퍼
 * (NodePath | NodePath[] → NodePath | null)
 */
function getSingleSubPath(
  path: NodePath<t.Node>,
  key: string,
): NodePath<t.Node> | null {
  const sub = path.get(key) as NodePath<t.Node> | NodePath<t.Node>[];
  if (Array.isArray(sub)) {
    return sub[0] ?? null;
  }
  return sub;
}

/**
 * useEffect / useLayoutEffect 분석
 */
function analyzeEffectCall(
  path: NodePath<t.CallExpression>,
  effectId: string,
  hookKind: "useEffect" | "useLayoutEffect",
  globalStateNames: Set<string>,
): AnalyzedEffect {
  const node = path.node;
  const loc = node.loc;

  const dependencies: EffectDependency[] = [];
  const setters: string[] = [];
  const refs: string[] = [];

  const args = path.get("arguments") as NodePath<t.Expression>[];
  const cbArgPath = args[0];
  const depsArgPath = args[1];

  if (depsArgPath && depsArgPath.isArrayExpression()) {
    depsArgPath.node.elements.forEach((el) => {
      if (t.isIdentifier(el)) {
        dependencies.push({
          name: el.name,
          isGlobal: globalStateNames.has(el.name),
        });
      }
    });
  }

  if (
    cbArgPath &&
    (cbArgPath.isArrowFunctionExpression() || cbArgPath.isFunctionExpression())
  ) {
    const bodyPathNode = getSingleSubPath(
      cbArgPath as unknown as NodePath<t.Node>,
      "body",
    );

    if (
      bodyPathNode &&
      (bodyPathNode.isBlockStatement() || bodyPathNode.isExpression())
    ) {
      bodyPathNode.traverse({
        CallExpression(innerPath: NodePath<t.CallExpression>) {
          const innerCallee = innerPath.node.callee;

          if (
            t.isIdentifier(innerCallee) &&
            /^set[A-Z]/.test(innerCallee.name)
          ) {
            setters.push(innerCallee.name);
          }

          if (
            t.isMemberExpression(innerCallee) &&
            t.isIdentifier(innerCallee.property) &&
            (innerCallee.property.name === "mutate" ||
              innerCallee.property.name === "mutateAsync")
          ) {
            const obj = innerCallee.object;
            if (t.isIdentifier(obj)) {
              setters.push(`${obj.name}.${innerCallee.property.name}`);
            }
          }
        },
        MemberExpression(innerPath: NodePath<t.MemberExpression>) {
          const obj = innerPath.node.object;
          if (t.isIdentifier(obj) && obj.name.endsWith("Ref")) {
            refs.push(obj.name);
          }
        },
      });
    }
  }

  return {
    id: effectId,
    hookKind,
    dependencies,
    setters: Array.from(new Set(setters)),
    refs: Array.from(new Set(refs)),
    definedAt: loc ? { line: loc.start.line, column: loc.start.column } : null,
  };
}

/**
 * useCallback 분석
 */
function analyzeUseCallbackCall(
  path: NodePath<t.CallExpression>,
  callbackId: string,
): AnalyzedCallback {
  const node = path.node;
  const loc = node.loc;

  const args = path.get("arguments") as NodePath<t.Expression>[];
  const cbArgPath = args[0];
  const depsArgPath = args[1];

  const dependencies: string[] = [];
  const setters: string[] = [];

  if (depsArgPath && depsArgPath.isArrayExpression()) {
    depsArgPath.node.elements.forEach((el) => {
      if (t.isIdentifier(el)) {
        dependencies.push(el.name);
      }
    });
  }

  if (
    cbArgPath &&
    (cbArgPath.isArrowFunctionExpression() || cbArgPath.isFunctionExpression())
  ) {
    const bodyPathNode = getSingleSubPath(
      cbArgPath as unknown as NodePath<t.Node>,
      "body",
    );

    if (
      bodyPathNode &&
      (bodyPathNode.isBlockStatement() || bodyPathNode.isExpression())
    ) {
      bodyPathNode.traverse({
        CallExpression(innerPath: NodePath<t.CallExpression>) {
          const innerCallee = innerPath.node.callee;
          if (
            t.isIdentifier(innerCallee) &&
            /^set[A-Z]/.test(innerCallee.name)
          ) {
            setters.push(innerCallee.name);
          }
        },
      });
    }
  }

  let cbName: string | null = null;
  const parent = path.parentPath;
  if (parent.isVariableDeclarator() && t.isIdentifier(parent.node.id)) {
    cbName = parent.node.id.name;
  }

  return {
    id: callbackId,
    name: cbName,
    dependencies: Array.from(new Set(dependencies)),
    setters: Array.from(new Set(setters)),
    definedAt: loc ? { line: loc.start.line, column: loc.start.column } : null,
  };
}

/**
 * JSX 트리 분석
 */
function analyzeJsxTree(
  rootPath: NodePath<t.Node>,
  result: AnalyzedJsxNode[],
): void {
  function getJsxName(node: t.JSXOpeningElement | t.JSXClosingElement): string {
    const name = node.name;

    if (t.isJSXIdentifier(name)) return name.name;

    if (t.isJSXMemberExpression(name)) {
      const parts: string[] = [];
      let current: t.JSXMemberExpression | t.JSXIdentifier = name;

      while (t.isJSXMemberExpression(current)) {
        if (t.isJSXIdentifier(current.property)) {
          parts.unshift(current.property.name);
        }
        if (t.isJSXIdentifier(current.object)) {
          parts.unshift(current.object.name);
          break;
        }
        current = current.object as t.JSXMemberExpression | t.JSXIdentifier;
      }
      return parts.join(".");
    }

    if (t.isJSXNamespacedName(name)) {
      const ns = t.isJSXIdentifier(name.namespace) ? name.namespace.name : "ns";
      const id = t.isJSXIdentifier(name.name) ? name.name.name : "name";
      return `${ns}:${id}`;
    }

    return "Unknown";
  }

  function traverseJsx(path: NodePath<t.JSXElement>, depth: number): void {
    const opening = path.node.openingElement;
    const loc = opening.loc;

    const propIdentifiers: string[] = [];

    opening.attributes.forEach(
      (attr: t.JSXAttribute | t.JSXSpreadAttribute) => {
        if (!t.isJSXAttribute(attr)) return;
        const value = attr.value;
        if (
          t.isJSXExpressionContainer(value) &&
          t.isIdentifier(value.expression)
        ) {
          propIdentifiers.push(value.expression.name);
        }
      },
    );

    result.push({
      id: `jsx-${result.length + 1}`,
      component: getJsxName(opening),
      depth,
      props: Array.from(new Set(propIdentifiers)),
      definedAt: loc
        ? { line: loc.start.line, column: loc.start.column }
        : null,
    });

    path.traverse({
      JSXElement(childPath: NodePath<t.JSXElement>) {
        traverseJsx(childPath, depth + 1);
      },
    });
  }

  rootPath.traverse({
    JSXElement(path: NodePath<t.JSXElement>) {
      if (!path.parentPath.isJSXElement()) {
        traverseJsx(path, 0);
      }
    },
  });
}

/**
 * 컴포넌트 body 내부 분석
 */
function analyzeComponentBody(
  ast: t.File,
  primaryComponentName: string | null,
  importMap: ImportMap,
): {
  hooks: AnalyzedHook[];
  effects: AnalyzedEffect[];
  callbacks: AnalyzedCallback[];
  jsxNodes: AnalyzedJsxNode[];
} {
  const hooks: AnalyzedHook[] = [];
  const effects: AnalyzedEffect[] = [];
  const callbacks: AnalyzedCallback[] = [];
  const jsxNodes: AnalyzedJsxNode[] = [];

  const globalStateNames = new Set<string>();

  function isPrimaryComponent(
    path: NodePath<t.FunctionDeclaration> | NodePath<t.VariableDeclarator>,
  ): boolean {
    if (!primaryComponentName) return false;

    if (path.isFunctionDeclaration()) {
      return Boolean(
        path.node.id && path.node.id.name === primaryComponentName,
      );
    }

    if (path.isVariableDeclarator()) {
      return (
        t.isIdentifier(path.node.id) &&
        path.node.id.name === primaryComponentName
      );
    }

    return false;
  }

  function inspectFunctionBody(bodyPath: NodePath<t.BlockStatement>): void {
    analyzeJsxTree(bodyPath as unknown as NodePath<t.Node>, jsxNodes);

    bodyPath.traverse({
      VariableDeclarator(varPath: NodePath<t.VariableDeclarator>) {
        const init = varPath.node.init;
        if (!t.isCallExpression(init)) return;

        const callee = init.callee;
        if (!t.isIdentifier(callee)) return;

        const localName = callee.name;
        const source = importMap[localName] ?? null;
        const hookKind = classifyHookKind(localName, source);

        const loc = init.loc;
        const id = varPath.node.id;

        const names: string[] = [];
        if (t.isIdentifier(id)) {
          names.push(id.name);
        } else if (t.isArrayPattern(id)) {
          id.elements.forEach((el) => {
            if (t.isIdentifier(el)) {
              names.push(el.name);
            }
          });
        } else if (t.isObjectPattern(id)) {
          id.properties.forEach((prop) => {
            if (t.isObjectProperty(prop) && t.isIdentifier(prop.value)) {
              names.push(prop.value.name);
            }
          });
        }

        const scope: StateScope =
          hookKind === "zustand" || hookKind === "react-query"
            ? "global"
            : "local";

        names.forEach((name) => {
          const hook: AnalyzedHook = {
            id: `hook-${hooks.length + 1}`,
            name,
            hookKind,
            scope,
            definedAt: loc
              ? { line: loc.start.line, column: loc.start.column }
              : null,
            meta: { importSource: source },
          };
          hooks.push(hook);

          if (scope === "global") {
            globalStateNames.add(name);
          }
        });
      },

      CallExpression(callPath: NodePath<t.CallExpression>) {
        const callee = callPath.node.callee;
        if (!t.isIdentifier(callee)) return;

        const localName = callee.name;
        const source = importMap[localName] ?? null;
        const hookKind = classifyHookKind(localName, source);

        if (hookKind === "useEffect" || hookKind === "useLayoutEffect") {
          const effectId = `effect-${effects.length + 1}`;
          const effect = analyzeEffectCall(
            callPath,
            effectId,
            hookKind,
            globalStateNames,
          );
          effects.push(effect);
        }

        if (hookKind === "useCallback") {
          const callbackId = `callback-${callbacks.length + 1}`;
          const cb = analyzeUseCallbackCall(callPath, callbackId);
          callbacks.push(cb);
        }
      },
    });
  }

  traverse(ast, {
    FunctionDeclaration(path: NodePath<t.FunctionDeclaration>) {
      if (!isPrimaryComponent(path)) return;

      const bodyPathNode = getSingleSubPath(
        path as unknown as NodePath<t.Node>,
        "body",
      );
      if (bodyPathNode && bodyPathNode.isBlockStatement()) {
        inspectFunctionBody(
          bodyPathNode as unknown as NodePath<t.BlockStatement>,
        );
      }
    },

    VariableDeclarator(path: NodePath<t.VariableDeclarator>) {
      if (!isPrimaryComponent(path)) return;

      const init = path.node.init;
      if (t.isArrowFunctionExpression(init) || t.isFunctionExpression(init)) {
        const initPath = path.get("init") as NodePath<
          t.ArrowFunctionExpression | t.FunctionExpression
        >;

        const bodyPathNode = getSingleSubPath(
          initPath as unknown as NodePath<t.Node>,
          "body",
        );

        if (bodyPathNode && bodyPathNode.isBlockStatement()) {
          inspectFunctionBody(
            bodyPathNode as unknown as NodePath<t.BlockStatement>,
          );
        } else if (bodyPathNode && bodyPathNode.isExpression()) {
          analyzeJsxTree(bodyPathNode as unknown as NodePath<t.Node>, jsxNodes);
        }
      }
    },
  });

  return { hooks, effects, callbacks, jsxNodes };
}

/**
 * 엔트리 함수
 */
export function analyzeReactComponent(
  source: string,
  fileName?: string,
): ComponentAnalysis {
  const ast = parseSourceToAst(source);
  const importMap = collectImportMap(ast);
  const exportInfo = collectExportedComponents(ast);
  const primaryComponentName = pickPrimaryComponent(exportInfo, fileName);

  const { hooks, effects, callbacks, jsxNodes } = analyzeComponentBody(
    ast,
    primaryComponentName,
    importMap,
  );

  const errors: string[] = [];

  return {
    source,
    fileName,
    componentName: primaryComponentName,
    hooks,
    effects,
    callbacks,
    jsxNodes,
    meta: {
      exportedComponents: exportInfo.namedExports,
      defaultExport: exportInfo.defaultExport,
    },
    errors,
  };
}
