// Черновик несохранённых ролей кластеров для модалки «Настройка фильтров». Живёт в
// localStorage, чтобы выбор пользователя НЕ сбрасывался при F5/переоткрытии: применяется
// на бэкенд только по кнопке «Сохранить», но сам выбор переживает обновление экрана.
// Ключ canonical-машинный — на пару (nmId, advertId), у каждой РК свой черновик.
// Очищается после успешного сохранения.

export type ClusterFilterRole = "auto" | "protected" | "blacklisted";

/** Карта normalizedClusterName → роль. Хранятся только отличия от серверного состояния. */
export type ClusterFilterDraft = Record<string, ClusterFilterRole>;

const ROLES: ReadonlySet<string> = new Set<ClusterFilterRole>(["auto", "protected", "blacklisted"]);

function draftStorageKey(nmId: number, advertId: number): string {
  return `wb-cluster-filter-draft:${nmId}:${advertId}`;
}

function isClusterFilterRole(value: unknown): value is ClusterFilterRole {
  return typeof value === "string" && ROLES.has(value);
}

export function readClusterFilterDraft(nmId: number, advertId: number): ClusterFilterDraft {
  try {
    const raw = window.localStorage.getItem(draftStorageKey(nmId, advertId));
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return {};
    const draft: ClusterFilterDraft = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (isClusterFilterRole(value)) draft[key] = value;
    }
    return draft;
  } catch {
    return {};
  }
}

export function writeClusterFilterDraft(
  nmId: number,
  advertId: number,
  draft: ClusterFilterDraft,
): void {
  try {
    const key = draftStorageKey(nmId, advertId);
    // Пустой черновик не держим — убираем ключ, чтобы хранилище не копило мусор.
    if (Object.keys(draft).length === 0) {
      window.localStorage.removeItem(key);
      return;
    }
    window.localStorage.setItem(key, JSON.stringify(draft));
  } catch {
    /* localStorage недоступен (приватный режим/квота) — черновик просто не переживёт F5 */
  }
}

export function clearClusterFilterDraft(nmId: number, advertId: number): void {
  try {
    window.localStorage.removeItem(draftStorageKey(nmId, advertId));
  } catch {
    /* нет доступа к localStorage — игнорируем */
  }
}
