// Finds code blocks in the annotated text layer and floats "Copy" / "Edit" buttons over each one.
// A block is the 2-row table written by CB.lang.toDocsHtml: an 8pt Roboto Mono label run followed by
// 10pt Roboto Mono code runs inside the same cell column.
var CB = globalThis.CB || (globalThis.CB = {});

(() => {
  const PX = (pt) => (pt * 4) / 3;
  const near = (a, b) => Math.abs(a - b) < 0.3;
  const isLabel = (r) => r.family === CB.lang.FONT && near(r.px, PX(CB.lang.LABEL_PT)) && /^[a-z0-9+#_.-]{1,24}$/.test(r.text);
  const isCode = (r) => r.family === CB.lang.FONT && near(r.px, PX(CB.lang.CODE_PT));

  // Docs recycles canvas tiles, so the SVG layer is NOT in document order (a later page's tile can come
  // first). On-screen position is: pages stack vertically, so sort by row, then by x.
  function orderedRuns() {
    return CB.docs.runs()
      .filter((r) => r.box.height > 0)
      .sort((a, b) => Math.round(a.box.top) - Math.round(b.box.top) || a.box.left - b.box.left);
  }

  function findBlocks() {
    const runs = orderedRuns();
    const blocks = [];
    for (let i = 0; i < runs.length; i++) {
      const label = runs[i];
      if (!isLabel(label)) continue;
      const code = [];
      for (let j = i + 1; j < runs.length; j++) {
        const r = runs[j];
        // Runs left of the label's column are outside the table cell.
        if (!isCode(r) || r.box.left < label.box.left - 1.5) break;
        code.push(r);
        i = j;
      }
      const bottom = Math.max(label.box.bottom, ...code.map((r) => r.box.bottom));
      blocks.push({ label, code, lang: label.text, top: label.box.top, bottom });
    }
    return blocks;
  }

  const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[s.length >> 1] : 0; };

  // Rebuild source text from glyph geometry. Leading spaces aren't in the run labels, but the font is
  // monospace, so a run's x offset from the cell edge gives its column exactly.
  // Limitation: a line that Docs soft-wraps comes back as two lines; "Edit" reads the exact text instead.
  function blockText(block) {
    const runs = block.code.filter((r) => r.text.length);
    if (!runs.length) return "";
    const charW = median(runs.map((r) => r.box.width / r.text.length));
    const originX = block.label.box.left;
    const rows = [];
    for (const r of runs) {
      const row = rows.find((l) => Math.abs(l.top - r.box.top) < 2);
      row ? row.runs.push(r) : rows.push({ top: r.box.top, page: r.el.closest(".kix-page-paginated"), runs: [r] });
    }
    rows.sort((a, b) => a.top - b.top);
    const lineH = median(rows.slice(1).map((l, i) => l.top - rows[i].top)) || 1;
    const out = [];
    rows.forEach((row, i) => {
      // Vertical gaps mean blank lines, except the gap between pages when a block spans a page break.
      if (i > 0 && row.page === rows[i - 1].page) for (let k = Math.round((row.top - rows[i - 1].top) / lineH) - 1; k > 0; k--) out.push("");
      let line = "";
      for (const r of row.runs.sort((a, b) => a.box.left - b.box.left)) {
        const col = Math.max(0, Math.round((r.box.left - originX) / charW));
        line = line.padEnd(col, " ") + r.text;
      }
      out.push(line);
    });
    return out.join("\n");
  }

  async function writeClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      const ta = Object.assign(document.createElement("textarea"), { value: text });
      ta.style.cssText = "position:fixed;opacity:0;top:0;left:0";
      document.body.append(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    }
  }

  const STYLE = `
    :host { all: initial; }
    .layer { position: fixed; inset: 0; pointer-events: none; z-index: 25; font: 12px/1 system-ui, sans-serif; }
    .bar { position: fixed; display: flex; gap: 4px; transform: translate(-100%, -50%); pointer-events: auto; }
    button { font: inherit; padding: 3px 8px; border-radius: 5px; border: 1px solid #d0d7de; background: #fff;
      color: #24292f; cursor: pointer; box-shadow: 0 1px 0 rgba(31,35,40,.04); }
    button:hover { background: #f3f4f6; }
    .toast { position: fixed; left: 50%; bottom: 32px; transform: translateX(-50%); background: #1f2328; color: #fff;
      padding: 8px 14px; border-radius: 8px; pointer-events: none; font: 13px/1.4 system-ui, sans-serif; z-index: 2147483001; }`;

  let layer, root;
  function ensureLayer() {
    if (layer?.isConnected) return;
    const host = document.createElement("div");
    root = host.attachShadow({ mode: "open" });
    layer = Object.assign(document.createElement("div"), { className: "layer" });
    root.append(Object.assign(document.createElement("style"), { textContent: STYLE }), layer);
    document.documentElement.append(host);
  }

  let toastTimer = 0;
  function toast(msg, ms = 2600) {
    ensureLayer();
    root.querySelector(".toast")?.remove();
    const t = Object.assign(document.createElement("div"), { className: "toast", textContent: msg });
    root.append(t);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.remove(), ms);
  }

  function button(label, onClick) {
    const b = Object.assign(document.createElement("button"), { textContent: label });
    // mousedown would move Docs' focus/caret; keep the caret where the user left it.
    b.addEventListener("mousedown", (e) => e.preventDefault());
    b.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); onClick(b); });
    return b;
  }

  function makeBar() {
    const bar = Object.assign(document.createElement("div"), { className: "bar" });
    bar.append(
      button("Copy", async (b) => {
        const ok = await writeClipboard(blockText(bar.block));
        b.textContent = ok ? "Copied ✓" : "Copy failed";
        setTimeout(() => (b.textContent = "Copy"), 1400);
      }),
      button("Edit", () => CB.main.editBlock(bar.block)),
    );
    return bar;
  }

  // Bars are reused between frames so hover state and "Copied ✓" survive re-layout.
  function place() {
    ensureLayer();
    const view = document.querySelector(".kix-appview-editor")?.getBoundingClientRect();
    const visible = [];
    if (view && !CB.editor.isOpen()) {
      for (const block of findBlocks()) {
        const y = block.label.box.top + block.label.box.height / 2;
        if (y > view.top + 8 && y < view.bottom - 8) visible.push({ block, y });
      }
    }
    const bars = [...layer.children];
    visible.forEach(({ block, y }, i) => {
      const bar = bars[i] || layer.appendChild(makeBar());
      const { label } = block;
      // The table spans the text column and page margins are symmetric, so mirror the cell's left edge.
      const tile = label.el.closest(".kix-canvas-tile-content");
      const tb = tile?.getBoundingClientRect();
      const scale = tile && tile.offsetWidth ? tb.width / tile.offsetWidth : 1;
      const cellLeft = label.box.left - 9 * scale;
      const right = tb ? tb.right - (cellLeft - tb.left) - 4 * scale : label.box.right + 200;
      bar.block = block;
      bar.style.left = `${right}px`;
      bar.style.top = `${y}px`;
    });
    bars.slice(visible.length).forEach((b) => b.remove());
  }

  let queued = false;
  function schedule() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; place(); });
  }

  function start() {
    const watch = () => {
      const editor = document.querySelector(".kix-appview-editor");
      if (!editor) return setTimeout(watch, 500);
      new MutationObserver(schedule).observe(editor, { subtree: true, childList: true, attributes: true, attributeFilter: ["aria-label", "transform"] });
      document.addEventListener("scroll", schedule, true);
      window.addEventListener("resize", schedule);
      schedule();
    };
    watch();
  }

  CB.overlay = { start, findBlocks, blockText, writeClipboard, toast, refresh: schedule };
})();
