declare namespace BuildGraph {
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
    | "external"
    | "state-link";

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
    colX: Record<
      "independent" | "state" | "variable" | "effect" | "jsx",
      number
    >;
  }
}
