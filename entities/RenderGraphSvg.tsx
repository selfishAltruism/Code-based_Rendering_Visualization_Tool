"use client";

import React, { useMemo } from "react";

import { buildGraphFromMappingResult } from "@/shared/libs/buildGraph/buildGraph";
import { getHorizontalAnchors } from "@/shared/libs/buildGraph/utils";
import { getEdgeStyle } from "@/shared/libs/ui/svg";

interface RenderGraphSvgProps {
  mappingResult: Mapping.MappingResult | null;
  svgRef: React.RefObject<SVGSVGElement | null>;
}

// buildGraphFromMappingResult 반환 타입 재사용
type GraphLayout = ReturnType<typeof buildGraphFromMappingResult>;
type GraphNode = GraphLayout["nodes"][number];
type GraphEdge = GraphLayout["edges"][number];

const STATE_FN_OFFSET_X = 70;

type AnalyzedHook = Mapping.AnalyzedHook;

/**
 * useState 쌍(state / setter)을 그룹화하고,
 * 나머지 hook 들은 개별 state 또는 함수로 분류하기 위한 헬퍼.
 */
function buildStateFunctionRows(
  mappingResult: Mapping.MappingResult | null,
  nodeList: GraphNode[],
): {
  rows: {
    orderKey: number;
    stateNode?: GraphNode;
    fnNode?: GraphNode;
  }[];
} {
  if (!mappingResult) {
    return { rows: [] };
  }

  const hooks = mappingResult.hooks ?? [];
  if (!hooks.length) {
    return { rows: [] };
  }

  // state 컬럼의 노드만 대상으로 함
  const stateNodes = nodeList.filter((n) => n.kind === "state");
  if (!stateNodes.length) {
    return { rows: [] };
  }

  // hook.id → GraphNode 매핑 (state 컬럼의 노드만)
  const nodeByHookId = new Map<string, GraphNode>();
  for (const node of stateNodes) {
    if (node.id.startsWith("state-")) {
      const hookId = node.id.slice("state-".length);
      nodeByHookId.set(hookId, node);
    }
  }

  // hook.id → 원래 인덱스 (row 정렬 기준)
  const hookIndexById = new Map<string, number>();
  hooks.forEach((h, idx) => {
    hookIndexById.set(h.id, idx);
  });

  type Row = { orderKey: number; stateNode?: GraphNode; fnNode?: GraphNode };
  const rows: Row[] = [];
  const pairedHookIds = new Set<string>();

  // 1) useState 쌍 감지 (definedAt line/column 동일 + 이름 패턴)
  const groupedByLoc = new Map<string, AnalyzedHook[]>();

  hooks.forEach((hook) => {
    if (hook.hookKind !== "useState") return;
    if (!hook.definedAt) return;
    const key = `${hook.definedAt.line}:${hook.definedAt.column}`;
    const list = groupedByLoc.get(key);
    if (list) list.push(hook);
    else groupedByLoc.set(key, [hook]);
  });

  groupedByLoc.forEach((group) => {
    if (group.length < 2) return;

    const valueHooks = group.filter((h) => !h.name.startsWith("set"));
    const setterHooks = group.filter((h) => h.name.startsWith("set"));

    if (valueHooks.length !== 1 || setterHooks.length !== 1) {
      return;
    }

    const valueHook = valueHooks[0];
    const setterHook = setterHooks[0];

    const valueNode = nodeByHookId.get(valueHook.id);
    const setterNode = nodeByHookId.get(setterHook.id);

    if (!valueNode && !setterNode) return;

    const idxA = hookIndexById.get(valueHook.id) ?? Number.MAX_SAFE_INTEGER;
    const idxB = hookIndexById.get(setterHook.id) ?? Number.MAX_SAFE_INTEGER;

    rows.push({
      orderKey: Math.min(idxA, idxB),
      stateNode: valueNode,
      fnNode: setterNode,
    });

    pairedHookIds.add(valueHook.id);
    pairedHookIds.add(setterHook.id);
  });

  // 2) 나머지 hook 을 개별 state / 함수 row 로 분배
  hooks.forEach((hook, idx) => {
    if (pairedHookIds.has(hook.id)) return;

    const node = nodeByHookId.get(hook.id);
    if (!node) return;

    const calledSet = new Set(mappingResult.calledVariableNames);

    const isFunction = calledSet.has(hook.name); // 호출 여부로만 판별
    if (isFunction) {
      rows.push({
        orderKey: idx,
        fnNode: node,
      });
    } else {
      rows.push({
        orderKey: idx,
        stateNode: node,
      });
    }
  });

  rows.sort((a, b) => a.orderKey - b.orderKey);

  return { rows };
}

