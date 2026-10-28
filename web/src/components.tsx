import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import type { Point, Status } from "./types";

export const labels: Record<Status, string> = {
  queued: "Queued",
  running: "Running",
  succeeded: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
};
export function StatusPill({ status }: { status: Status }) {
  return (
    <span className={`status-pill ${status}`}>
      <span className="status-dot" />
      {labels[status]}
    </span>
  );
}
export const number = (value: number) =>
  new Intl.NumberFormat("en-US").format(value);
export const compact = (value: number) =>
  new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
export const duration = (seconds: number) =>
  seconds < 1 ? `${Math.round(seconds * 1000)} ms` : `${seconds.toFixed(1)} s`;
export const clock = (value: string) =>
  new Date(value).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

export function Modal({
  title,
  subtitle,
  close,
  children,
}: {
  title: string;
  subtitle?: string;
  close: () => void;
  children: ReactNode;
}) {
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const node = container.current!;
    const focusable = () =>
      Array.from(
        node.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input, select, a[href], [tabindex="0"]',
        ),
      );
    focusable()[0]?.focus();
    function keydown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
      }
      if (event.key !== "Tab") return;
      const elements = focusable();
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    }
    node.addEventListener("keydown", keydown);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      node.removeEventListener("keydown", keydown);
      document.body.style.overflow = overflow;
      previous?.focus();
    };
  }, [close]);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        ref={container}
      >
        <div className="modal-heading">
          <div>
            <h2 id="modal-title">{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button
            className="icon-button"
            aria-label="Close dialog"
            onClick={close}
          >
            <X size={20} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function ConvergenceChart({ points }: { points: Point[] }) {
  const width = 440;
  const height = 180;
  const left = 43;
  const right = 16;
  const top = 16;
  const bottom = 30;
  const values = points.map((point) => point.estimate);
  const low = Math.min(...values, Math.PI) - 0.008;
  const high = Math.max(...values, Math.PI) + 0.008;
  const span = Math.max(0.025, high - low);
  const min = (high + low - span) / 2;
  const max = min + span;
  const n = Math.max(...points.map((point) => point.samples), 1);
  const x = (samples: number) => left + (samples / n) * (width - left - right);
  const y = (estimate: number) =>
    top + ((max - estimate) / span) * (height - top - bottom);
  const line = points
    .map((point) => `${x(point.samples)},${y(point.estimate)}`)
    .join(" ");
  const ticks = [min, min + span / 2, max];
  return (
    <div className="chart-wrap">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="convergence-chart"
        role="img"
        aria-label={`Convergence of the pi estimate across ${compact(n)} samples. The dashed line is the mathematical value of pi.`}
      >
        <defs>
          <linearGradient id="chart-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#488f7a" stopOpacity=".17" />
            <stop offset="100%" stopColor="#488f7a" stopOpacity="0" />
          </linearGradient>
        </defs>
        {ticks.map((tick) => (
          <g key={tick}>
            <line
              x1={left}
              x2={width - right}
              y1={y(tick)}
              y2={y(tick)}
              stroke="#e6ebe7"
            />
            <text
              x={left - 8}
              y={y(tick) + 4}
              textAnchor="end"
              className="chart-label"
            >
              {tick.toFixed(3)}
            </text>
          </g>
        ))}
        <line
          x1={left}
          x2={width - right}
          y1={y(Math.PI)}
          y2={y(Math.PI)}
          stroke="#9ca9a3"
          strokeDasharray="4 4"
        />
        {points.length > 1 && (
          <>
            <polygon
              points={`${x(points[0].samples)},${height - bottom} ${line} ${x(n)},${height - bottom}`}
              fill="url(#chart-fill)"
            />
            <polyline
              points={line}
              stroke="#287a66"
              strokeWidth="2.5"
              strokeLinejoin="round"
              strokeLinecap="round"
              fill="none"
            />
          </>
        )}
        {points.length > 0 && (
          <circle
            cx={x(points[points.length - 1].samples)}
            cy={y(points[points.length - 1].estimate)}
            r="4"
            fill="#287a66"
            stroke="white"
            strokeWidth="2"
          />
        )}
        <text x={left} y={height - 6} className="chart-label">
          0
        </text>
        <text
          x={x(n / 2)}
          y={height - 6}
          textAnchor="middle"
          className="chart-label"
        >
          {compact(n / 2)}
        </text>
        <text
          x={width - right}
          y={height - 6}
          textAnchor="end"
          className="chart-label"
        >
          {compact(n)} samples
        </text>
      </svg>
      <div className="chart-legend">
        <span>
          <i className="legend-estimate" />
          Estimate
        </span>
        <span>
          <i className="legend-reference" />π reference
        </span>
      </div>
    </div>
  );
}
