// libs/graphModel.ts
import type { ComponentAnalysis } from "./analyzeReactComponent";

export type GraphNodeKind =
  | "independent"
  | "state"
  | "effect"
  | "variable"
  | "jsx"
  | "external";

export type GraphEdgeKind =
  | "flow"
  | "state-dependency"
  | "state-mutation"
  | "external";

export interface GraphNode {
  id: string;
  label: string;
  kind: GraphNodeKind;
  x: number;
  y: number;
  width: number;
  height: number;
  meta?: Record<string, unknown>;
}

export interface EdgeEndpoint {
  nodeId: string;
  x: number;
  y: number;
}

export interface GraphEdge {
  id: string;
  from: EdgeEndpoint;
  to: EdgeEndpoint;
  kind: GraphEdgeKind;
  label?: string;
}

export interface GraphLayout {
  nodes: GraphNode[];
  edges: GraphEdge[];
  width: number;
  height: number;
  colX: Record<"independent" | "state" | "variable" | "effect" | "jsx", number>;
}

/**
 * 컬럼 x 위치 구성
 */
function buildColumnX(): GraphLayout["colX"] {
  const base = 80;
  const gap = 220;

  return {
    independent: base,
    state: base + gap,
    variable: base + gap * 2,
    effect: base + gap * 3,
    jsx: base + gap * 4,
  };
}

/**
 * y 위치 배치 헬퍼
 */
function layoutColumnNodes<
  T extends { id: string; label: string; meta?: Record<string, unknown> },
>(
  items: T[],
  kind: GraphNodeKind,
  x: number,
  startY: number,
  gapY: number,
): GraphNode[] {
  return items.map((item, index) => {
    const y = startY + index * gapY;
    return {
      id: `${kind}-${item.id}`,
      label: item.label,
      kind,
      x,
      y,
      width: 120,
      height: 32,
      meta: item.meta,
    };
  });
}

/**
 * 분석 결과 → 그래프 레이아웃
 */