/**
 * 상태 / 함수 전용 레이아웃
 * - 왼쪽: state 컬럼
 * - 오른쪽: 함수 컬럼 (setXXX, 전역 store 함수 등)
 * - [state, setXXX] = useState(...) 쌍은 같은 row 에 배치하고
 *   두 노드를 직선 edge 로 연결할 수 있도록 한다.
 */
function applyStateFunctionLayout(
  layout: GraphLayout,
  mappingResult: Mapping.MappingResult | null,
): GraphLayout {
  if (!mappingResult) return layout;

  const { nodes, edges, width, height, colX } = layout;

  const stateNodes = nodes.filter((n) => n.kind === "state");
  if (!stateNodes.length) {
    return layout;
  }

  const { rows } = buildStateFunctionRows(mappingResult, nodes);
  if (!rows.length) {
    return layout;
  }

  // 기존 노드 복사본으로 작업
  const nextNodes: GraphNode[] = nodes.map((n) => ({ ...n }));
  const nodeById = new Map<string, GraphNode>();
  nextNodes.forEach((n) => nodeById.set(n.id, n));

  const stateColX = colX.state - STATE_FN_OFFSET_X;
  const fnColX = colX.state + STATE_FN_OFFSET_X;

  const baseY = 80;
  const gapY = 40;

  rows.forEach((row, rowIndex) => {
    const y = baseY + rowIndex * gapY;

    if (row.stateNode) {
      const n = nodeById.get(row.stateNode.id);
      if (n) {
        n.x = stateColX;
        n.y = y;
      }
    }

    if (row.fnNode) {
      const n = nodeById.get(row.fnNode.id);
      if (n) {
        n.x = fnColX;
        n.y = y;
      }
    }
  });

  // edge 재정렬 (노드 위치 변경 반영)
  const nextEdges: GraphEdge[] = edges.map((edge) => {
    const fromNode = nodeById.get(edge.from.nodeId);
    const toNode = nodeById.get(edge.to.nodeId);

    if (!fromNode && !toNode) return edge;

    return {
      ...edge,
      from: fromNode
        ? {
            ...edge.from,
            x: fromNode.x,
            y: fromNode.y,
          }
        : edge.from,
      to: toNode
        ? {
            ...edge.to,
            x: toNode.x,
            y: toNode.y,
          }
        : edge.to,
    };
  });

  // state / 함수 쌍 사이에 직접 edge 추가 (수평 직선)
  rows.forEach((row, rowIndex) => {
    if (!row.stateNode || !row.fnNode) return;

    const stateNode = nodeById.get(row.stateNode.id);
    const fnNode = nodeById.get(row.fnNode.id);
    if (!stateNode || !fnNode) return;

    nextEdges.push({
      id: `state-link-${fnNode.id}-${stateNode.id}-${rowIndex}`,
      from: {
        nodeId: fnNode.id, // set 함수가 출발점
        x: fnNode.x,
        y: fnNode.y,
      },
      to: {
        nodeId: stateNode.id, // state가 도착점
        x: stateNode.x,
        y: stateNode.y,
      },
      kind: "state-link",
      label: "",
    });
  });

  return {
    nodes: nextNodes,
    edges: nextEdges,
    width,
    height,
    colX,
  };
}

/**
 * JSX 노드들을
 * - depth 기준으로 가로(오른쪽) 방향 확장
 * - DFS 순서대로 전역 row를 증가시켜 부모/자식/형제가 위→아래로 자연스럽게 내려가도록 배치
 *
 * 전제:
 *   - JSX 노드: node.kind === "jsx"
 *   - 부모 관계: node.meta?.jsxParentId (string | undefined)
 */
