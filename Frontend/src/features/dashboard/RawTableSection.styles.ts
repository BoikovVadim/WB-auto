import type { CSSProperties } from "react";

// These objects carry ONLY non-dimensional properties that are not already
// covered by the global .wb-data-table CSS (font-size, padding, background,
// border-bottom, vertical-align are all handled there).
//
// Do NOT add font-size, padding, or background here — that breaks the
// table design-token contract.  See .cursor/rules/frontend-table-standards.mdc.

export const thStyle: CSSProperties = {
  // Cursor and selection are overridden per-column inline anyway; this acts
  // as a safe base for non-sortable headers.
  cursor: "default",
  userSelect: "none",
};

export const tdStyle: CSSProperties = {
  maxWidth: 220,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

export const mutedStyle: CSSProperties = {
  color: "var(--wb-text-muted, #666)",
};
