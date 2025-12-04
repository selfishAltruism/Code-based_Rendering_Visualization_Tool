declare namespace Mapping {
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
    parentId: string | null; // 추가: 부모 JSX 노드 id (루트면 null)
    props: string[];
    definedAt: {
      line: number;
      column: number;
    } | null;
  }

  export interface MappingResult {
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

    // UI에서 mappingResult.errors.length, mappingResult.errors.map 사용
    errors: string[];

    calledVariableNames: string[];
  }
}
