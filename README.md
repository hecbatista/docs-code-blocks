# Docs Code Blocks

Markdown-style code blocks for Google Docs, built for taking notes in class.

- Type ` ``` ` (or ` ```python `, ` ```js `, ` ```java `…) on its own line and press **Enter**. A code editor pops up.
- Type your code with real auto-indent, **Tab** / **Shift+Tab**, bracket pairing and live syntax highlighting.
- Finish with ` ``` ` on its own line, **⌘/Ctrl+Enter**, or the Insert button. **Esc** cancels and keeps what you typed.
- The block lands in the doc as a highlighted, monospace box with a language label.
- Hover controls on every block: **Copy** puts the code on your clipboard, and **Edit** reopens it in the editor. Click inside the block first, then press Edit.
- **Ctrl+Shift+K**: turns selected text into a code block. If the cursor is inside a block, it edits that block.
- Language auto-detect (highlight.js plus extra checks for C/C++/Java and assembly) when you don't name one. You can override it in the editor's dropdown.

### Languages

Python, Java, C, C++, C#, JavaScript, TypeScript, Go, Rust, Kotlin, Swift, Ruby, PHP, R, MATLAB, Scala, Haskell, Scheme/Racket, SQL, Bash, HTML/XML, CSS, JSON, YAML, Markdown, plus assembly:

| Fence | Highlighting |
| --- | --- |
| ` ```asm ` / ` ```assembly ` | Dialect picked from the code (AT&T, Intel, ARM or MIPS) |
| ` ```s ` / ` ```gas ` / ` ```att ` | x86 AT&T syntax, what `gcc -S` and GNU `as` use (`movq %rsp, %rbp`) |
| ` ```nasm ` / ` ```x86 ` / ` ```intel ` | x86 Intel / NASM syntax (`mov rbp, rsp`) |
| ` ```arm ` | ARM |
| ` ```mips ` | MIPS (`li $v0, 4`) |

In assembly the editor indents instructions under their label, and finishing a `label:` snaps it back to column 0. There's no RISC-V grammar in highlight.js yet, so RISC-V code gets plain monospace.

## Install

1. Download `docs-code-blocks-<version>.zip` from the [latest release](https://github.com/hecbatista/docs-code-blocks/releases/latest) and unzip it, or clone this repo.
2. Open `chrome://extensions` and turn on **Developer mode** (top right).
3. Click **Load unpacked** and pick the unzipped folder.
4. Pin the extension from the puzzle-piece menu if you want its help pop-up. Reload any open Google Docs tabs.

Keep the folder where it is, because Chrome loads the extension from it. After changing the code, click the reload icon on the extension's card.

Chrome blocks `.crx` files from outside the Chrome Web Store, so sharing works through this repo or a zip of it. To install with one click and get automatic updates, download the zip from the [latest release](https://github.com/hecbatista/docs-code-blocks/releases/latest) and upload it to the [Chrome Web Store developer dashboard](https://chrome.google.com/webstore/devconsole) as an **Unlisted** item. That needs a developer account, which costs a one-time $5, and Google reviews the item before it goes live.

## How it works

Findings from reverse engineering the Docs web client with REA, then checking them in a live document:

| What | Finding |
| --- | --- |
| Rendering | Text is painted on `canvas.kix-canvas-tile-content`, so DOM injection inside the document isn't possible. |
| Text layer | If `window._docs_annotate_canvas_by_ext` is non-empty when the editor starts, Docs also emits invisible `<rect aria-label="…" data-font-css="…">` runs with real geometry (the `dVf()`/`cVf()` gate in `kix_core`). Any value works. Grammarly uses the same switch. |
| Input | Keystrokes go to a hidden same-origin `iframe.docs-texteventtarget-iframe` with a contenteditable textbox. Docs accepts synthetic `keydown`/`copy`/`paste` events there: copy fills the event's `DataTransfer` with the selection, and paste accepts HTML tables, fonts and colors. It ignores synthetic mouse events. |
| Native code blocks | Docs has its own code block, with a copy button and 20 languages. It's gated behind the `docs-scfap` flag, which is `false` on this account, so the extension builds its own. |
| Restrictions | Docs enforces Trusted Types (no `innerHTML`). Back-to-back synthetic pastes get dropped. Autocorrect rewrites typed code, which is why code is typed in the extension's editor and pasted in a single operation. |

A block is a 2-row table: an 8pt Roboto Mono label row and a 10pt Roboto Mono code row. The overlay finds blocks by those fonts in the text layer.

## Known limitations

- **Copy** rebuilds the text from glyph positions. A line long enough that Docs wraps it comes back as two lines. **Edit** always reads the exact text.
- Edit has to select the table with the keyboard, so the cursor must be inside the block first. That's because Docs ignores synthetic clicks.
- Edit only replaces a block after confirming the selection is exactly that block. If it can't confirm, it changes nothing, and if Docs loses the selection while you're editing, your edited code goes to the clipboard. Docs can hang when a paste lands on a selection containing several tables, so the extension never does that.
- It depends on Google Docs internals (class names, the annotate flag, paste handling). A Docs update can break it. If it does, the next step is re-running the REA analysis against the new client bundle.
- Docs keeps an empty line above each inserted table.

## License

MIT, see [LICENSE](LICENSE). Bundled [highlight.js](https://highlightjs.org/) (in `vendor/`) is BSD-3-Clause; see [vendor/LICENSE](vendor/LICENSE).

Not affiliated with or endorsed by Google. It relies on undocumented Google Docs behavior that can change at any time.
