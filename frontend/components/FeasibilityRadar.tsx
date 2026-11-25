"use client";

import type { FeasibilityReport } from "@/lib/feasibility";

export type RadarDimensionPoint = {
  key: keyof FeasibilityReport["dimensions"];
  label: string;
  status: FeasibilityReport["dimensions"][keyof FeasibilityReport["dimensions"]]["status"];
};

function statusScore(status: RadarDimensionPoint["status"]): number {
  if (status === "Looks workable") return 1.0;
  if (status === "Needs planning") return 0.62;
  return 0.34;
}

function polarPoint(index: number, total: number, radius: number, cx: number, cy: number) {
  const angle = -Math.PI / 2 + (index * 2 * Math.PI) / total;
  return {
    x: cx + radius * Math.cos(angle),
    y: cy + radius * Math.sin(angle),
  };
}

export function FeasibilityRadar({
  dimensions,
  activeKey,
  onSelect,
}: {
  dimensions: RadarDimensionPoint[];
  activeKey: keyof FeasibilityReport["dimensions"] | null;
  onSelect: (key: keyof FeasibilityReport["dimensions"], scrollToCard: boolean) => void;
}) {
  const size = 280;
  const cx = size / 2;
  const cy = size / 2;
  const maxRadius = 86;
  const ringLevels = [0.34, 0.62, 1.0];

  const dataPoints = dimensions.map((dim, idx) => {
    const score = statusScore(dim.status);
    const point = polarPoint(idx, dimensions.length, maxRadius * score, cx, cy);
    const labelPoint = polarPoint(idx, dimensions.length, maxRadius + 24, cx, cy);
    const outerPoint = polarPoint(idx, dimensions.length, maxRadius, cx, cy);
    return {
      ...dim,
      score,
      x: point.x,
      y: point.y,
      lx: labelPoint.x,
      ly: labelPoint.y,
      ox: outerPoint.x,
      oy: outerPoint.y,
    };
  });

  const polygonPoints = dataPoints.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(" ");
  const activeDim = dataPoints.find((d) => d.key === activeKey) ?? null;

  return (
    <div className="feasibility-radar-wrap">
      <svg
        className="feasibility-radar-svg"
        viewBox={`0 0 ${size} ${size}`}
        role="img"
        aria-label="Six-dimension feasibility radar chart"
      >
        {ringLevels.map((level) => {
          const pts = dimensions
            .map((_, idx) => {
              const p = polarPoint(idx, dimensions.length, maxRadius * level, cx, cy);
              return `${p.x.toFixed(2)},${p.y.toFixed(2)}`;
            })
            .join(" ");
          return (
            <polygon
              key={level}
              points={pts}
              className="feasibility-radar-ring"
            />
          );
        })}

        {dataPoints.map((point) => (
          <line
            key={`axis-${point.key}`}
            x1={cx}
            y1={cy}
            x2={point.ox}
            y2={point.oy}
            className={
              "feasibility-radar-axis" +
              (activeKey === point.key ? " is-active" : "")
            }
          />
        ))}

        <polygon
          points={polygonPoints}
          className="feasibility-radar-polygon"
        />

        {dataPoints.map((point) => {
          const isSelected = activeKey === point.key;
          const tone =
            point.status === "Looks workable"
              ? "workable"
              : point.status === "Needs planning"
                ? "planning"
                : "clarity";
          const anchor =
            Math.abs(point.lx - cx) < 10
              ? "middle"
              : point.lx > cx
                ? "start"
                : "end";

          return (
            <g key={point.key} className="feasibility-radar-node-group">
              <text
                x={point.lx}
                y={point.ly + 4}
                textAnchor={anchor}
                className={
                  "feasibility-radar-label" + (isSelected ? " is-active" : "")
                }
                onClick={() => onSelect(point.key, true)}
              >
                {point.label}
              </text>

              <circle
                cx={point.x}
                cy={point.y}
                r={isSelected ? 10 : 7}
                className={`feasibility-radar-halo ${tone}${isSelected ? " is-active" : ""}`}
              />
              <circle
                cx={point.x}
                cy={point.y}
                r={isSelected ? 5.5 : 4.2}
                tabIndex={0}
                role="button"
                aria-label={`${point.label}: ${point.status}. Inspect breakdown.`}
                aria-pressed={isSelected}
                className={`feasibility-radar-vertex ${tone}${isSelected ? " is-active" : ""}`}
                onMouseEnter={() => onSelect(point.key, false)}
                onFocus={() => onSelect(point.key, false)}
                onClick={() => onSelect(point.key, true)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onSelect(point.key, true);
                  }
                }}
              />
            </g>
          );
        })}
      </svg>

      <div className="feasibility-radar-readout" aria-live="polite">
        {activeDim ? (
          <>
            <strong>{activeDim.label}</strong>
            <span aria-hidden="true">·</span>
            <span>{activeDim.status}</span>
          </>
        ) : (
          <span>Select a chart node to inspect a dimension</span>
        )}
      </div>
    </div>
  );
}
