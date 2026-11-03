// Small SVG line charts for the explainer page: responsive width, hairline grid, crosshair with a tooltip listing
// every series at the hovered x (pointer and arrow keys), optional log scale, markers and a legend. No dependency.
const SVG = "http://www.w3.org/2000/svg";

function s(tag, attrs = {}, text) {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null) el.setAttribute(k, v);
  if (text !== undefined) el.textContent = text;
  return el;
}

/** Value at `x` on the line drawn through sorted `points`: a series may have far fewer points than the first one. */
export function valueAt(points, x) {
  if (x <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++) {
    const [x1, y1] = points[i];
    if (x <= x1) {
      const [x0, y0] = points[i - 1];
      return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
    }
  }
  return points.at(-1)[1];
}

/**
 * Creates a chart in `container`; returns { update(options) }.
 * options: {
 *   series: [{ label, color, points: [[x, y], …], width?, dash?, right? }]  (the first series drives the crosshair),
 *   x: { min, max, ticks: [values], format(v) }, y: { min, max, log?, ticks: [values], format(v) },
 *   y2: same as y, the right-hand axis of the series marked `right`,
 *   xLabel, yLabel, y2Label, markers: [{ x, label }], points: [{ x, y, label }], tooltip(x, values) => [[label, value, color?]],
 *   legend: boolean, height
 * }
 */
