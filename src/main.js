// Wires keyboard triggers in the Docs editor to the code editor and block insertion.
//   ``` or ```lang + Enter    open the editor (Markdown-style fence)
//   Ctrl+Shift+K              selection -> code block; inside a block -> edit it
var CB = globalThis.CB || (globalThis.CB = {});

(() => {
  const D = CB.docs;
  const FENCE = /^\s*```\s*([\w+#.-]*)\s*$/;
  const isMac = /Mac/.test(navigator.platform);

  // Paste a finished block over `expectedSelection` (the fence text or the user's selection) if Docs
  // still has it selected. Otherwise a new block goes in at the caret, but an edit (`strict`) is never
  // pasted somewhere else: the edited code goes to the clipboard instead, so nothing is overwritten.
  // `width` is the text column measured when the block was triggered (the ruler moves once text is selected).
  async function insert(code, lang, { selected: expectedSelection = "", resetAfter = false, width = null, strict = false } = {}) {
    D.focus();
    await D.sleep(30);
    if (expectedSelection && D.copySelection() !== expectedSelection) {
      if (strict) {
        await CB.overlay.writeClipboard(code);
        CB.overlay.toast("Docs lost the block's selection, so nothing was changed. Your edited code is on the clipboard.", 6000);
        return;
      }
      CB.overlay.toast("Selection changed — inserted the block at the cursor instead.");
      D.collapseRight();
    }
    // Only an edit may paste over a table, and only over the single block it verified.
    if (!strict && D.selectionHasTable()) D.collapseRight();
    const { html } = CB.lang.toDocsHtml(code, lang, width);
    D.paste(code, html);
    await D.afterRender();
    // Pasting over a selected table leaves the new one selected; put the caret after it instead.
    if (D.copySelection()) D.collapseRight();
    // The paragraph Docs leaves after a pasted table inherits the code font; reset it to normal text.
    if (resetAfter) D.key("\\", isMac ? { metaKey: true } : { ctrlKey: true });
    CB.overlay.refresh();
  }

  function cancel(selected) {
    D.focus();
    if (selected) D.collapseRight();
  }

  function openForInsert({ code = "", lang = null, selected = "", fromFence = false, width = D.columnWidthPt() }) {
    CB.editor.open({
      code,
      lang,
      onSubmit: (c, l) => insert(c, l, { selected, resetAfter: fromFence, width }),
      onCancel: () => {
        cancel(selected);
        if (fromFence) typed = "```"; // pressing Enter on the fence again reopens the editor
      },
    });
  }

  function caretIn(block) {
    const c = D.caretRect();
    return c && c.top >= block.top - 3 && c.top <= block.bottom + 1;
  }

  const squash = (s) => CB.lang.normalize(s).replace(/\s+/g, "");

  // Select a whole block from the keyboard (synthetic clicks are ignored by Docs). Selecting a table
  // from below makes Docs push the anchor one character into the next paragraph, so select top-down:
  // from the label row, Shift+Down until the selection leaves the table (Docs widens it to the whole
  // table), then Shift+Home pulls the moving end back to the start of the following paragraph.
  // Every walk is capped at the block's own height, and the result must contain exactly the block's
  // text; anything else is abandoned, because pasting over a wrong selection would delete notes.
  async function selectBlock(block) {
    const sig = (b) => [b.lang, b.code.length, ...b.code.slice(0, 4).map((r) => r.text)].join("|");
    const mySig = sig(block);
    let lastTop = block.top;
    // Docs scrolls as the caret moves and may re-create the text layer, so re-find the block each step.
    const current = () => {
      const blocks = CB.overlay.findBlocks();
      const hit = blocks.find((b) => b.label.el === block.label.el) ||
        blocks.filter((b) => sig(b) === mySig).sort((a, b) => Math.abs(a.top - lastTop) - Math.abs(b.top - lastTop))[0];
      if (hit) lastTop = hit.top;
      return hit;
    };
    const maxSteps = CB.overlay.blockText(block).split("\n").length + 4; // label row + code rows + slack
    const caretTop = () => D.caretRect()?.top ?? NaN;
    async function moveUntil(done, k, mods) {
      for (let i = 0; i <= maxSteps; i++) {
        const b = current();
        if (!b) return false;
        if (done(b)) return true;
        D.key(k, mods);
        await D.sleep(30);
      }
      return false;
    }
    D.focus();
    // Below the table the ruler shows the real text column; measure it there.
    if (!(await moveUntil((b) => caretTop() > b.bottom + 1, "ArrowDown"))) return null;
    await D.sleep(60);
    const width = D.columnWidthPt();
    if (!(await moveUntil((b) => caretTop() <= b.label.box.top + 2, "ArrowUp"))) return null;
    if (!(await moveUntil((b) => caretTop() > b.bottom + 1, "ArrowDown", { shiftKey: true }))) {
      D.collapseRight();
      return null;
    }
    D.key("Home", { shiftKey: true });
    await D.sleep(60);
    const sel = D.copySelection();
    const b = current() || block;
    if (sel.startsWith(b.lang + "\n") && sel.endsWith("\n") && squash(sel.slice(b.lang.length + 1)) === squash(CB.overlay.blockText(b))) {
      return { sel, width };
    }
    D.collapseRight();
    return null;
  }

  let editing = false;
  async function editBlock(block) {
    if (editing || CB.editor.isOpen()) return;
    if (!caretIn(block)) {
      CB.overlay.toast("Click inside the code block first, then press Edit (or Ctrl+Shift+K).");
      return;
    }
    editing = true;
    try {
      const picked = await selectBlock(block);
      if (!picked) {
        CB.overlay.toast("Couldn't select that block safely, so nothing was changed. Click on its last line and try Edit again.", 5000);
        return;
      }
      const { sel, width } = picked;
      CB.editor.open({
        code: sel.slice(block.lang.length + 1).replace(/\n+$/, ""),
        lang: block.lang === "text" ? "plaintext" : block.lang,
        title: "Edit code block",
        submitLabel: "Update",
        onSubmit: (c, l) => insert(c, l, { selected: sel, width, strict: true }),
        onCancel: () => cancel(sel),
      });
    } finally {
      editing = false;
    }
  }

  function blockAtCaret() {
    return CB.overlay.findBlocks().find(caretIn) || null;
  }

  // ---- keyboard hooks inside Docs' text-event iframe ----
  let typed = ""; // characters typed on the current line since the caret last jumped

  function onKeyDown(e) {
    if (!e.isTrusted || CB.editor.isOpen()) return;

    if (e.ctrlKey && e.shiftKey && !e.metaKey && !e.altKey && e.code === "KeyK") {
      e.preventDefault();
      e.stopImmediatePropagation();
      const block = blockAtCaret();
      if (block) return editBlock(block);
      if (D.selectionHasTable()) {
        CB.overlay.toast("The selection includes a table or code block. Select only the text you want to turn into code.", 5000);
        return;
      }
      const width = D.columnWidthPt();
      const selected = D.copySelection();
      return openForInsert({ code: selected, selected, width });
    }

    if (e.key === "Enter" && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey && /(`|Dead)[\w+#.-]*$/.test(typed)) {
      typed = "";
      const width = D.columnWidthPt();
      const line = D.selectToLineStart();
      const m = line.match(FENCE);
      if (!m) {
        if (line) D.collapseRight();
        return; // ordinary Enter
      }
      e.preventDefault();
      e.stopImmediatePropagation();
      // The fence text stays selected so the block replaces it.
      return openForInsert({ lang: m[1] || null, selected: line, fromFence: true, width });
    }

    if (e.key === "Backspace") typed = typed.slice(0, -1);
    else if (e.key === "Dead" || (e.key.length === 1 && !e.metaKey && !e.ctrlKey)) typed = (typed + (e.key === "Dead" ? "`" : e.key)).slice(-40);
    else if (!["Shift", "Alt", "Meta", "Control", "CapsLock"].includes(e.key)) typed = "";
  }

  const hooked = new WeakSet();
  function hook() {
    const win = D.frame()?.contentWindow;
    if (win && !hooked.has(win)) {
      hooked.add(win);
      // Window-level capture runs before any of Docs' handlers inside the iframe.
      win.addEventListener("keydown", onKeyDown, true);
      win.addEventListener("mousedown", () => (typed = ""), true);
    }
  }

  CB.main = { editBlock, openForInsert };

  document.addEventListener("mousedown", () => (typed = ""), true);
  hook();
  setInterval(hook, 1500); // Docs occasionally recreates the iframe
  CB.overlay.start();
})();
