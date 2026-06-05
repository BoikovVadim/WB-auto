// Generic-персистенция «черновика выбора» в localStorage по паре (nmId, advertId):
// карта string-ключей → значение-литерал. Нужна там, где выбор пользователя должен
// переживать F5/переоткрытие модалки, но применяться на бэкенд только по «Сохранить».
// Две модалки рекламы используют этот же механизм (фильтры кластеров и модерация
// новых кластеров) — общий код, чтобы не дублировать чтение/запись/валидацию.

export type KeyedDraft<V extends string> = Record<string, V>;

export type KeyedDraftStorage<V extends string> = {
  read: (nmId: number, advertId: number) => KeyedDraft<V>;
  write: (nmId: number, advertId: number, draft: KeyedDraft<V>) => void;
  clear: (nmId: number, advertId: number) => void;
};

export function createKeyedDraftStorage<V extends string>(opts: {
  /** Префикс ключа localStorage, например "wb-cluster-filter-draft". */
  namespace: string;
  /** Валидатор значения — отбрасывает чужие/устаревшие записи при чтении. */
  isValue: (value: unknown) => value is V;
}): KeyedDraftStorage<V> {
  const { namespace, isValue } = opts;
  const keyFor = (nmId: number, advertId: number) => `${namespace}:${nmId}:${advertId}`;

  return {
    read(nmId, advertId) {
      try {
        const raw = window.localStorage.getItem(keyFor(nmId, advertId));
        if (!raw) return {};
        const parsed: unknown = JSON.parse(raw);
        if (typeof parsed !== "object" || parsed === null) return {};
        const draft: KeyedDraft<V> = {};
        for (const [key, value] of Object.entries(parsed)) {
          if (isValue(value)) draft[key] = value;
        }
        return draft;
      } catch {
        return {};
      }
    },
    write(nmId, advertId, draft) {
      try {
        const key = keyFor(nmId, advertId);
        // Пустой черновик не держим — убираем ключ, чтобы хранилище не копило мусор.
        if (Object.keys(draft).length === 0) {
          window.localStorage.removeItem(key);
          return;
        }
        window.localStorage.setItem(key, JSON.stringify(draft));
      } catch {
        /* localStorage недоступен (приватный режим/квота) — черновик не переживёт F5 */
      }
    },
    clear(nmId, advertId) {
      try {
        window.localStorage.removeItem(keyFor(nmId, advertId));
      } catch {
        /* нет доступа к localStorage — игнорируем */
      }
    },
  };
}
