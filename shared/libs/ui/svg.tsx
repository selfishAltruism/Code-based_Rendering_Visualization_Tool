export function getEdgeStyle(kind: BuildGraph.GraphEdgeKind): {
  stroke: string;
  dashed?: boolean;
  markerId: string;
} {
  switch (kind) {
    case "flow":
      return {
        stroke: "#8b5cf6",
        dashed: false, // ← 전부 false
        markerId: "arrow-solid",
      };
    case "state-dependency":
      return {
        stroke: "#9ca3af",
        dashed: false,
        markerId: "arrow-muted",
      };
    case "state-mutation":
      return {
        stroke: "#b91c1c",
        dashed: false,
        markerId: "arrow-accent",
      };
    case "state-link":
      return {
        stroke: "#4686df",
        dashed: false,
        markerId: "arrow-gray",
      };
    case "external":
    default:
      return {
        stroke: "#6b7280",
        dashed: false,
        markerId: "arrow-muted",
      };
  }
}
