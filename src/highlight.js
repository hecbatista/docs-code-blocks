// Language detection, highlighting, and conversion to the HTML that Docs accepts on paste.
/* global hljs */
var CB = globalThis.CB || (globalThis.CB = {});

(() => {
  // Languages offered in the picker and considered by auto-detect (hljs keys).
  const LANGS = [
    ["python", "Python"], ["java", "Java"], ["javascript", "JavaScript"], ["typescript", "TypeScript"],
    ["c", "C"], ["cpp", "C++"],
    ["asm", "Assembly (auto syntax)"], ["gas", "x86 assembly (AT&T / GNU as)"], ["x86asm", "x86 assembly (Intel / NASM)"],
    ["armasm", "ARM assembly"], ["mipsasm", "MIPS assembly"],
    ["csharp", "C#"], ["go", "Go"], ["rust", "Rust"], ["kotlin", "Kotlin"],
    ["swift", "Swift"], ["ruby", "Ruby"], ["php", "PHP"], ["r", "R"], ["matlab", "MATLAB"],
    ["scala", "Scala"], ["haskell", "Haskell"], ["scheme", "Scheme / Racket"], ["sql", "SQL"],
    ["bash", "Bash / Shell"], ["xml", "HTML / XML"], ["css", "CSS"], ["json", "JSON"], ["yaml", "YAML"],
    ["markdown", "Markdown"], ["plaintext", "Plain text"],
  ];
  const ASM = new Set(["asm", "gas", "x86asm", "armasm", "mipsasm"]);
  // Assembly is recognised by sniffAsm(); hljs relevance scoring is poor at it.
  const AUTO_SUBSET = LANGS.map(([k]) => k).filter((k) => k !== "plaintext" && k !== "markdown" && !ASM.has(k));

  // AT&T syntax (what `gcc -S` and GNU as use). hljs's x86asm only understands Intel/NASM syntax.
  hljs.registerLanguage("gas", (h) => ({
    name: "x86 (AT&T)",
    case_insensitive: true,
    contains: [
      h.COMMENT(/#|\/\//, /$/),
      h.C_BLOCK_COMMENT_MODE,
      h.QUOTE_STRING_MODE,
      { scope: "title.function", begin: /^\s*[A-Za-z_.$][\w.$]*:/ },
      { scope: "meta", begin: /^\s*\.[A-Za-z_]\w*/ },
      { scope: "keyword", begin: /^\s*[a-z][a-z0-9]{1,11}\b/ },
      { scope: "variable", begin: /%[a-z][a-z0-9]*/ },
      { scope: "number", begin: /\$-?(?:0x[0-9a-f]+|\d+)\b/ },
      { scope: "symbol", begin: /\$[A-Za-z_.][\w.]*/ },
      { scope: "number", begin: /-?\b(?:0x[0-9a-f]+|\d+)\b/ },
    ],
  }));
  hljs.registerAliases(["s", "att", "gnu-as", "gnuasm"], { languageName: "gas" });
  hljs.registerAliases(["nasm", "intel", "x86", "x86-64", "x64", "masm"], { languageName: "x86asm" });

  const X86_REG = /\b(?:[re]?[abcd]x|[abcd][lh]|[re]?(?:si|di|sp|bp|ip)|r(?:[89]|1[0-5])[dwb]?|[xyz]mm\d+)\b/i;
  // Pick a dialect from the code itself.
  function sniffAsm(code) {
    if (/\$(?:zero|at|v[01]|a[0-3]|t\d|s[0-7]|k[01]|gp|sp|fp|ra)\b/.test(code)) return "mipsasm";
    if (/%[re]?[a-z]{1,3}\d*\b/.test(code) || /^\s*(?:mov|add|sub|push|pop|lea|cmp)[bwlq]\s/im.test(code)) return "gas";
    if (/\b(?:r(?:[0-9]|1[0-5])|lr|pc)\b/i.test(code) && /#-?\d|\b(?:ldr|str|bl|bx|svc|swi|ldm|stm)\b/i.test(code)) return "armasm";
    return "x86asm";
  }
  const MNEMONIC = new RegExp(
    "^(?:mov\\w*|lea|add\\w*|sub\\w*|i?mul\\w*|i?div\\w*|inc|dec|and|or|xor|not|neg|sh[lr]|sa[lr]|ro[lr]|cmp|test|" +
      "j[a-z]{1,4}|call|ret|push|pop|nop|syscall|int|leave|enter|cqto|cltq|cdq|set[a-z]{1,3}|cmov[a-z]{1,3}|" +
      "li|la|lw|sw|lb|lbu|sb|lh|sh|lui|beqz?|bnez?|b[lg][te]z?|slti?u?|jal|jalr|jr|" +
      "ldr\\w*|str\\w*|ldm\\w*|stm\\w*|b|bl|bx|blx|svc|swi|adr)[bwlq]?$", "i");
  // Most lines are labels, directives or instructions, instructions start with real mnemonics, and
  // registers appear. That keeps shell scripts and prose from passing as assembly.
  function looksLikeAsm(code) {
    if (/[{};]\s*$/m.test(code)) return false; // C-like statement endings (a NASM comment is never empty)
    const lines = code.split("\n").map((l) => l.replace(/\s*(?:#(?!-?\d)|;|@|\/\/).*$/, "").trim()).filter(Boolean);
    let instr = 0, known = 0, other = 0;
    for (const l of lines) {
      const body = l.replace(/^[A-Za-z_.$][\w.$]*:\s*/, "");
      if (!body || body.startsWith(".")) continue; // label or directive
      const op = body.split(/\s+/)[0];
      if (/^[a-z][a-z0-9.]{0,11}$/i.test(op)) { instr++; if (MNEMONIC.test(op)) known++; } else other++;
    }
    const regs = X86_REG.test(code) || /%[a-z]{2,4}\b|\$(?:[atvs]\d|ra|sp|zero)\b|\b(?:r(?:[0-9]|1[0-5])|lr|pc)\b/i.test(code);
    return regs && instr > 0 && known / instr >= 0.6 && other <= lines.length * 0.2;
  }

  // hljs often calls plain C "cpp" (C is close to a subset), short C functions "java", and Java classes
  // "typescript". Telltale constructs settle C vs C++ vs Java.
  const C_FAMILY = new Set(["c", "cpp", "java", "csharp", "objectivec"]);
  const JAVA_LOOKALIKES = new Set(["typescript", "javascript", "csharp", "kotlin", "scala", "groovy"]);
  function telltale(code) {
    const cpp = /\b(?:class|namespace|template|typename|std::|cout|cin|nullptr|using\s+namespace|public:|private:|protected:)\b|::|#include\s*<(?:iostream|vector|string|map|memory|algorithm)>/.test(code);
    const java = /\b(?:public|private|protected)\s+(?:static\s+|final\s+|abstract\s+)*(?:class|interface|enum|void|int|boolean|String)\b|System\.out|import\s+java|String\[\]|@Override/.test(code);
    const c = /#include\s*<[\w/]+\.h>|\b(?:printf|scanf|malloc|calloc|realloc|free|sizeof|typedef|struct|NULL)\b|->|\bint\s+main\s*\(/.test(code);
    if (java && !c) return "java";
    if (cpp) return "cpp";
    return c ? "c" : null;
  }
  const looksLikeC = (code) => /\b(?:int|char|float|double|void|long|unsigned|size_t|bool)\b/.test(code) && /;\s*$/m.test(code);
  // `int total = 0;`, `char *s,` … typed declarations only occur in the C family (Java/C# included).
  const C_DECL = /(?:^|[(,;{]\s*)(?:const\s+)?(?:unsigned\s+|signed\s+)?(?:int|char|float|double|void|long|short|size_t|bool)\s+\**\s*\w+\s*[=;(),[]/m;
  function refine(lang, code) {
    const tt = telltale(code);
    if (!lang) return tt || (looksLikeC(code) ? "c" : "plaintext");
    if (C_FAMILY.has(lang)) return tt || (lang === "csharp" ? lang : "c");
    if (C_DECL.test(code)) return tt || "c";
    if (tt === "java" && JAVA_LOOKALIKES.has(lang)) return "java";
    return lang;
  }

  // GitHub-light palette keyed by hljs scope (first class, then the full "hljs-x sub_" form).
  const THEME = {
    keyword: { color: "#cf222e" }, doctag: { color: "#cf222e" }, "template-tag": { color: "#cf222e" },
    "template-variable": { color: "#cf222e" }, type: { color: "#cf222e" }, "variable.language_": { color: "#cf222e" },
    title: { color: "#8250df" }, "title.class_": { color: "#953800" }, "title.class_.inherited__": { color: "#953800" },
    "title.function_": { color: "#8250df" },
    attr: { color: "#0550ae" }, attribute: { color: "#0550ae" }, literal: { color: "#0550ae" }, meta: { color: "#0550ae" },
    number: { color: "#0550ae" }, operator: { color: "#0550ae" }, variable: { color: "#0550ae" },
    "selector-attr": { color: "#0550ae" }, "selector-class": { color: "#0550ae" }, "selector-id": { color: "#0550ae" },
    regexp: { color: "#0a3069" }, string: { color: "#0a3069" }, "meta.string": { color: "#0a3069" },
    built_in: { color: "#953800" }, symbol: { color: "#953800" }, bullet: { color: "#953800" },
    comment: { color: "#6e7781", italic: true }, code: { color: "#6e7781" }, formula: { color: "#6e7781" },
    name: { color: "#116329" }, quote: { color: "#116329" }, "selector-tag": { color: "#116329" },
    "selector-pseudo": { color: "#116329" }, section: { color: "#0550ae", bold: true },
    emphasis: { italic: true }, strong: { bold: true },
    addition: { color: "#116329" }, deletion: { color: "#82071e" },
  };

  const BASE = { color: "#1f2328" };
  const ENTITIES = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#x27;": "'", "&#39;": "'" };
  const decode = (s) => s.replace(/&(?:amp|lt|gt|quot|#x27|#39);/g, (m) => ENTITIES[m]);
  const escape = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  function styleFor(classAttr) {
    // "hljs-title function_" -> try "title.function_", then "title".
    const parts = classAttr.split(/\s+/).map((c) => c.replace(/^hljs-/, ""));
    return THEME[parts.join(".")] || THEME[parts[0]] || null;
  }

  // Turn hljs output into lines of { text, style } segments (styles merged down the span stack).
  function toLines(hljsHtml) {
    const lines = [[]];
    const stack = [BASE];
    const re = /<span class="([^"]+)">|<\/span>|([^<]+)/g;
    let m;
    while ((m = re.exec(hljsHtml))) {
      if (m[1] !== undefined) stack.push({ ...stack[stack.length - 1], ...(styleFor(m[1]) || {}) });
      else if (m[2] === undefined) stack.length > 1 && stack.pop();
      else {
        const pieces = decode(m[2]).split("\n");
        pieces.forEach((text, i) => {
          if (i > 0) lines.push([]);
          if (text) lines[lines.length - 1].push({ text, style: stack[stack.length - 1] });
        });
      }
    }
    return lines;
  }

  function normalize(code) {
    return code
      .replace(/\r\n?/g, "\n")
      .replace(/\t/g, "    ")
      .replace(/[\u200b\u200c\u200d\ufeff]/g, "")
      .replace(/\u00a0/g, " ")
      .replace(/[\u201c\u201d]/g, '"')
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/\s+$/, "");
  }

  function resolve(lang) {
    if (!lang) return null;
    if (/^(?:asm|assembly)$/i.test(lang)) return "asm"; // dialect chosen from the code at highlight time
    const l = hljs.getLanguage(lang.toLowerCase());
    if (!l) return null;
    // Map an alias (py, js, sh, racket…) back to a canonical key, preferring the picker's names.
    const hit = LANGS.find(([k]) => hljs.getLanguage(k) === l);
    return hit ? hit[0] : hljs.listLanguages().find((k) => hljs.getLanguage(k) === l) || null;
  }
  // hljs doesn't know Racket; its syntax is close enough to Scheme.
  hljs.registerAliases(["racket", "rkt"], { languageName: "scheme" });

  function detect(code) {
    const text = normalize(code);
    if (text.trim().length < 3) return "plaintext";
    if (looksLikeAsm(text)) return sniffAsm(text);
    const r = hljs.highlightAuto(text, AUTO_SUBSET);
    // Low relevance means hljs is guessing; unless telltales say otherwise, plain text is the honest answer.
    return refine(r.relevance >= 3 && r.language ? resolve(r.language) : null, text);
  }

  function highlight(code, lang) {
    const text = normalize(code);
    let key = resolve(lang) || "plaintext";
    if (key === "asm") key = sniffAsm(text);
    const html = key === "plaintext" ? escape(text) : hljs.highlight(text, { language: key, ignoreIllegals: true }).value;
    return { key, lines: toLines(html), text };
  }

  const css = (s) =>
    [s.color && `color:${s.color}`, s.bold && "font-weight:700", s.italic && "font-style:italic"].filter(Boolean).join(";");

  // Exact HTML that Docs turns into a 2-row table: a small language label row and the code row.
  // The overlay later finds blocks by these fonts/sizes, so keep FONT/LABEL_PT/CODE_PT in sync with overlay.js.
  const FONT = "Roboto Mono";
  const LABEL_PT = 8;
  const CODE_PT = 10;
  function toDocsHtml(code, lang, widthPt = null) {
    const { key, lines } = highlight(code, lang);
    const body = lines
      .map((segs) =>
        segs.map((s) => `<span style="${css(s.style)}">${escape(s.text).replace(/ /g, "&nbsp;")}</span>`).join("")
      )
      .join("<br>");
    const cell = `border:1px solid #d0d7de;font-family:${FONT},monospace;`;
    return {
      key,
      html:
        `<table style="border-collapse:collapse;width:${widthPt ? widthPt + "pt" : "100%"}">` +
        `<tr><td style="${cell}background:#eaeef2;padding:2pt 6pt;font-size:${LABEL_PT}pt;color:#57606a">${key === "plaintext" ? "text" : key}</td></tr>` +
        `<tr><td style="${cell}background:#f6f8fa;padding:6pt;font-size:${CODE_PT}pt;color:${BASE.color}">${body || "&nbsp;"}</td></tr>` +
        `</table>`,
    };
  }

  // Append highlighted spans for `code` into `parent` without innerHTML (Docs enforces Trusted Types).
  function renderInto(parent, code, lang) {
    parent.replaceChildren();
    const { lines } = highlight(code, lang);
    lines.forEach((segs, i) => {
      if (i > 0) parent.append("\n");
      for (const s of segs) {
        const span = document.createElement("span");
        span.textContent = s.text;
        if (s.style.color) span.style.color = s.style.color;
        if (s.style.bold) span.style.fontWeight = "700";
        if (s.style.italic) span.style.fontStyle = "italic";
        parent.append(span);
      }
    });
    // Keep trailing newlines visible so the overlay stays aligned with the textarea.
    const trailing = code.match(/\n*$/)[0].length;
    parent.append("\n".repeat(trailing) + " ");
  }

  const isAsm = (lang) => ASM.has(lang);

  CB.lang = { LANGS, detect, resolve, highlight, toDocsHtml, renderInto, normalize, isAsm, FONT, LABEL_PT, CODE_PT };
})();
