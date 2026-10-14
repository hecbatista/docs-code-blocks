// Runs in the page's own JS world before Docs boots.
// Docs draws text on a <canvas>; when this global is non-empty at editor startup it also emits an
// invisible SVG layer (<g role="paragraph"><rect aria-label="…" data-font-css="…">) describing every
// rendered run of text and where it is. The rest of the extension reads that layer.
// Other extensions (e.g. Grammarly) set the same flag; any non-empty value works, so never clobber one.
if (!window._docs_annotate_canvas_by_ext) {
  window._docs_annotate_canvas_by_ext = "docs-code-blocks";
}
