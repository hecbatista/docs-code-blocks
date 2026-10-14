// Floating code editor. Code is typed here rather than into Docs so Docs' autocorrect (capitalisation,
// smart quotes, list detection) never touches it; the finished block is pasted in a single operation.
var CB = globalThis.CB || (globalThis.CB = {});

(() => {
  const INDENT = 4;
  const PAIRS = { "(": ")", "[": "]", "{": "}" };
  const CLOSERS = new Set(Object.values(PAIRS));
  const LABEL_LINE = /^\s*[A-Za-z_.$][\w.$]*:\s*$/;
  const isMac = /Mac/.test(navigator.platform);

  const STYLE = `
    :host { all: initial; }
    .backdrop { position: fixed; inset: 0; background: rgba(31,35,40,.28); z-index: 2147483000;
      display: flex; align-items: flex-start; justify-content: center; padding-top: 10vh; font: 13px/1.4 system-ui, sans-serif; }
    .panel { width: min(780px, 92vw); background: #fff; border-radius: 10px; box-shadow: 0 12px 40px rgba(0,0,0,.25);
      display: flex; flex-direction: column; overflow: hidden; color: #1f2328; }
    header, footer { display: flex; align-items: center; gap: 10px; padding: 8px 12px; background: #f6f8fa; }
    header { border-bottom: 1px solid #d0d7de; }
    footer { border-top: 1px solid #d0d7de; justify-content: space-between; }
    .title { font-weight: 600; }
    select { font: inherit; padding: 3px 6px; border: 1px solid #d0d7de; border-radius: 6px; background: #fff; }
    .detected { color: #57606a; }
    .ed { position: relative; max-height: 60vh; overflow: auto; background: #f6f8fa; }
    .ed pre, .ed textarea { margin: 0; border: 0; padding: 12px 14px; font: 13.5px/1.5 "Roboto Mono", ui-monospace, Menlo, monospace;
      white-space: pre; tab-size: 4; letter-spacing: 0; box-sizing: border-box; min-height: 12em; width: 100%; }
    .ed pre { pointer-events: none; color: #1f2328; }
    .ed textarea { position: absolute; inset: 0; height: 100%; resize: none; overflow: hidden; background: transparent;
      color: transparent; caret-color: #1f2328; outline: none; }
    .ed textarea::selection { background: rgba(84,174,255,.35); color: transparent; }
    .hint { color: #57606a; font-size: 12px; }
    kbd { font: 11px ui-monospace, monospace; border: 1px solid #d0d7de; border-bottom-width: 2px; border-radius: 4px; padding: 0 4px; background: #fff; }
    button { font: inherit; padding: 5px 12px; border-radius: 6px; border: 1px solid #d0d7de; background: #fff; cursor: pointer; }
    button.primary { background: #1f883d; border-color: #1f883d; color: #fff; font-weight: 600; }
    .actions { display: flex; gap: 8px; }`;

  function el(tag, props = {}, ...kids) {
    const e = Object.assign(document.createElement(tag), props);
    e.append(...kids);
    return e;
  }

  let current = null;

  function open({ code = "", lang = null, title = "Code block", submitLabel = "Insert", onSubmit, onCancel }) {
    if (current) current.close(false);

    const host = el("div");
    const root = host.attachShadow({ mode: "open" });
    const select = el("select", {}, el("option", { value: "auto", textContent: "Auto-detect" }),
      ...CB.lang.LANGS.map(([k, name]) => el("option", { value: k, textContent: name })));
    const detected = el("span", { className: "detected" });
    const pre = el("pre", { ariaHidden: "true" });
    const ta = el("textarea", { spellcheck: false, autocapitalize: "off", autocomplete: "off", wrap: "off" });
    ta.setAttribute("autocorrect", "off");
    const ed = el("div", { className: "ed" }, pre, ta);
    const cancelBtn = el("button", { textContent: "Cancel" });
    const submitBtn = el("button", { className: "primary", textContent: `${submitLabel}  ${isMac ? "⌘" : "Ctrl"}↵` });
    const hint = el("span", { className: "hint" },
      el("kbd", { textContent: "Tab" }), " indent  ", el("kbd", { textContent: "⇧Tab" }), " dedent  ",
      el("kbd", { textContent: "```" }), " on its own line to finish  ", el("kbd", { textContent: "Esc" }), " cancel");
    const backdrop = el("div", { className: "backdrop" },
      el("div", { className: "panel" },
        el("header", {}, el("span", { className: "title", textContent: title }), select, detected),
        ed,
        el("footer", {}, hint, el("div", { className: "actions" }, cancelBtn, submitBtn))));
    root.append(el("style", { textContent: STYLE }), backdrop);

    const resolved = CB.lang.resolve(lang);
    select.value = resolved || "auto";
    ta.value = code;

    // Auto-detect runs ~25 grammars (≈100 ms on a 4 KB block), so cache it and refresh it at most
    // every 350 ms while typing; highlighting itself is cheap and stays immediate.
    let detectedFor = null, detectedLang = "plaintext", detectTimer = 0;
    function detectNow() {
      clearTimeout(detectTimer);
      if (detectedFor !== ta.value) { detectedFor = ta.value; detectedLang = CB.lang.detect(ta.value); }
      return detectedLang;
    }
    const chosenLang = () => (select.value === "auto" ? detectedLang : select.value);
    let renderTimer = 0;
    function render() {
      clearTimeout(renderTimer);
      if (select.value === "auto" && detectedFor !== ta.value) {
        clearTimeout(detectTimer);
        detectTimer = setTimeout(() => { detectNow(); render(); }, detectedFor === null ? 0 : 350);
      }
      renderTimer = setTimeout(() => {
        const l = chosenLang();
        detected.textContent = select.value === "auto" && ta.value.trim() ? `→ ${CB.lang.LANGS.find(([k]) => k === l)?.[1] || l}` : "";
        CB.lang.renderInto(pre, ta.value, l);
        ta.style.height = pre.scrollHeight + "px";
        ta.style.width = pre.scrollWidth + "px";
      }, 30);
    }

    // Edit through execCommand so the browser's undo stack keeps working.
    function replace(start, end, text, caretStart = start + text.length, caretEnd = caretStart) {
      ta.focus();
      ta.setSelectionRange(start, end);
      if (!document.execCommand("insertText", false, text)) ta.setRangeText(text, start, end, "end");
      ta.setSelectionRange(caretStart, caretEnd);
      render();
    }

    const lineStartOf = (pos) => ta.value.lastIndexOf("\n", pos - 1) + 1;
    const lineEndOf = (pos) => { const i = ta.value.indexOf("\n", pos); return i < 0 ? ta.value.length : i; };
    const indentOf = (line) => line.match(/^ */)[0].length;

    function shiftLines(dir) {
      const { selectionStart: s, selectionEnd: e, value } = ta;
      const from = lineStartOf(s);
      const to = lineEndOf(e > s && value[e - 1] === "\n" ? e - 1 : e);
      const lines = value.slice(from, to).split("\n");
      let firstDelta = 0;
      const out = lines.map((line, i) => {
        if (dir > 0) { if (i === 0) firstDelta = INDENT; return " ".repeat(INDENT) + line; }
        const n = Math.min(INDENT, indentOf(line));
        if (i === 0) firstDelta = -n;
        return line.slice(n);
      });
      const text = out.join("\n");
      const multi = lines.length > 1;
      replace(from, to, text, multi ? from : Math.max(from, s + firstDelta), multi ? from + text.length : Math.max(from, s + firstDelta));
    }

    function onEnter() {
      const { selectionStart: s, selectionEnd: e, value } = ta;
      const ls = lineStartOf(s);
      const line = value.slice(ls, lineEndOf(s));
      if (line.trim() === "```") {
        // Closing fence, just like Markdown: drop it and finish.
        replace(ls, lineEndOf(s) + (value[lineEndOf(s)] === "\n" ? 1 : 0), "");
        return submit();
      }
      const before = value.slice(ls, s);
      const trimmed = before.trimEnd();
      let indent = indentOf(before);
      const lang = chosenLang();
      if (CB.lang.isAsm(lang)) {
        // Instructions sit one level in from their label; otherwise the indent just carries over.
        if (LABEL_LINE.test(before)) indent = INDENT;
      } else if (/[:{[(]$/.test(trimmed) || /=>$/.test(trimmed)) indent += INDENT;
      else if (lang === "python" && /^\s*(return|pass|break|continue|raise)\b/.test(before)) indent = Math.max(0, indent - INDENT);
      const next = value[e];
      if (CLOSERS.has(next) && PAIRS[trimmed.slice(-1)] === next) {
        const inner = "\n" + " ".repeat(indent);
        const outer = "\n" + " ".repeat(Math.max(0, indent - INDENT));
        return replace(s, e, inner + outer, s + inner.length);
      }
      replace(s, e, "\n" + " ".repeat(indent));
    }

    function onKeyDown(ev) {
      const { selectionStart: s, selectionEnd: e, value } = ta;
      const mod = isMac ? ev.metaKey : ev.ctrlKey;
      if (ev.key === "Escape") { ev.preventDefault(); return close(false); }
      if (ev.key === "Enter" && mod) { ev.preventDefault(); return submit(); }
      if (ev.key === "Enter" && !ev.shiftKey && !ev.altKey) { ev.preventDefault(); return onEnter(); }
      if (ev.key === "Tab") {
        ev.preventDefault();
        if (ev.shiftKey) return shiftLines(-1);
        if (value.slice(s, e).includes("\n")) return shiftLines(1);
        const col = s - lineStartOf(s);
        return replace(s, e, " ".repeat(INDENT - (col % INDENT)));
      }
      if (ev.key === "Backspace" && s === e && s > 0) {
        const before = value.slice(lineStartOf(s), s);
        if (before.length && /^ +$/.test(before)) {
          ev.preventDefault();
          const n = before.length % INDENT || INDENT;
          return replace(s - n, s, "");
        }
        if (PAIRS[value[s - 1]] && PAIRS[value[s - 1]] === value[s]) { ev.preventDefault(); return replace(s - 1, s + 1, ""); }
      }
      if (ev.key.length === 1 && !ev.metaKey && !ev.ctrlKey) {
        if (ev.key === ":" && s === e && lineEndOf(s) === s && CB.lang.isAsm(chosenLang())) {
          // Finishing `label:` on an indented line snaps the label back to column 0.
          const ls = lineStartOf(s);
          const head = value.slice(ls, s);
          if (/^ +[A-Za-z_.$][\w.$]*$/.test(head)) { ev.preventDefault(); return replace(ls, s, head.trimStart() + ":"); }
        }
        if (CLOSERS.has(ev.key) && s === e && value[s] === ev.key) { ev.preventDefault(); return ta.setSelectionRange(s + 1, s + 1); }
        if (CLOSERS.has(ev.key) && /^ +$/.test(value.slice(lineStartOf(s), s))) {
          // Typing "}" on an otherwise blank line dedents it.
          ev.preventDefault();
          const ls = lineStartOf(s);
          const n = Math.min(INDENT, s - ls);
          return replace(s - n, e, ev.key);
        }
        if (PAIRS[ev.key] && (s !== e || !value[s] || /[\s)\]},;]/.test(value[s]))) {
          ev.preventDefault();
          const sel = value.slice(s, e);
          return replace(s, e, ev.key + sel + PAIRS[ev.key], s + 1, s + 1 + sel.length);
        }
      }
    }

    function onInput() {
      if (ta.value.includes("\t")) {
        const s = ta.selectionStart;
        const before = ta.value.slice(0, s).replace(/\t/g, " ".repeat(INDENT));
        ta.value = ta.value.replace(/\t/g, " ".repeat(INDENT));
        ta.setSelectionRange(before.length, before.length);
      }
      render();
    }

    let closed = false;
    function close(submitted) {
      if (closed) return;
      closed = true;
      host.remove();
      current = null;
      if (!submitted) onCancel?.();
    }
    function submit() {
      const code = CB.lang.normalize(ta.value);
      const lang = select.value === "auto" ? detectNow() : select.value;
      close(true);
      onSubmit?.(code, lang);
    }

    ta.addEventListener("keydown", onKeyDown);
    ta.addEventListener("input", onInput);
    ta.addEventListener("scroll", () => { ed.scrollTop = ta.scrollTop; ed.scrollLeft = ta.scrollLeft; });
    select.addEventListener("change", () => { render(); ta.focus(); });
    cancelBtn.addEventListener("click", () => close(false));
    submitBtn.addEventListener("click", submit);
    backdrop.addEventListener("mousedown", (ev) => { if (ev.target === backdrop) { ev.preventDefault(); ta.focus(); } });
    // Keep Docs' own shortcut handlers from seeing keys typed into the editor.
    for (const t of ["keydown", "keypress", "keyup", "copy", "cut", "paste", "input"]) host.addEventListener(t, (ev) => ev.stopPropagation());

    document.documentElement.append(host);
    render();
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
    current = { close };
    return current;
  }

  CB.editor = { open, isOpen: () => !!current };
})();