function applyJsxTreeLayout(layout: GraphLayout): GraphLayout {
  const { nodes, edges, width, height, colX } = layout;

  // JSX 노드만 추출
  const jsxNodes = nodes.filter((n: GraphNode) => n.kind === "jsx");
  if (!jsxNodes.length) {
    return layout;
  }

  // 부모 ID 정보 수집 (없으면 루트 취급)
  const parentIdMap = new Map<string, string | undefined>();
  for (const node of jsxNodes) {
    const meta = node.meta as { jsxParentId?: string } | undefined;
    parentIdMap.set(node.id, meta?.jsxParentId);
  }

  // JSX 노드 id → node 매핑
  const jsxNodeById = new Map<string, GraphNode>();
  for (const node of jsxNodes) {
    jsxNodeById.set(node.id, node);
  }

  // 루트 JSX 노드: 부모가 없거나, 부모가 JSX 노드 목록에 없는 경우
  const rootJsxNodes = jsxNodes.filter((node) => {
    const parentId = parentIdMap.get(node.id);
    return !parentId || !jsxNodeById.has(parentId);
  });

  // 레이아웃 파라미터
  const baseX = colX.jsx; // depth 0 기준 x (JSX 컬럼)
  const depthGapX = 160; // depth 증가 시 가로 이동량

  const baseY = 80; // 시작 Y
  const rowGapY = 40; // row 간 세로 간격

  const newNodePositions = new Map<string, { x: number; y: number }>();

  const getChildren = (node: GraphNode): GraphNode[] =>
    jsxNodes.filter((child) => parentIdMap.get(child.id) === node.id);

  /**
   * 서브트리 레이아웃
   * - node: 현재 노드
   * - depth: JSX depth
   * - rowStart: 이 서브트리가 시작되는 전역 row 인덱스
   *
   * 반환값: 이 서브트리가 사용한 row 개수
   */
  function layoutSubtree(
    node: GraphNode,
    depth: number,
    rowStart: number,
  ): number {
    const x = baseX + depth * depthGapX; // 중앙 정렬 없이 오른쪽으로만 확장
    const y = baseY + rowStart * rowGapY;

    newNodePositions.set(node.id, { x, y });

    const children = getChildren(node);
    if (children.length === 0) {
      // 자기 자신 한 줄만 사용
      return 1;
    }

    // 1) 첫 번째 자식은 부모와 같은 row에 배치
    const firstChild = children[0];
    const firstHeight = layoutSubtree(firstChild, depth + 1, rowStart);

    // 2) 두 번째 자식부터는 아래로 쌓기
    let cursorRow = rowStart + firstHeight;

    for (let i = 1; i < children.length; i += 1) {
      const child = children[i];
      const h = layoutSubtree(child, depth + 1, cursorRow);
      cursorRow += h;
    }

    // 전체 서브트리가 사용한 row 수
    return Math.max(1, cursorRow - rowStart);
  }

  // 루트들부터 순서대로 서브트리 레이아웃
  let currentRow = 0;
  for (const root of rootJsxNodes) {
    const used = layoutSubtree(root, 0, currentRow);
    currentRow += used; // 서브트리 바로 아래에 다음 루트 배치
  }

  // 노드 좌표 갱신
  const newNodes: GraphNode[] = nodes.map((node) => {
    const pos = newNodePositions.get(node.id);
    if (!pos) return node;

    return {
      ...node,
      x: pos.x,
      y: pos.y,
    };
  });

  // edge 좌표도 JSX 노드 기준으로 덮어쓰기
  const nodeByIdAfter = new Map<string, GraphNode>();
  for (const node of newNodes) {
    nodeByIdAfter.set(node.id, node);
  }

  const newEdges: GraphEdge[] = edges.map((edge) => {
    const fromNodeId = edge.from.nodeId as string | undefined;
    const toNodeId = edge.to.nodeId as string | undefined;

    let newFrom = edge.from;
    let newTo = edge.to;

    if (fromNodeId && nodeByIdAfter.has(fromNodeId)) {
      const n = nodeByIdAfter.get(fromNodeId)!;
      newFrom = {
        ...edge.from,
        x: n.x,
        y: n.y,
      };
    }

    if (toNodeId && nodeByIdAfter.has(toNodeId)) {
      const n = nodeByIdAfter.get(toNodeId)!;
      newTo = {
        ...edge.to,
        x: n.x,
        y: n.y,
      };
    }

    return {
      ...edge,
      from: newFrom,
      to: newTo,
    };
  });

  // 높이/너비 보정
  let maxY = height;
  for (const node of newNodes) {
    const bottom = node.y + node.height / 2 + 40;
    if (bottom > maxY) maxY = bottom;
  }

  let maxX = width;
  for (const node of newNodes) {
    const right = node.x + node.width / 2 + 40;
    if (right > maxX) maxX = right;
  }

  return {
    nodes: newNodes,
    edges: newEdges,
    width: maxX,
    height: maxY,
    colX,
  };
}

