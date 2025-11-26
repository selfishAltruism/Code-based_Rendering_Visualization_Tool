// components/RenderGraphSvg.tsx
"use client";

import React, { useMemo } from "react";
import type { ComponentAnalysis } from "../libs/analyzeReactComponent";
import {
  buildGraphFromAnalysis,
  type GraphNode,
  type GraphEdge,
  type GraphEdgeKind,
} from "../libs/graphModel";

interface RenderGraphSvgProps {
  analysis: ComponentAnalysis | null;
  svgRef: React.RefObject<SVGSVGElement | null>;
}

/**
 * 두 점 사이를 부드러운 S자 곡선으로 연결하는 path 생성
 */
function buildCurvePath(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): string {
  const mx = (x1 + x2) / 2;
  const dy = y2 - y1;
  const offset = Math.max(Math.min(dy * 0.3, 80), -80);

  const c1x = mx;
  const c1y = y1 + offset;
  const c2x = mx;
  const c2y = y2 - offset;

  return `M ${x1} ${y1} C ${c1x} ${c1y} ${c2x} ${c2y} ${x2} ${y2}`;
}

/**
 * edge 종류별 스타일
 */
function getEdgeStyle(kind: GraphEdgeKind): {
  stroke: string;
  dashed?: boolean;
  markerId: string;
} {
  switch (kind) {
    case "flow":
      return {
        stroke: "#8b5cf6", // 보라 계열
        dashed: true,
        markerId: "arrow-solid",
      };
    case "state-dependency":
      return {
        stroke: "#9ca3af", // 회색
        dashed: true,
        markerId: "arrow-muted",
      };
    case "state-mutation":
      return {
        stroke: "#b91c1c", // 붉은 계열
        dashed: false,
        markerId: "arrow-accent",
      };
    case "external":
    default:
      return {
        stroke: "#6b7280",
        dashed: true,
        markerId: "arrow-muted",
      };
  }
}

export function RenderGraphSvg({ analysis, svgRef }: RenderGraphSvgProps) {
  const { nodes, edges, width, height, colX } = useMemo(
    () => buildGraphFromAnalysis(analysis),
    [analysis],
  );

  if (!analysis) {
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
        </defs>

        {/* 컬럼 타이틀 */}
        <g fontSize={11} fill="#4b5563">
          <text x={colX.independent} y={40} textAnchor="middle">
            렌더링 독립
          </text>
          <text x={colX.state} y={40} textAnchor="middle">
            렌더링 결정 / 상태
          </text>
          <text x={colX.variable} y={40} textAnchor="middle">
            변수 / 헬퍼
          </text>
          <text x={colX.effect} y={40} textAnchor="middle">
            렌더링 후속
          </text>
          <text x={colX.jsx} y={40} textAnchor="middle">
            JSX
          </text>
        </g>

        {/* edge (곡선) */}
        <g>
          {edges.map((edge) => {
            const style = getEdgeStyle(edge.kind);
            const d = buildCurvePath(
              edge.from.x,
              edge.from.y,
              edge.to.x,
              edge.to.y,
            );

            const midX = (edge.from.x + edge.to.x) / 2;
            const midY = (edge.from.y + edge.to.y) / 2;

            return (
              <g key={edge.id}>
                <path
                  d={d}
                  fill="none"
                  stroke={style.stroke}
                  strokeWidth={1}
                  strokeDasharray={style.dashed ? "3 2" : undefined}
                  markerEnd={`url(#${style.markerId})`}
                />
                {edge.label && (
                  <text
                    x={midX}
                    y={midY - 4}
                    fontSize={9}
                    textAnchor="middle"
                    fill={style.stroke}
                  >
                    {edge.label}
                  </text>
                )}
              </g>
            );
          })}
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
      </svg>
    </div>
  );
}
