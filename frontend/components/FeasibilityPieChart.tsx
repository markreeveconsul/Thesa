"use client";

import type { FeasibilityReport } from "@/lib/feasibility";

export type PieDimensionPoint = {
  key: keyof FeasibilityReport["dimensions"];
  label: string;
  shortLabel: string;
  status: FeasibilityReport["dimensions"][keyof FeasibilityReport["dimensions"]]["status"];
};

function slicePath(
  cx: number,
  cy: number,
  radius: number,
  startDeg: number,
  endDeg: number,
): string {
  const startRad = ((startDeg - 90) * Math.PI) / 180;
  const endRad = ((endDeg - 90) * Math.PI) / 180;
  const x1 = cx + radius * Math.cos(startRad);
  const y1 = cy + radius * Math.sin(startRad);
  const x2 = cx + radius * Math.cos(endRad);
  const y2 = cy + radius * Math.sin(endRad);
  const largeArc = endDeg - startDeg > 180 ? 1 : 0;
  return `M ${cx} ${cy} L ${x1.toFixed(2)} ${y1.toFixed(2)} A ${radius} ${radius} 0 ${largeArc} 1 ${x2.toFixed(2)} ${y2.toFixed(2)} Z`;
}

function polarDeg(cx: number, cy: number, radius: number, deg: number) {
  const rad = ((deg - 90) * Math.PI) / 180;
  return {
    x: cx + radius * Math.cos(rad),
    y: cy + radius * Math.sin(rad),
  };
}

export function FeasibilityPieChart({
  dimensions,
  activeKey,
  onSelect,
}: {
  dimensions: PieDimensionPoint[];
  activeKey: keyof FeasibilityReport["dimensions"] | null;
  onSelect: (key: keyof FeasibilityReport["dimensions"], scrollToCard: boolean) => void;
}) {
  const size = 276;
  const cx = size / 2;
  const cy = size / 2;
  const radius = 78;
  const total = Math.max(1, dimensions.length);
  const stepDeg = 360 / total;
  const gapDeg = 2.4;

  const activeDim = dimensions.find((d) => d.key === activeKey) ?? null;

  return (
    <div className="feasibility-pie-wrap">
      <svg
        className="feasibility-pie-svg"
        viewBox={`0 0 ${size} ${size}`}
        role="img"
        aria-label="Six-dimension feasibility pie chart"
      >
        <g className="feasibility-pie-disc">
          {dimensions.map((dim, idx) => {
            const startDeg = idx * stepDeg + gapDeg / 2;
            const endDeg = (idx + 1) * stepDeg - gapDeg / 2;
            const midDeg = (startDeg + endDeg) / 2;
            const isSelected = activeKey === dim.key;
            const tone =
              dim.status === "Looks workable"
                ? "workable"
                : dim.status === "Needs planning"
                  ? "planning"
                  : "clarity";
            const pop = polarDeg(0, 0, isSelected ? 7 : 0, midDeg);
            const labelPos = polarDeg(cx, cy, radius + 22, midDeg);
            const anchor =
              Math.abs(labelPos.x - cx) < 10
                ? "middle"
                : labelPos.x > cx
                  ? "start"
                  : "end";

            return (
              <g key={dim.key}>
                <path
                  d={slicePath(cx, cy, radius, startDeg, endDeg)}
                  transform={`translate(${pop.x.toFixed(2)}, ${pop.y.toFixed(2)})`}
                  tabIndex={0}
                  role="button"
                  aria-label={`${dim.label}: ${dim.status}. Inspect breakdown.`}
                  aria-pressed={isSelected}
                  className={`feasibility-pie-slice ${tone}${isSelected ? " is-active" : ""}`}
                  onMouseEnter={() => onSelect(dim.key, false)}
                  onFocus={() => onSelect(dim.key, false)}
                  onClick={() => onSelect(dim.key, true)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onSelect(dim.key, true);
                    }
                  }}
                />
                <text
                  x={labelPos.x}
                  y={labelPos.y + 4}
                  textAnchor={anchor}
                  className={
                    "feasibility-pie-label" + (isSelected ? " is-active" : "")
                  }
                  onClick={() => onSelect(dim.key, true)}
                >
                  {dim.shortLabel}
                </text>
              </g>
            );
          })}
        </g>
      </svg>

      <div className="feasibility-pie-readout" aria-live="polite">
        {activeDim ? (
          <>
            <strong>{activeDim.label}</strong>
            <span aria-hidden="true">·</span>
            <span>{activeDim.status}</span>
          </>
        ) : (
          <span>Click any slice to inspect its breakdown</span>
        )}
      </div>

      <div className="feasibility-pie-legend" aria-label="Chart status legend">
        <span>
          <i className="legend-swatch workable" aria-hidden="true" />
          Workable
        </span>
        <span>
          <i className="legend-swatch planning" aria-hidden="true" />
          Needs planning
        </span>
        <span>
          <i className="legend-swatch clarity" aria-hidden="true" />
          Needs clarity
        </span>
      </div>
    </div>
  );
}