export function lineChart(container, initial) {
  const wrap = document.createElement("div");
  wrap.className = "chart";
  wrap.tabIndex = 0;
  const legend = document.createElement("div");
  legend.className = "chart-legend";
  const tip = document.createElement("div");
  tip.className = "chart-tip";
  tip.hidden = true;
  wrap.append(legend, tip);
  container.append(wrap);
  let options = initial;
  let svg = null;
  let geometry = null;
  let hover = null; // index into the first series

  const draw = () => {
    const width = Math.max(280, wrap.clientWidth);
    const height = options.height ?? (width < 520 ? 240 : 300);
    const m = { top: 28, right: options.y2 ? 62 : 16, bottom: 40, left: width < 520 ? 52 : 64 };
    const { x, y, y2 } = options;
    const X = (v) => m.left + ((v - x.min) / (x.max - x.min)) * (width - m.left - m.right);
    const scale = (axis) => (v) => {
      const ty = (u) => (axis.log ? Math.log10(u) : u);
      const lo = ty(axis.min);
      const hi = ty(axis.max);
      const c = Math.min(hi, Math.max(lo, ty(Math.max(v, axis.log ? 1e-12 : -Infinity))));
      return height - m.bottom - ((c - lo) / (hi - lo)) * (height - m.top - m.bottom);
    };
    const Y = scale(y);
    const Y2 = y2 ? scale(y2) : Y;
    const seriesY = (sr) => (sr.right ? Y2 : Y);
    geometry = { X, seriesY, m, width, height };

    const next = s("svg", { width, height, viewBox: `0 0 ${width} ${height}`, role: "img", "aria-label": options.ariaLabel ?? "" });
    const grid = s("g", { class: "chart-grid" });
    for (const v of y.ticks) {
      grid.append(s("line", { x1: m.left, x2: width - m.right, y1: Y(v), y2: Y(v) }));
      grid.append(s("text", { x: m.left - 8, y: Y(v) + 4, "text-anchor": "end", class: "chart-tick" }, y.format(v)));
    }
    for (const v of y2?.ticks ?? []) grid.append(s("text", { x: width - m.right + 8, y: Y2(v) + 4, class: "chart-tick" }, y2.format(v)));
    for (const v of x.ticks) grid.append(s("text", { x: X(v), y: height - m.bottom + 18, "text-anchor": "middle", class: "chart-tick" }, x.format(v)));
    grid.append(s("line", { x1: m.left, x2: width - m.right, y1: height - m.bottom, y2: height - m.bottom, class: "chart-axis" }));
    if (options.xLabel) grid.append(s("text", { x: width - m.right, y: height - 6, "text-anchor": "end", class: "chart-label" }, options.xLabel));
    if (options.yLabel) grid.append(s("text", { x: m.left - 8, y: 12, class: "chart-label" }, options.yLabel));
    if (options.y2Label) grid.append(s("text", { x: width - 2, y: 12, "text-anchor": "end", class: "chart-label" }, options.y2Label));
    next.append(grid);

    for (const mk of options.markers ?? []) {
      const g = s("g", { class: "chart-marker" });
      g.append(s("line", { x1: X(mk.x), x2: X(mk.x), y1: m.top, y2: height - m.bottom }));
      if (mk.label) g.append(s("text", { x: X(mk.x) + 6, y: m.top + 12, class: "chart-label" }, mk.label));
      next.append(g);
    }
    for (const sr of options.series) {
      const d = sr.points.map(([px, py], i) => `${i ? "L" : "M"}${X(px).toFixed(1)},${seriesY(sr)(py).toFixed(1)}`).join("");
      next.append(s("path", { d, fill: "none", stroke: sr.color, "stroke-width": sr.width ?? 2, "stroke-dasharray": sr.dash, "stroke-linejoin": "round", "stroke-linecap": "round" }));
    }
    for (const p of options.points ?? []) {
      next.append(s("circle", { cx: X(p.x), cy: Y(p.y), r: 6, fill: p.color, stroke: "var(--surface)", "stroke-width": 2 }));
      if (p.label) {
        const right = X(p.x) < width - 140;
        next.append(s("text", { x: X(p.x) + (right ? 10 : -10), y: Y(p.y) - 10, "text-anchor": right ? "start" : "end", class: "chart-direct" }, p.label));
      }
    }
    const cross = s("g", { class: "chart-cross", visibility: "hidden" });
    cross.append(s("line", { y1: m.top, y2: height - m.bottom }));
    // Last drawn is on top: when dots overlap, the first series, the chart's main one, stays visible.
    options.series.forEach((sr, k) => cross.prepend(s("circle", { r: 4, fill: sr.color, stroke: "var(--surface)", "stroke-width": 2, "data-series": k })));
    cross.prepend(cross.querySelector("line"));
    next.append(cross);
    if (svg) svg.replaceWith(next);
    else wrap.insertBefore(next, tip);
    svg = next;

    legend.replaceChildren();
    if (options.legend) {
      for (const sr of options.series) {
        const item = document.createElement("span");
        const key = document.createElement("i");
        key.style.background = sr.color;
        if (sr.dash) {
          key.className = "dashed";
          key.style.color = sr.color;
        }
        item.append(key, document.createTextNode(sr.label));
        legend.append(item);
      }
    }
    legend.hidden = !options.legend;
    if (hover !== null) show(hover);
  };

  const nearest = (px) => {
    const pts = options.series[0].points;
    let best = 0;
    for (let i = 1; i < pts.length; i++) if (Math.abs(geometry.X(pts[i][0]) - px) < Math.abs(geometry.X(pts[best][0]) - px)) best = i;
    return best;
  };

  function show(i) {
    const pts = options.series[0].points;
    hover = Math.max(0, Math.min(pts.length - 1, i));
    const xv = pts[hover][0];
    const values = options.series.map((sr) => valueAt(sr.points, xv));
    const cross = svg.querySelector(".chart-cross");
    const cx = geometry.X(xv);
    cross.setAttribute("visibility", "visible");
    cross.querySelector("line").setAttribute("x1", cx);
    cross.querySelector("line").setAttribute("x2", cx);
    cross.querySelectorAll("circle").forEach((c) => {
      const k = Number(c.dataset.series);
      c.setAttribute("cx", cx);
      c.setAttribute("cy", geometry.seriesY(options.series[k])(values[k]));
    });
    tip.replaceChildren();
    for (const [label, value, color] of options.tooltip(xv, values)) {
      const row = document.createElement("div");
      if (color) {
        const key = document.createElement("i");
        key.style.background = color;
        row.append(key);
      }
      const strong = document.createElement("strong");
      strong.textContent = value;
      row.append(strong, document.createTextNode(` ${label}`));
      tip.append(row);
    }
    tip.hidden = false;
    const left = cx + 14 + tip.offsetWidth > geometry.width ? cx - 14 - tip.offsetWidth : cx + 14;
    tip.style.left = `${Math.max(0, left)}px`;
    tip.style.top = `${geometry.m.top + legend.offsetHeight}px`;
  }

  const hide = () => {
    hover = null;
    tip.hidden = true;
    svg?.querySelector(".chart-cross")?.setAttribute("visibility", "hidden");
  };

  wrap.addEventListener("pointermove", (e) => {
    const rect = svg.getBoundingClientRect();
    show(nearest(e.clientX - rect.left));
  });
  wrap.addEventListener("pointerleave", hide);
  wrap.addEventListener("blur", hide);
  wrap.addEventListener("focus", () => show(hover ?? options.series[0].points.length - 1));
  wrap.addEventListener("keydown", (e) => {
    const step = e.shiftKey ? 10 : 1;
    if (e.key === "ArrowRight") show((hover ?? 0) + step);
    else if (e.key === "ArrowLeft") show((hover ?? 0) - step);
    else if (e.key === "Escape") hide();
    else return;
    e.preventDefault();
  });
  new ResizeObserver(() => draw()).observe(wrap);
  draw();

  return {
    update(next) {
      options = { ...options, ...next };
      draw();
    },
  };
}