export function buildGraphFromAnalysis(
  analysis: ComponentAnalysis | null,
): GraphLayout {
  if (!analysis) {
    const colX = buildColumnX();
    return {
      nodes: [],
      edges: [],
      width: colX.jsx + 200,
      height: 800,
      colX,
    };
  }

  const colX = buildColumnX();
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];

  // 1. 독립 노드 (useRef)
  const independentItems = analysis.hooks
    .filter((h) => h.hookKind === "useRef")
    .map((h) => ({
      id: h.id,
      label: h.name,
      meta: {
        hookKind: h.hookKind,
        scope: h.scope,
      } as Record<string, unknown>,
    }));

  const independentNodes = layoutColumnNodes(
    independentItems,
    "independent",
    colX.independent,
    80,
    50,
  );
  nodes.push(...independentNodes);

  // 2. 상태 노드 (useState + 전역 상태)
  const stateItems = analysis.hooks
    .filter((h) => ["useState", "zustand", "react-query"].includes(h.hookKind))
    .map((h) => ({
      id: h.id,
      label: h.scope === "global" ? `${h.name} (global)` : h.name,
      meta: {
        hookKind: h.hookKind,
        scope: h.scope,
      } as Record<string, unknown>,
    }));

  const stateNodes = layoutColumnNodes(stateItems, "state", colX.state, 80, 40);
  nodes.push(...stateNodes);

  // 3. effect / callback 노드
  const effectItems = [
    ...analysis.effects.map((e) => ({
      id: e.id,
      label: e.hookKind,
      meta: {
        type: "effect",
        ...e,
      } as Record<string, unknown>,
    })),
    ...analysis.callbacks.map((cb) => ({
      id: cb.id,
      label: cb.name ?? "callback",
      meta: {
        type: "callback",
        ...cb,
      } as Record<string, unknown>,
    })),
  ];

  const effectNodes = layoutColumnNodes(
    effectItems,
    "effect",
    colX.effect,
    80,
    40,
  );
  nodes.push(...effectNodes);

  // 4. JSX 노드
  const jsxItems = analysis.jsxNodes.map((jsx) => ({
    id: jsx.id,
    label: jsx.component,
    meta: {
      depth: jsx.depth,
      props: jsx.props,
    } as Record<string, unknown>,
  }));

  const jsxNodes = layoutColumnNodes(jsxItems, "jsx", colX.jsx, 80, 32);
  nodes.push(...jsxNodes);

  /**
   * 단순 flow 연결 헬퍼
   */
  function connectSequential(
    fromNodes: GraphNode[],
    toNodes: GraphNode[],
    label?: string,
  ): void {
    fromNodes.forEach((from, index) => {
      const to = toNodes[index] ?? toNodes[toNodes.length - 1];
      if (!to) return;

      edges.push({
        id: `flow-${from.id}-${to.id}`,
        from: {
          nodeId: from.id,
          x: from.x + from.width / 2,
          y: from.y,
        },
        to: {
          nodeId: to.id,
          x: to.x - to.width / 2,
          y: to.y,
        },
        kind: "flow",
        label,
      });
    });
  }

  // independent → state
  if (independentNodes.length > 0 && stateNodes.length > 0) {
    connectSequential(independentNodes, stateNodes);
  }

  // state → effect (의존성)
  analysis.effects.forEach((effect) => {
    const effectNode = effectNodes.find((n) => n.id === `effect-${effect.id}`);
    if (!effectNode) return;

    effect.dependencies.forEach((dep) => {
      const stateNode = stateNodes.find((n) => n.label.startsWith(dep.name));
      if (!stateNode) return;

      edges.push({
        id: `dep-${stateNode.id}-${effectNode.id}-${dep.name}`,
        from: {
          nodeId: stateNode.id,
          x: stateNode.x + stateNode.width / 2,
          y: stateNode.y,
        },
        to: {
          nodeId: effectNode.id,
          x: effectNode.x - effectNode.width / 2,
          y: effectNode.y,
        },
        kind: "state-dependency",
        label: dep.name,
      });
    });

    // effect → state (setState)
    effect.setters.forEach((setter) => {
      const match = setter.match(/^set([A-Z].*)/);
      const stateName = match
        ? match[1].charAt(0).toLowerCase() + match[1].slice(1)
        : setter;

      const stateNode = stateNodes.find((n) => n.label.startsWith(stateName));
      if (!stateNode) return;

      edges.push({
        id: `mut-${effectNode.id}-${stateNode.id}-${setter}`,
        from: {
          nodeId: effectNode.id,
          x: effectNode.x + effectNode.width / 2,
          y: effectNode.y,
        },
        to: {
          nodeId: stateNode.id,
          x: stateNode.x - stateNode.width / 2,
          y: stateNode.y,
        },
        kind: "state-mutation",
        label: setter,
      });
    });
  });

  // callback → state-mutation
  analysis.callbacks.forEach((cb) => {
    const cbNode = effectNodes.find((n) => n.id === `effect-${cb.id}`);
    if (!cbNode) return;

    cb.setters.forEach((setter) => {
      const match = setter.match(/^set([A-Z].*)/);
      const stateName = match
        ? match[1].charAt(0).toLowerCase() + match[1].slice(1)
        : setter;

      const stateNode = stateNodes.find((n) => n.label.startsWith(stateName));
      if (!stateNode) return;

      edges.push({
        id: `cb-mut-${cbNode.id}-${stateNode.id}-${setter}`,
        from: {
          nodeId: cbNode.id,
          x: cbNode.x + cbNode.width / 2,
          y: cbNode.y,
        },
        to: {
          nodeId: stateNode.id,
          x: stateNode.x - stateNode.width / 2,
          y: stateNode.y,
        },
        kind: "state-mutation",
        label: setter,
      });
    });
  });

  // state / ref → JSX prop
  jsxNodes.forEach((jsxNode) => {
    const jsxMeta = jsxNode.meta ?? {};
    const props = (jsxMeta.props as string[]) ?? [];

    props.forEach((name) => {
      const fromStateNode =
        stateNodes.find((n) => n.label.startsWith(name)) ??
        independentNodes.find((n) => n.label === name);

      if (!fromStateNode) return;

      edges.push({
        id: `jsx-prop-${fromStateNode.id}-${jsxNode.id}-${name}`,
        from: {
          nodeId: fromStateNode.id,
          x: fromStateNode.x + fromStateNode.width / 2,
          y: fromStateNode.y,
        },
        to: {
          nodeId: jsxNode.id,
          x: jsxNode.x - jsxNode.width / 2,
          y: jsxNode.y,
        },
        kind: "state-dependency",
        label: name,
      });
    });
  });

  const width = colX.jsx + 200;
  const lastJsxY = jsxNodes.length ? jsxNodes[jsxNodes.length - 1].y : 600;
  const height = lastJsxY + 120;

  return {
    nodes,
    edges,
    width,
    height,
    colX,
  };
}
