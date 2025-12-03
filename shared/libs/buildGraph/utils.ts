import traverse, { NodePath } from "@babel/traverse";
import * as t from "@babel/types";

type MutationAction = {
  target: string;
  via: "setState" | "ref";
};

export function detectMutationActions(
  astNode: t.Node | null | undefined,
): MutationAction[] {
  const mutations: MutationAction[] = [];
  if (!astNode) return mutations;

  traverse(astNode, {
    // useState / setXXX 호출 감지
    CallExpression(path: NodePath<t.CallExpression>) {
      const callee = path.node.callee;

      // callee가 Identifier일 때만 name에 접근
      if (t.isIdentifier(callee) && callee.name.startsWith("set")) {
        mutations.push({
          target: callee.name,
          via: "setState",
        });
      }
    },

    // ref.current = XXX 형태 감지
    AssignmentExpression(path: NodePath<t.AssignmentExpression>) {
      const left = path.node.left;

      if (
        t.isMemberExpression(left) &&
        t.isIdentifier(left.property) &&
        left.property.name === "current" &&
        t.isIdentifier(left.object)
      ) {
        mutations.push({
          target: left.object.name,
          via: "ref",
        });
      }
    },
  });

  return mutations;
}

export function appendMutationEdges(
  layout: BuildGraph.GraphLayout,
  mappingResult: Mapping.MappingResult | null,
): BuildGraph.GraphEdge[] {
  const edges: BuildGraph.GraphEdge[] = [...layout.edges];
  if (!mappingResult) return edges;

  // layout.nodes 안의 각 node.meta에 AST 같은 정보가 들어있다고 가정
  for (const node of layout.nodes) {
    const astNode = node.meta?.ast as t.Node | undefined;
    if (!astNode) continue;

    const actions = detectMutationActions(astNode);
    if (!actions.length) continue;

    for (const act of actions) {
      // target 찾는 방식은 프로젝트에 맞춰 조정 필요
      const targetNode = layout.nodes.find(
        (n) => n.label === act.target || n.meta?.name === act.target,
      );
      if (!targetNode) continue;

      const edgeId = `mutation-${node.id}-${targetNode.id}`;

      // 중복 방지
      if (edges.some((e) => e.id === edgeId)) continue;

      edges.push({
        id: edgeId,
        kind: "state-mutation",
        from: {
          nodeId: node.id,
          x: node.x,
          y: node.y,
        },
        to: {
          nodeId: targetNode.id,
          x: targetNode.x,
          y: targetNode.y,
        },
      });
    }
  }

  return edges;
}

export function getNodeCenter(node: BuildGraph.GraphNode) {
  return {
    cx: node.x, // 이미 center x
    cy: node.y, // 이미 center y
  };
}

export function getHorizontalAnchors(
  fromNode: BuildGraph.GraphNode,
  toNode: BuildGraph.GraphNode,
) {
  const fromHalfW = fromNode.width / 2;
  const toHalfW = toNode.width / 2;

  // from: 오른쪽 중앙
  const fromX = fromNode.x + fromHalfW;
  const fromY = fromNode.y;

  // to: 왼쪽 중앙
  const toX = toNode.x - toHalfW;
  const toY = toNode.y;

  return { fromX, fromY, toX, toY };
}
export function getCornerToward(
  node: BuildGraph.GraphNode,
  towardDx: number,
  towardDy: number,
) {
  const halfW = node.width / 2;
  const halfH = node.height / 2;

  // dx, dy 기준으로 사분면 판단
  if (towardDx >= 0 && towardDy >= 0) {
    // 오른쪽-아래 방향 → 오른쪽-아래 코너
    return {
      x: node.x + halfW,
      y: node.y + halfH,
    };
  }
  if (towardDx >= 0 && towardDy < 0) {
    // 오른쪽-위 방향 → 오른쪽-위 코너
    return {
      x: node.x + halfW,
      y: node.y - halfH,
    };
  }
  if (towardDx < 0 && towardDy >= 0) {
    // 왼쪽-아래 방향 → 왼쪽-아래 코너
    return {
      x: node.x - halfW,
      y: node.y + halfH,
    };
  }
  // 왼쪽-위 방향
  return {
    x: node.x - halfW,
    y: node.y - halfH,
  };
}
