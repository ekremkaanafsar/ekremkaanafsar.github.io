/* Small, dependency-free SVG charts for project pages.

   HOW TO USE:

     <figure class="chart-figure">
       <div class="chart" data-type="bar">          <!-- bar | line | coef -->
         <script type="application/json">
           { "title": "...", "subtitle": "...", "unit": "%", "decimals": 1,
             "labels": ["A", "B"],
             "series": [ { "name": "Wind", "values": [42, 31] } ] }
         </script>
       </div>
       <figcaption>Figure 2. ... Source: ...</figcaption>
     </figure>

   Data shapes
     bar   labels: [category...]; series[i].values: [number...]            (horizontal bars)
     line  x: [number or text...]; series[i].values: [number or null...]   (null = gap)
     coef  labels: [variable...];  series[i].values: [[estimate, low, high]...]
           optional "reference": 0, "ciLabel": "95% CI"   (dot-and-whisker plot)

   Optional keys: title, subtitle, unit (appended to numbers, e.g. "%" or " km"),
   decimals, xLabel, yLabel, yMin (line), height (line, px).
   At most 2 series per chart (colors validated for color-blind readers).
   Every chart gets hover/keyboard tooltips and a "Show data table" view. */
(function () {
  "use strict";

  var NS = "http://www.w3.org/2000/svg";
  var MAX_SERIES = 2;
  var measure = document.createElement("canvas").getContext("2d");

  // ---------- helpers ----------
  function svg(name, attrs, parent) {
    var n = document.createElementNS(NS, name);
    if (attrs) for (var k in attrs) if (attrs[k] !== null && attrs[k] !== undefined) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  }
  function html(tag, cls, parent, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    if (parent) parent.appendChild(n);
    return n;
  }
  function textWidth(s, px) {
    measure.font = px + "px 'IBM Plex Sans', system-ui, sans-serif";
    return measure.measureText(String(s)).width;
  }
  function svgText(parent, x, y, str, cls, anchor) {
    var t = svg("text", { x: x, y: y, "class": cls, "text-anchor": anchor || "start", "dominant-baseline": "middle" }, parent);
    t.textContent = str;
    return t;
  }
  function truncate(str, px, maxW) {
    str = String(str);
    if (textWidth(str, px) <= maxW) return str;
    while (str.length > 1 && textWidth(str + "…", px) > maxW) str = str.slice(0, -1);
    return str + "…";
  }
  function niceTicks(min, max, count) {
    if (min === max) { min -= 1; max += 1; }
    var raw = (max - min) / Math.max(1, count);
    var mag = Math.pow(10, Math.floor(Math.log10(raw)));
    var norm = raw / mag;
    var step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
    var lo = Math.floor(min / step + 1e-9) * step;
    var hi = Math.ceil(max / step - 1e-9) * step;
    var ticks = [];
    for (var v = lo; v <= hi + step / 2; v += step) ticks.push(Math.round(v / step) * step);
    return ticks;
  }
  function formatter(cfg) {
    var unit = cfg.unit || "";
    var d = typeof cfg.decimals === "number" ? cfg.decimals : null;
    return function (v) {
      if (v === null || v === undefined || isNaN(v)) return "n/a";
      var opts = d === null ? { maximumFractionDigits: 2 } : { minimumFractionDigits: d, maximumFractionDigits: d };
      return Number(v).toLocaleString("en-US", opts) + unit;
    };
  }
  function xText(v, fmt) {
    if (typeof v === "number" && Number.isInteger(v) && v > 999 && v < 3000) return String(v); // years
    return typeof v === "number" ? fmt(v) : String(v);
  }
  function scale(d0, d1, r0, r1) {
    return function (v) { return d1 === d0 ? (r0 + r1) / 2 : r0 + (v - d0) / (d1 - d0) * (r1 - r0); };
  }

  // ---------- tooltip ----------
  function Tip(root) {
    var el = html("div", "chart-tip", root);
    el.setAttribute("aria-hidden", "true");
    el.hidden = true;
    return {
      show: function (x, y, title, rows) {
        el.textContent = "";
        html("div", "tip-title", el, title);
        rows.forEach(function (r) {
          var row = html("div", "tip-row", el);
          html("i", "key " + r.cls, row);
          html("strong", null, row, r.value);
          if (r.name) html("span", null, row, r.name);
        });
        el.hidden = false;
        var w = root.clientWidth, tw = el.offsetWidth, th = el.offsetHeight;
        var left = x + 14 + tw > w ? x - tw - 14 : x + 14;
        el.style.left = Math.max(0, left) + "px";
        el.style.top = Math.max(0, y - th / 2) + "px";
      },
      hide: function () { el.hidden = true; }
    };
  }
  function pointerPos(root, evt) {
    var b = root.getBoundingClientRect();
    return [evt.clientX - b.left, evt.clientY - b.top];
  }

  // ---------- shared chrome ----------
  function legend(root, series, kind) {
    if (series.length < 2) return;
    var ul = html("ul", "chart-legend", root);
    series.forEach(function (s, i) {
      var li = html("li", null, ul);
      var k = svg("svg", { width: 18, height: 12, "aria-hidden": "true" }, li);
      var c = "s" + (i + 1);
      if (kind === "line") svg("line", { x1: 1, y1: 6, x2: 17, y2: 6, "class": c + " stroke-only" }, k);
      else if (kind === "coef") marker(k, 9, 6, i, 4);
      else svg("rect", { x: 1, y: 1, width: 16, height: 10, rx: 2, "class": c + " bar" }, k);
      html("span", null, li, s.name);
    });
  }
  function marker(parent, x, y, i, r) {
    // Series 1 = circle, series 2 = diamond: shape as a second channel besides color.
    var c = "s" + (i + 1) + " ring";
    if (i === 0) return svg("circle", { cx: x, cy: y, r: r, "class": c }, parent);
    var d = r + 1;
    return svg("path", { d: "M" + x + " " + (y - d) + " L" + (x + d) + " " + y + " L" + x + " " + (y + d) + " L" + (x - d) + " " + y + " Z", "class": c }, parent);
  }
  function table(root, head, rows) {
    var det = html("details", "chart-table", root);
    html("summary", null, det, "Show data table");
    var t = html("table", null, det);
    var tr = html("tr", null, html("thead", null, t));
    head.forEach(function (h) { html("th", null, tr, h).setAttribute("scope", "col"); });
    var tb = html("tbody", null, t);
    rows.forEach(function (r) {
      var row = html("tr", null, tb);
      r.forEach(function (c, j) { html(j === 0 ? "th" : "td", j === 0 ? null : "num", row, c); });
    });
  }
  function verticalGrid(g, ticks, sx, top, bottom, fmt, xLabel, width) {
    ticks.forEach(function (t) {
      var x = Math.round(sx(t)) + 0.5;
      svg("line", { x1: x, x2: x, y1: top, y2: bottom, "class": "grid" }, g);
      svgText(g, x, bottom + 14, fmt(t), "tick", "middle");
    });
    if (xLabel) svgText(g, (sx(ticks[0]) + sx(ticks[ticks.length - 1])) / 2, bottom + 36, xLabel, "axis-title", "middle");
  }

  // ---------- bar (horizontal, 1-2 series) ----------
  function bar(root, cfg, W, tip) {
    var fmt = formatter(cfg), S = cfg.series, L = cfg.labels, n = S.length;
    var all = []; S.forEach(function (s) { all = all.concat(s.values.filter(function (v) { return v !== null; })); });
    var ticks = niceTicks(Math.min(0, Math.min.apply(null, all)), Math.max(0, Math.max.apply(null, all)), W < 480 ? 4 : 6);
    var labelW = Math.min(Math.max.apply(null, L.map(function (l) { return textWidth(l, 13.5); })) + 14, W * 0.38);
    var showVals = L.length * n <= 16;
    var right = W - (showVals ? Math.max.apply(null, all.map(function (v) { return textWidth(fmt(v), 12.5); })) + 12 : 16);
    var barT = n === 1 ? 20 : 15, rowH = n === 1 ? 38 : 50, top = 6;
    var bottom = top + L.length * rowH, H = bottom + (cfg.xLabel ? 46 : 26);
    var sx = scale(ticks[0], ticks[ticks.length - 1], labelW, right);
    var s0 = svg("svg", { "class": "plot", viewBox: "0 0 " + W + " " + H, width: W, height: H, role: "img", "aria-label": cfg.title || "Bar chart" });
    var g = svg("g", null, s0);
    verticalGrid(g, ticks, sx, top, bottom, fmt, cfg.xLabel, W);
    var zx = Math.round(sx(0)) + 0.5;
    svg("line", { x1: zx, x2: zx, y1: top, y2: bottom, "class": "axis" }, g);
    L.forEach(function (lab, i) {
      var y0 = top + i * rowH, groupH = n * barT + (n - 1) * 2;
      var hit = svg("rect", { x: 0, y: y0, width: W, height: rowH, "class": "hit", tabindex: 0 }, g);
      var c = svgText(g, labelW - 10, y0 + rowH / 2, truncate(lab, 13.5, labelW - 12), "cat", "end");
      svg("title", null, c).textContent = lab;
      var rows = [];
      S.forEach(function (s, k) {
        var v = s.values[i]; rows.push({ cls: "s" + (k + 1), value: fmt(v), name: n > 1 ? s.name : "" });
        if (v === null || v === undefined) return;
        var y = y0 + (rowH - groupH) / 2 + k * (barT + 2), x0 = sx(0), x1 = sx(v);
        var len = Math.abs(x1 - x0), r = Math.min(4, len, barT / 2), dir = v >= 0 ? 1 : -1, e = x1 - dir * r;
        var d = "M" + x0 + " " + y + " H" + e + " Q" + x1 + " " + y + " " + x1 + " " + (y + r) +
                " V" + (y + barT - r) + " Q" + x1 + " " + (y + barT) + " " + e + " " + (y + barT) + " H" + x0 + " Z";
        svg("path", { d: d, "class": "bar s" + (k + 1) }, g);
        if (showVals) svgText(g, x1 + dir * 6, y + barT / 2, fmt(v), "val", dir > 0 ? "start" : "end");
      });
      hit.setAttribute("aria-label", lab + ": " + rows.map(function (r) { return (r.name ? r.name + " " : "") + r.value; }).join(", "));
      function show(evt) {
        var p = evt && evt.clientX !== undefined ? pointerPos(root, evt) : [sx(Math.max.apply(null, S.map(function (s) { return s.values[i] || 0; }))), y0 + rowH / 2 + svgOffset(root)];
        tip.show(p[0], p[1], lab, rows);
      }
      hit.addEventListener("pointermove", show);
      hit.addEventListener("focus", function () { show(null); });
      hit.addEventListener("pointerleave", tip.hide);
      hit.addEventListener("blur", tip.hide);
    });
    return { svg: s0, head: ["Category"].concat(S.map(function (s) { return s.name; })),
             rows: L.map(function (l, i) { return [l].concat(S.map(function (s) { return fmt(s.values[i]); })); }) };
  }

  // ---------- coefficient (dot-and-whisker) ----------
  function coef(root, cfg, W, tip) {
    var fmt = formatter(cfg), S = cfg.series, L = cfg.labels, n = S.length;
    var ref = typeof cfg.reference === "number" ? cfg.reference : 0, ci = cfg.ciLabel || "95% CI";
    var lo = ref, hi = ref;
    S.forEach(function (s) { s.values.forEach(function (v) { if (v) { lo = Math.min(lo, v[1], v[0]); hi = Math.max(hi, v[2], v[0]); } }); });
    var ticks = niceTicks(lo, hi, W < 480 ? 4 : 6);
    var labelW = Math.min(Math.max.apply(null, L.map(function (l) { return textWidth(l, 13.5); })) + 14, W * 0.38);
    var rowH = n === 1 ? 34 : 46, top = 6, bottom = top + L.length * rowH, H = bottom + (cfg.xLabel ? 46 : 26);
    var sx = scale(ticks[0], ticks[ticks.length - 1], labelW, W - 16);
    var s0 = svg("svg", { "class": "plot", viewBox: "0 0 " + W + " " + H, width: W, height: H, role: "img", "aria-label": cfg.title || "Coefficient plot" });
    var g = svg("g", null, s0);
    verticalGrid(g, ticks, sx, top, bottom, fmt, cfg.xLabel, W);
    var rx = Math.round(sx(ref)) + 0.5;
    svg("line", { x1: rx, x2: rx, y1: top, y2: bottom, "class": "ref" }, g);
    L.forEach(function (lab, i) {
      var y0 = top + i * rowH, cy = y0 + rowH / 2;
      var hit = svg("rect", { x: 0, y: y0, width: W, height: rowH, "class": "hit", tabindex: 0 }, g);
      var c = svgText(g, labelW - 10, cy, truncate(lab, 13.5, labelW - 12), "cat", "end");
      svg("title", null, c).textContent = lab;
      var rows = [];
      S.forEach(function (s, k) {
        var v = s.values[i];
        rows.push({ cls: "s" + (k + 1), value: v ? fmt(v[0]) + "  [" + fmt(v[1]) + ", " + fmt(v[2]) + "]" : "n/a", name: n > 1 ? s.name : "" });
        if (!v) return;
        var y = cy + (k - (n - 1) / 2) * 14;
        svg("line", { x1: sx(v[1]), x2: sx(v[2]), y1: y, y2: y, "class": "s" + (k + 1) + " stroke-only" }, g);
        marker(g, sx(v[0]), y, k, 5);
      });
      hit.setAttribute("aria-label", lab + ": " + rows.map(function (r) { return (r.name ? r.name + " " : "") + r.value; }).join("; "));
      function show(evt) {
        var p = evt ? pointerPos(root, evt) : [W * 0.6, cy + svgOffset(root)];
        tip.show(p[0], p[1], lab + " (estimate, " + ci + ")", rows);
      }
      hit.addEventListener("pointermove", show);
      hit.addEventListener("focus", function () { show(null); });
      hit.addEventListener("pointerleave", tip.hide);
      hit.addEventListener("blur", tip.hide);
    });
    var head = ["Variable"];
    S.forEach(function (s) { var p = n > 1 ? s.name + " " : ""; head.push(p + "estimate", p + ci); });
    return { svg: s0, head: head, rows: L.map(function (l, i) {
      var r = [l];
      S.forEach(function (s) { var v = s.values[i]; r.push(v ? fmt(v[0]) : "n/a", v ? fmt(v[1]) + " to " + fmt(v[2]) : "n/a"); });
      return r;
    }) };
  }

  // ---------- line ----------
  function line(root, cfg, W, tip) {
    var fmt = formatter(cfg), S = cfg.series, X = cfg.x, n = S.length;
    var numericX = X.every(function (v) { return typeof v === "number"; });
    var xs = numericX ? X : X.map(function (_, i) { return i; });
    var vals = []; S.forEach(function (s) { vals = vals.concat(s.values.filter(function (v) { return v !== null && v !== undefined; })); });
    var yMin = typeof cfg.yMin === "number" ? cfg.yMin : Math.min(0, Math.min.apply(null, vals));
    var yt = niceTicks(yMin, Math.max.apply(null, vals), 5);
    var H = cfg.height || (W < 480 ? 240 : 300);
    var leftW = Math.max.apply(null, yt.map(function (t) { return textWidth(fmt(t), 12); })) + 12;
    var lastVals = S.map(function (s) { for (var j = s.values.length - 1; j >= 0; j--) if (s.values[j] !== null && s.values[j] !== undefined) return [j, s.values[j]]; return null; });
    var endW = Math.max.apply(null, lastVals.map(function (lv) { return lv ? textWidth(fmt(lv[1]), 12.5) : 0; })) + 16;
    var top = 10, bottom = H - (cfg.xLabel ? 46 : 26), left = leftW, right = W - endW;
    var sx = scale(xs[0], xs[xs.length - 1], left, right), sy = scale(yt[0], yt[yt.length - 1], bottom, top);
    var s0 = svg("svg", { "class": "plot", viewBox: "0 0 " + W + " " + H, width: W, height: H, role: "img", "aria-label": cfg.title || "Line chart" });
    var g = svg("g", null, s0);
    yt.forEach(function (t) {
      var y = Math.round(sy(t)) + 0.5;
      svg("line", { x1: left, x2: right, y1: y, y2: y, "class": t === yt[0] ? "axis" : "grid" }, g);
      svgText(g, left - 8, y, fmt(t), "tick", "end");
    });
    if (cfg.yLabel) svgText(g, 0, top - 2, cfg.yLabel, "axis-title", "start").setAttribute("dominant-baseline", "auto");
    var maxTicks = Math.max(2, Math.floor((right - left) / 64)), every = Math.ceil(X.length / maxTicks);
    X.forEach(function (v, i) {
      if (i % every !== 0) return; // even spacing; the end value label marks the last point
      svgText(g, sx(xs[i]), bottom + 14, xText(v, fmt), "tick", "middle");
    });
    if (cfg.xLabel) svgText(g, (left + right) / 2, bottom + 36, cfg.xLabel, "axis-title", "middle");
    S.forEach(function (s, k) {
      var d = "", pen = false;
      s.values.forEach(function (v, i) {
        if (v === null || v === undefined) { pen = false; return; }
        d += (pen ? " L" : " M") + sx(xs[i]).toFixed(1) + " " + sy(v).toFixed(1); pen = true;
      });
      svg("path", { d: d, "class": "s" + (k + 1) + " stroke-only" }, g);
    });
    // End dots + end values (skipped if the two labels would collide; legend + tooltip carry it).
    var ys = lastVals.map(function (lv) { return lv ? sy(lv[1]) : null; });
    var collide = n === 2 && ys[0] !== null && ys[1] !== null && Math.abs(ys[0] - ys[1]) < 16;
    lastVals.forEach(function (lv, k) {
      if (!lv) return;
      marker(g, sx(xs[lv[0]]), sy(lv[1]), k, 4);
      if (!collide) svgText(g, sx(xs[lv[0]]) + 9, sy(lv[1]), fmt(lv[1]), "val", "start");
    });
    // Hover layer: crosshair snaps to the nearest x; arrow keys move it.
    var cross = svg("line", { y1: top, y2: bottom, "class": "crosshair", visibility: "hidden" }, g);
    var dots = svg("g", null, g);
    var ov = svg("rect", { x: left, y: top, width: right - left, height: bottom - top, "class": "overlay", tabindex: 0,
      "aria-label": (cfg.title || "Line chart") + ". Use left and right arrow keys to read values." }, g);
    var idx = X.length - 1;
    function render(i, px, py) {
      idx = Math.max(0, Math.min(X.length - 1, i));
      var x = sx(xs[idx]);
      cross.setAttribute("x1", x); cross.setAttribute("x2", x); cross.setAttribute("visibility", "visible");
      dots.textContent = "";
      var rows = S.map(function (s, k) {
        var v = s.values[idx];
        if (v !== null && v !== undefined) marker(dots, x, sy(v), k, 4);
        return { cls: "s" + (k + 1), value: fmt(v), name: n > 1 ? s.name : "" };
      });
      tip.show(px === undefined ? x : px, py === undefined ? top + 40 + svgOffset(root) : py, xText(X[idx], fmt), rows);
    }
    function nearest(px) {
      var best = 0, bd = Infinity;
      xs.forEach(function (v, i) { var dd = Math.abs(sx(v) - px); if (dd < bd) { bd = dd; best = i; } });
      return best;
    }
    function hide() { cross.setAttribute("visibility", "hidden"); dots.textContent = ""; tip.hide(); }
    ov.addEventListener("pointermove", function (e) {
      var p = pointerPos(root, e), b = s0.getBoundingClientRect(), k = W / b.width;
      render(nearest((e.clientX - b.left) * k), p[0], p[1]);
    });
    ov.addEventListener("pointerleave", hide);
    ov.addEventListener("focus", function () { render(idx); });
    ov.addEventListener("blur", hide);
    ov.addEventListener("keydown", function (e) {
      if (e.key === "ArrowLeft") { render(idx - 1); e.preventDefault(); }
      if (e.key === "ArrowRight") { render(idx + 1); e.preventDefault(); }
    });
    return { svg: s0, head: [cfg.xLabel || "x"].concat(S.map(function (s) { return s.name; })),
             rows: X.map(function (v, i) { return [xText(v, fmt)].concat(S.map(function (s) { return fmt(s.values[i]); })); }) };
  }

  function svgOffset(root) {
    // Distance from the top of the chart box to the top of the plot (SVG has no offsetTop).
    var s = root.querySelector("svg.plot");
    return s ? s.getBoundingClientRect().top - root.getBoundingClientRect().top : 0;
  }

  // ---------- mount ----------
  var TYPES = { bar: bar, line: line, coef: coef };

  function mount(root) {
    var src = root.querySelector('script[type="application/json"]');
    var cfg;
    try { cfg = JSON.parse(src.textContent); } catch (err) {
      html("p", "chart-error", root, "Chart data is not valid JSON: " + err.message);
      return;
    }
    var type = root.getAttribute("data-type");
    if (!TYPES[type]) { html("p", "chart-error", root, 'Unknown chart type "' + type + '". Use bar, line or coef.'); return; }
    if (cfg.series.length > MAX_SERIES) {
      console.warn("charts.js: only the first " + MAX_SERIES + " series are drawn. Split into two charts instead.");
      cfg.series = cfg.series.slice(0, MAX_SERIES);
    }
    var lastW = 0;
    function draw() {
      var W = Math.floor(root.clientWidth);
      if (!W || W === lastW) return;
      lastW = W;
      Array.prototype.slice.call(root.children).forEach(function (c) { if (c !== src) root.removeChild(c); });
      if (cfg.title) html("p", "chart-title", root, cfg.title);
      if (cfg.subtitle) html("p", "chart-sub", root, cfg.subtitle);
      legend(root, cfg.series, type);
      var tip = Tip(root);
      var out = TYPES[type](root, cfg, W, tip);
      root.appendChild(out.svg);
      table(root, out.head, out.rows);
    }
    draw();
    if ("ResizeObserver" in window) {
      var pending = false;
      new ResizeObserver(function () {
        if (pending) return;
        pending = true;
        requestAnimationFrame(function () { pending = false; draw(); });
      }).observe(root);
    }
  }

  function init() { document.querySelectorAll(".chart[data-type]").forEach(mount); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
