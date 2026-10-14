// Bridge to the Google Docs editor, based on what its shipped client actually does:
//  - keystrokes/clipboard go through a hidden same-origin iframe (iframe.docs-texteventtarget-iframe)
//    whose contenteditable textbox receives keydown/keypress/copy/paste; Docs honours synthetic events there.
//  - text is painted on canvas, but the annotated-canvas SVG layer (see annotate.js) mirrors every run as
//    <rect aria-label=text data-font-css="400 13.3333px &quot;docs-Roboto Mono&quot;"> with real geometry.
//  - synthetic mouse events are ignored, so the caret can only be moved with keys.
var CB = globalThis.CB || (globalThis.CB = {});

(() => {
  const KEYCODES = { Backspace: 8, Tab: 9, Enter: 13, Escape: 27, End: 35, Home: 36, ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, Delete: 46, "\\": 220 };
  const CODES = { "\\": "Backslash" };

  const frame = () => document.querySelector("iframe.docs-texteventtarget-iframe");
  function textbox() {
    const doc = frame()?.contentDocument;
    return doc?.querySelector('[contenteditable="true"]') || doc?.activeElement || null;
  }

  function key(k, mods = {}) {
    const el = textbox();
    if (!el) return;
    const keyCode = KEYCODES[k] ?? k.toUpperCase().charCodeAt(0);
    const init = { key: k, code: CODES[k] ?? (k.length === 1 ? "Key" + k.toUpperCase() : k), keyCode, which: keyCode, bubbles: true, cancelable: true, ...mods };
    el.dispatchEvent(new KeyboardEvent("keydown", init));
    el.dispatchEvent(new KeyboardEvent("keyup", init));
  }

  // Docs fills the DataTransfer of a synthetic copy event with the current selection.
  function copyData() {
    const el = textbox();
    const dt = new DataTransfer();
    el?.dispatchEvent(new ClipboardEvent("copy", { clipboardData: dt, bubbles: true, cancelable: true }));
    return dt;
  }
  const copySelection = () => copyData().getData("text/plain");
  // Pasting over a selection that contains tables can hang Docs for good (observed: a block pasted over a
  // range holding two blocks and the notes between them), so callers must never do that.
  const selectionHasTable = () => /<table\b/i.test(copyData().getData("text/html"));

  // Docs applies a synthetic paste asynchronously and drops pastes that arrive while one is pending,
  // so callers must not fire several in a row; wait for the result with afterRender().
  function paste(plain, html) {
    const el = textbox();
    if (!el) return false;
    const dt = new DataTransfer();
    if (html) dt.setData("text/html", html);
    dt.setData("text/plain", plain);
    el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
    return true;
  }

  function focus() {
    frame()?.focus();
    textbox()?.focus();
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  // Resolve once the annotated text layer changes (or after `timeout`).
  function afterRender(timeout = 1500) {
    const root = document.querySelector(".kix-appview-editor") || document.body;
    return new Promise((resolve) => {
      const done = () => { obs.disconnect(); clearTimeout(t); setTimeout(resolve, 50); };
      const obs = new MutationObserver(done);
      obs.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ["aria-label", "transform"] });
      const t = setTimeout(done, timeout);
    });
  }

  function caretRect() {
    const own = document.querySelector(".kix-cursor.docs-text-ui-cursor-blink .kix-cursor-caret") || document.querySelector(".kix-cursor-caret");
    const r = own?.getBoundingClientRect();
    return r && r.height > 0 ? r : null;
  }

  // Selected text from the caret back to the start of its (visual) line, selection left in place.
  function selectToLineStart() {
    key("Home", { shiftKey: true });
    return copySelection();
  }
  function collapseRight() { key("ArrowRight"); }

  // Move the caret to the start of its line without disturbing anything else.
  function toLineStart() {
    if (selectToLineStart()) key("ArrowLeft");
  }

  // Width (pt) of the text column at the caret, read from the ruler's paragraph indent markers.
  // Pasted tables otherwise shrink to their content (or overflow when replacing a table).
  function columnWidthPt() {
    const marker = (cls) => [...document.querySelectorAll(cls)].map((e) => e.getBoundingClientRect()).find((b) => b.width > 0);
    const start = marker(".docs-ruler-indent-start");
    const end = marker(".docs-ruler-indent-end");
    const tile = document.querySelector(".kix-canvas-tile-content");
    if (!start || !end || !tile?.offsetWidth) return null;
    const scale = tile.getBoundingClientRect().width / tile.offsetWidth;
    const px = (end.left + end.width / 2 - (start.left + start.width / 2)) / scale;
    return px > 100 ? Math.round(px * 0.75) : null;
  }

  const FONT_RE =/(\d+(?:\.\d+)?)px\s+"docs-([^"]+)"/;
  // Every rendered text run, in document order, with its font and on-screen box.
  function runs() {
    return [...document.querySelectorAll(".kix-canvas-tile-text rect[aria-label]")].map((el) => {
      const m = (el.getAttribute("data-font-css") || "").match(FONT_RE);
      return {
        el,
        text: (el.getAttribute("aria-label") || "").replace(/[\u200b\u200c\u200d\ufeff]/g, ""),
        px: m ? parseFloat(m[1]) : 0,
        family: m ? m[2] : "",
        box: el.getBoundingClientRect(),
      };
    });
  }

  CB.docs = { frame, textbox, key, copySelection, selectionHasTable, paste, focus, sleep, afterRender, caretRect, selectToLineStart, collapseRight, toLineStart, runs, columnWidthPt };
})();