export function RenderGraphSvg({ mappingResult, svgRef }: RenderGraphSvgProps) {
  const { nodes, edges, width, height, colX } = useMemo(() => {
    const base = buildGraphFromMappingResult(mappingResult);
    // 1단계: 상태 / 함수 컬럼 레이아웃
    const withStateLayout = applyStateFunctionLayout(base, mappingResult);
    // 2단계: JSX 영역 트리 레이아웃 적용
    return applyJsxTreeLayout(withStateLayout);
  }, [mappingResult]);

  const stateColX = colX.state - STATE_FN_OFFSET_X;
  const fnColX = colX.state + STATE_FN_OFFSET_X;

  // RenderGraphSvg.tsx 상단부 (컴포넌트 내부)
  const nodeMap = useMemo(
    () =>
      nodes.reduce<Record<string, GraphNode>>((acc, node) => {
        acc[node.id] = node;
        return acc;
      }, {}),
    [nodes],
  );

  if (!mappingResult) {
    return <div className="text-sm text-neutral-500">코드 분석 결과 없음.</div>;
  }

  if (!nodes.length) {
    return (
      <div className="text-sm text-neutral-500">
        분석 가능한 노드가 없습니다.
      </div>
    );
  }

  return (
    <div className="h-full w-full overflow-auto rounded-md border bg-white">
      <svg ref={svgRef} width={width} height={height} className="block">
        {/* defs: arrow marker 정의 */}
        <defs>
          {/* 기본 흐름 화살표 */}
          <marker
            id="arrow-solid"
            markerWidth="8"
            markerHeight="8"
            refX="7"
            refY="4"
            orient="auto"
            markerUnits="strokeWidth"
          >
            <path d="M0,0 L8,4 L0,8 z" fill="#8b5cf6" />
          </marker>

          {/* muted 화살표 */}
          <marker
            id="arrow-muted"
            markerWidth="8"
            markerHeight="8"
            refX="7"
            refY="4"
            orient="auto"
            markerUnits="strokeWidth"
          >
            <path d="M0,0 L8,4 L0,8 z" fill="#9ca3af" />
          </marker>

          {/* 상태 변경 강조 화살표 */}
          <marker
            id="arrow-accent"
            markerWidth="8"
            markerHeight="8"
            refX="7"
            refY="4"
            orient="auto"
            markerUnits="strokeWidth"
          >
            <path d="M0,0 L8,4 L0,8 z" fill="#b91c1c" />
          </marker>

          <marker
            id="arrow-gray"
            markerWidth="8"
            markerHeight="8"
            refX="7"
            refY="4"
            orient="auto"
            markerUnits="strokeWidth"
          >
            <path d="M0,0 L8,4 L0,8 z" fill="#4686df" />
          </marker>
        </defs>

        {/* 컬럼 타이틀 */}
        <g fontSize={11} fill="#4b5563">
          <text x={colX.independent} y={32} textAnchor="middle">
            렌더링 독립
          </text>
          <text x={colX.state} y={32} textAnchor="middle">
            렌더링 결정 / 상태
          </text>
          <text x={colX.variable} y={32} textAnchor="middle">
            변수 / 헬퍼
          </text>
          <text x={colX.effect} y={32} textAnchor="middle">
            렌더링 후속
          </text>
          <text x={colX.jsx} y={32} textAnchor="middle">
            JSX
          </text>

          {/* 상태 / 함수 서브 컬럼 */}
          <text x={stateColX} y={48} textAnchor="middle" fontSize={10}>
            state
          </text>
          <text x={fnColX} y={48} textAnchor="middle" fontSize={10}>
            함수
          </text>
        </g>

        {/* nodes */}
        <g>
          {nodes.map((node) => {
            const radius = 6;
            const rectX = node.x - node.width / 2;
            const rectY = node.y - node.height / 2;

            let fill = "#ffffff";
            let stroke = "#d1d5db";

            switch (node.kind) {
              case "independent":
                stroke = "#6b7280";
                break;
              case "state":
                stroke = "#2563eb";
                fill = "#eff6ff";
                break;
              case "effect":
                stroke = "#8b5cf6";
                fill = "#f5f3ff";
                break;
              case "jsx":
                stroke = "#0f766e";
                fill = "#ecfdf5";
                break;
              case "external":
                stroke = "#9ca3af";
                fill = "#f9fafb";
                break;
              case "variable":
              default:
                stroke = "#9ca3af";
                fill = "#ffffff";
                break;
            }

            return (
              <g key={node.id}>
                <rect
                  x={rectX}
                  y={rectY}
                  rx={radius}
                  ry={radius}
                  width={node.width}
                  height={node.height}
                  fill={fill}
                  stroke={stroke}
                  strokeWidth={1}
                />
                <text
                  x={node.x}
                  y={node.y + 3}
                  fontSize={11}
                  textAnchor="middle"
                  fill="#111827"
                >
                  {node.label}
                </text>
              </g>
            );
          })}
        </g>

        {/* edge (곡선) */}
        <g className="graph-edges">
          {edges.map((edge) => {
            const style = getEdgeStyle(edge.kind);
            const fromNode = nodeMap[edge.from.nodeId];
            const toNode = nodeMap[edge.to.nodeId];

            if (!fromNode || !toNode) return null;

            // 기본 앵커 (유틸 사용)
            const baseAnchors = getHorizontalAnchors(fromNode, toNode);
            let fromX = baseAnchors.fromX;
            const fromY = baseAnchors.fromY;
            let toX = baseAnchors.toX;
            const toY = baseAnchors.toY;

            // 방향 판정은 노드 중심 기준
            // const isLeftToRight = fromNode.x < toNode.x;
            const isRightToLeft = fromNode.x > toNode.x;

            // 우측 → 좌측인 경우, 노드 "안쪽" 테두리 기준으로 앵커 재조정
            if (isRightToLeft) {
              const fromLeft = fromNode.x - fromNode.width / 2; // 오른쪽 노드의 왼쪽 테두리
              const toRight = toNode.x + toNode.width / 2; // 왼쪽 노드의 오른쪽 테두리

              fromX = fromLeft;
              toX = toRight;
              // fromY, toY는 baseAnchors 사용 (세로 정렬 유지)
            }

            // 곡선 세기
            const curveOffset = 0.1 * (toX - fromX);
            const midX = (fromX + toX) / 2;

            const c1x = midX;
            const c2x = midX;
            let c1y = fromY;
            let c2y = toY;

            /* if (isLeftToRight || isRightToLeft) { */
            // 좌 → 우 : 위쪽으로 둥글게
            c1y = fromY - curveOffset;
            c2y = toY - curveOffset;
            /* } else if (isRightToLeft) {
              // 우 → 좌 : 아래쪽으로 둥글게
              c1y = fromY + curveOffset;
              c2y = toY + curveOffset;
            } */

            const d = `M ${fromX} ${fromY} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${toX} ${toY}`;

            return (
              <path
                key={edge.id}
                d={d}
                fill="none"
                stroke={style.stroke}
                strokeWidth={1.2}
                strokeDasharray={style.dashed ? "3 2" : undefined}
                markerEnd={`url(#${style.markerId})`}
              />
            );
          })}
        </g>
      </svg>
    </div>
  );
}
