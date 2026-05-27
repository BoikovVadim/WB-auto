function workspaceScrollKey(nmId: number | null) {
  return `wb-scroll:workspace-${nmId ?? "unknown"}`;
}

export function saveWorkspaceScroll(nmId: number | null, top: number) {
  try {
    sessionStorage.setItem(workspaceScrollKey(nmId), String(Math.round(top)));
  } catch {
    // ignore
  }
}

export function loadWorkspaceScroll(nmId: number | null): number {
  try {
    const raw = sessionStorage.getItem(workspaceScrollKey(nmId));
    if (!raw) return 0;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
  } catch {
    return 0;
  }
}

export function clearWorkspaceScrollForProduct(nmId: number | null) {
  try {
    sessionStorage.removeItem(workspaceScrollKey(nmId));
  } catch {
    // ignore
  }
}
