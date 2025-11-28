"use client";

import { useRef, useState } from "react";
import {
  analyzeReactComponent,
  type ComponentAnalysis,
} from "../libs/analyzeReactComponent";
import { RenderGraphSvg } from "../entities/RenderGraphSvg";

const SOURCE_INIT = `import React, { useState, useEffect, useRef } from 'react';

function ExampleComponent() {
  const ref = useRef<HTMLDivElement | null>(null);
  const [count, setCount] = useState(0);

  useEffect(() => {
    console.log('effect', count);
    ref.current = document.body;
  }, [count]);

  return (
    <div ref={ref}>
      <button onClick={() => setCount((c) => c + 1)}>Click {count}</button>
    </div>
  );
}

export default ExampleComponent;
`;

export default function Page() {
  const [source, setSource] = useState<string>(SOURCE_INIT);

  const [analysis, setAnalysis] = useState<ComponentAnalysis | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const svgRef = useRef<SVGSVGElement | null>(null);
  const fullscreenSvgRef = useRef<SVGSVGElement | null>(null);

  const handleAnalyze = () => {
    const result = analyzeReactComponent(source);
    setAnalysis(result);
  };

  const handleDownloadSvg = () => {
    const svgElement = svgRef.current;
    if (!svgElement) return;

    const serializer = new XMLSerializer();
    let serialized = serializer.serializeToString(svgElement);

    if (!serialized.match(/^<svg[^>]+xmlns=/)) {
      serialized = serialized.replace(
        /^<svg/,
        '<svg xmlns="http://www.w3.org/2000/svg"',
      );
    }

    const blob = new Blob([serialized], {
      type: "image/svg+xml;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "crv-graph.svg";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleOpenFullscreen = () => {
    if (!analysis) return;
    setIsFullscreen(true);
  };

  const handleCloseFullscreen = () => {
    setIsFullscreen(false);
  };

  return (
    <main className="flex h-screen flex-col">
      <header className="border-b border-neutral-200 bg-white">
        <div className="mx-auto flex h-12 max-w-6xl items-center justify-between px-4">
          <div className="flex items-baseline gap-2">
            <span className="text-lg font-semibold tracking-tight">crv.</span>
            <span className="text-sm text-neutral-500">
              React Code-based Rendeing Visualization Tool
            </span>
          </div>
        </div>
      </header>

      {/* <section id="hero" className="border-b border-neutral-200 bg-neutral-50">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
          <div className="flex-1">
            <h1 className="text-lg font-bold md:text-xl">
              React 렌더링 흐름 SVG 시각화.
            </h1>
            <p className="text-sm text-neutral-700">
              코드 한 파일 기준으로 렌더링 결정 요소와 JSX 구조를 즉시 확인하는
              용도임.
            </p>
          </div>
        </div>
      </section> */}

      <section id="playground" className="flex flex-1 py-2">
        <div className="mx-auto flex h-full w-full max-w-6xl flex-col px-4">
          <div className="grid h-full flex-1 gap-4 md:grid-cols-2">
            {/* 코드 입력 영역. */}
            <section
              aria-label="React 코드 입력 영역."
              className="flex h-full min-h-[0] flex-col"
            >
              <div className="mb-2 flex h-8 items-center justify-between">
                <label
                  htmlFor="code-input"
                  className="text-sm font-medium text-neutral-700"
                >
                  Component Source Code
                </label>
              </div>
              <textarea
                id="code-input"
                className="min-h-0 flex-1 rounded-md border border-neutral-300 bg-white p-3 font-mono text-sm leading-relaxed text-neutral-800 shadow-sm outline-none focus:border-neutral-500 focus:ring-1 focus:ring-neutral-400"
                value={source}
                onChange={(e) => setSource(e.target.value)}
                spellCheck={false}
              />
              <button
                type="button"
                onClick={handleAnalyze}
                className="mt-3 self-end rounded-md bg-neutral-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-neutral-800"
              >
                분석 실행
              </button>
            </section>

            {/* SVG 시각화 영역. */}
            <section
              aria-label="React 렌더링 SVG 시각화 영역."
              className="flex h-full min-h-[0] flex-col"
            >
              <div className="mb-2 flex h-8 items-center justify-between gap-2">
                <span className="text-sm font-semibold">Graph</span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={handleOpenFullscreen}
                    disabled={!analysis}
                    className="rounded-md border border-neutral-300 bg-white px-3 py-1 text-sm text-neutral-700 hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    전체 화면
                  </button>
                  <button
                    type="button"
                    onClick={handleDownloadSvg}
                    disabled={!analysis}
                    className="rounded-md border border-neutral-300 bg-white px-3 py-1 text-sm text-neutral-700 hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    SVG 다운로드
                  </button>
                </div>
              </div>
              <div className="min-h-0 flex-1 overflow-auto rounded-md border border-neutral-200 bg-neutral-50 p-2">
                {analysis && analysis.errors.length > 0 && (
                  <div className="mb-2 rounded-md border border-red-300 bg-red-50 px-2 py-1 text-sm text-red-700">
                    {analysis.errors.map((err, idx) => (
                      <div key={idx}>{err}</div>
                    ))}
                  </div>
                )}
                <div className="h-full w-full">
                  <RenderGraphSvg analysis={analysis} svgRef={svgRef} />
                </div>
              </div>
            </section>
          </div>
        </div>
      </section>

      <footer className="border-t border-neutral-200 bg-neutral-50">
        <div className="mx-auto flex h-12 max-w-6xl flex-col items-start justify-center px-4 text-xs text-neutral-500">
          <span>© 2025 crv. All rights reserved.</span>
          <a
            href="https://github.com/selfishAltruism"
            target="_blank"
            rel="noopener noreferrer"
          >
            Designed & Made by <strong>Kyu</strong>
          </a>
        </div>
      </footer>

      {/* 전체 화면 SVG 오버레이. */}
      {isFullscreen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
          <div className="relative h-[90vh] w-[90vw] rounded-md bg-white p-3 shadow-lg">
            <button
              type="button"
              onClick={handleCloseFullscreen}
              className="absolute top-2 right-4 rounded-md text-sm text-neutral-700"
            >
              x
            </button>
            <div className="mt-6 h-[calc(100%-2.5rem)] w-full overflow-auto rounded-md border border-neutral-200 bg-neutral-50 p-2">
              <div className="h-full w-full">
                <RenderGraphSvg analysis={analysis} svgRef={fullscreenSvgRef} />
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