/**
 * Bar chart in `container`: one series, thin bars with rounded tops, an optional reference line, a tooltip on each
 * bar (pointer and keyboard focus). options: { bars: [{ label, value, title? }], color, y: { max, ticks, format },
 * reference: { value, label }, tooltip(bar) => [[label, value]], ariaLabel, height }
 */
export function barChart(container, options) {
  const wrap = document.createElement("div");
  wrap.className = "chart";
  const tip = document.createElement("div");
  tip.className = "chart-tip";
  tip.hidden = true;
  wrap.append(tip);
  container.append(wrap);
  let svg = null;

  const draw = () => {
    const width = Math.max(280, wrap.clientWidth);
    const height = options.height ?? 220;
    const m = { top: 20, right: 12, bottom: 34, left: width < 520 ? 44 : 56 };
    const { bars, y } = options;
    const band = (width - m.left - m.right) / Math.max(1, bars.length);
    const barWidth = Math.max(4, Math.min(48, band * 0.6));
    const Y = (v) => height - m.bottom - (Math.min(v, y.max) / y.max) * (height - m.top - m.bottom);
    const next = s("svg", { width, height, viewBox: `0 0 ${width} ${height}`, role: "img", "aria-label": options.ariaLabel ?? "" });
    const grid = s("g", { class: "chart-grid" });
    for (const v of y.ticks) {
      grid.append(s("line", { x1: m.left, x2: width - m.right, y1: Y(v), y2: Y(v) }));
      grid.append(s("text", { x: m.left - 8, y: Y(v) + 4, "text-anchor": "end", class: "chart-tick" }, y.format(v)));
    }
    next.append(grid);
    const labelEvery = Math.ceil(bars.length / Math.max(1, Math.floor((width - m.left - m.right) / 56)));
    bars.forEach((b, i) => {
      const cx = m.left + band * (i + 0.5);
      const top = Y(b.value);
      const base = height - m.bottom;
      const r = Math.min(4, barWidth / 2, base - top);
      const x0 = cx - barWidth / 2;
      const d = base - top < 0.5 ? "" : `M${x0},${base}V${top + r}Q${x0},${top} ${x0 + r},${top}H${x0 + barWidth - r}Q${x0 + barWidth},${top} ${x0 + barWidth},${top + r}V${base}Z`;
      const g = s("g", { class: "chart-bar", tabindex: "0" });
      g.append(s("rect", { x: cx - band / 2, y: m.top, width: band, height: base - m.top, fill: "transparent" }));
      if (d) g.append(s("path", { d, fill: options.color }));
      const over = () => {
        tip.replaceChildren();
        for (const [label, value] of options.tooltip(b)) {
          const row = document.createElement("div");
          const strong = document.createElement("strong");
          strong.textContent = value;
          row.append(strong, document.createTextNode(` ${label}`));
          tip.append(row);
        }
        tip.hidden = false;
        tip.style.left = `${Math.max(0, Math.min(cx + 10, width - tip.offsetWidth))}px`;
        tip.style.top = `${Math.max(0, top - tip.offsetHeight - 8)}px`;
        g.classList.add("hover");
      };
      const out = () => {
        tip.hidden = true;
        g.classList.remove("hover");
      };
      g.addEventListener("pointerenter", over);
      g.addEventListener("pointerleave", out);
      g.addEventListener("focus", over);
      g.addEventListener("blur", out);
      next.append(g);
      if (i % labelEvery === 0) next.append(s("text", { x: cx, y: height - m.bottom + 18, "text-anchor": "middle", class: "chart-tick" }, b.label));
    });
    if (options.reference) {
      const ry = Y(options.reference.value);
      const g = s("g", { class: "chart-marker" });
      g.append(s("line", { x1: m.left, x2: width - m.right, y1: ry, y2: ry }));
      g.append(s("text", { x: width - m.right, y: ry - 6, "text-anchor": "end", class: "chart-label" }, options.reference.label));
      next.append(g);
    }
    if (svg) svg.replaceWith(next);
    else wrap.insertBefore(next, tip);
    svg = next;
  };
  new ResizeObserver(() => draw()).observe(wrap);
  draw();
}
