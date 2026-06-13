// The tool ids handled by PdfToolView, in their own tiny module so ToolView can
// route to PdfToolView without statically importing it — PdfToolView pulls in
// pdf.js and is code-split (lazy-loaded) to keep the initial bundle small.
// Keep this list in sync with PDF_TOOL_CONFIG in PdfToolView.tsx.
export const PDF_TOOL_IDS = [
  'merge-pdf',
  'extract-pages',
  'delete-pages',
  'reorder-pages',
  'rotate-pages',
  'encrypt-decrypt-pdf',
] as const
