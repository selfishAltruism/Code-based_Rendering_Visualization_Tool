/**
 * 컬럼 x 위치 구성
 */
function buildColumnX(): BuildGraph.GraphLayout["colX"] {
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
  kind: BuildGraph.GraphNodeKind,
  x: number,
  startY: number,
  gapY: number,
): BuildGraph.GraphNode[] {
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
export function buildGraphFromMappingResult(
  mappingResult: Mapping.MappingResult | null,
): BuildGraph.GraphLayout {
  if (!mappingResult) {
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
  const nodes: BuildGraph.GraphNode[] = [];
  const edges: BuildGraph.GraphEdge[] = [];

  // 1. 독립 노드 (useRef)
  const independentItems = mappingResult.hooks
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
  const stateItems = mappingResult.hooks
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
    ...mappingResult.effects.map((e) => ({
      id: e.id,
      label: e.hookKind,
      meta: {
        type: "effect",
        ...e,
      } as Record<string, unknown>,
    })),
    ...mappingResult.callbacks.map((cb) => ({
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

  // 4. JSX 노드 (depth 기반으로 배치)
  type JsxLayoutItem = {
    id: string;
    label: string;
    depth: number;
    meta?: Record<string, unknown>;
  };

  const jsxLayoutItems: JsxLayoutItem[] = mappingResult.jsxNodes.map((jsx) => ({
    id: jsx.id, // AnalyzedJsxNode.id (예: "jsx-1")
    label: jsx.component,
    meta: {
      depth: jsx.depth,
      props: jsx.props,
    } as Record<string, unknown>,
    depth: jsx.depth,
  }));

  const jsxNodes: BuildGraph.GraphNode[] = [];

  // depth별로 그룹핑
  const jsxByDepth = new Map<number, JsxLayoutItem[]>();
  jsxLayoutItems.forEach((item) => {
    const arr = jsxByDepth.get(item.depth) ?? [];
    arr.push(item);
    jsxByDepth.set(item.depth, arr);
  });

  const jsxBaseY = 80;
  const depthGapY = 80; // depth 간 간격
  const intraGapY = 32; // 같은 depth 내에서 노드 간 간격

  Array.from(jsxByDepth.entries())
    .sort((a, b) => a[0] - b[0])
    .forEach(([depth, items]) => {
      items.forEach((item, index) => {
        const y = jsxBaseY + depth * depthGapY + index * intraGapY;

        const node: BuildGraph.GraphNode = {
          id: `jsx-${item.id}`, // 전체 그래프에서의 node id
          label: item.label,
          kind: "jsx",
          x: colX.jsx,
          y,
          width: 120,
          height: 32,
          meta: item.meta,
        };

        jsxNodes.push(node);
      });
    });

  nodes.push(...jsxNodes);

  /**
   * 단순 flow 연결 헬퍼
   */
  function connectSequential(
    fromNodes: BuildGraph.GraphNode[],
    toNodes: BuildGraph.GraphNode[],
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
  mappingResult.effects.forEach((effect) => {
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
  mappingResult.callbacks.forEach((cb) => {
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

  // JSX 부모–자식 관계 edge 추가
  // mappingResult.jsxNodes의 id / parentId (논리 id)를
  // 그래프 노드 id(`jsx-${logicalId}`)로 매핑하여 연결
  const jsxNodeMap = new Map<string, BuildGraph.GraphNode>();
  jsxNodes.forEach((node) => {
    // node.id는 "jsx-" + logicalId 이므로, prefix 제거해서 역매핑
    const logicalId = node.id.replace(/^jsx-/, "");
    jsxNodeMap.set(logicalId, node);
  });

  mappingResult.jsxNodes.forEach((jsx) => {
    if (!jsx.parentId) return; // 루트 JSX는 부모 없음

    const parentNode = jsxNodeMap.get(jsx.parentId);
    const childNode = jsxNodeMap.get(jsx.id);
    if (!parentNode || !childNode) return;

    edges.push({
      id: `jsx-tree-${parentNode.id}-${childNode.id}`,
      from: {
        nodeId: parentNode.id,
        x: parentNode.x + parentNode.width / 2,
        y: parentNode.y,
      },
      to: {
        nodeId: childNode.id,
        x: childNode.x - childNode.width / 2,
        y: childNode.y,
      },
      // 기존 타입을 유지하기 위해 kind는 "flow"로 두고,
      // JSX 계층 관계라는 정보는 meta 쪽에 담는 것도 가능
      kind: "flow",
      label: undefined,
    });
  });

  return {
    nodes,
    edges,
    width,
    height,
    colX,
  };
}
