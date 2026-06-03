// Тонкий персистентный слой поверх sessionStorage для кэшей, которые должны переживать
// F5 в рамках вкладки (мгновенный рендер из кэша + фоновая ревалидация).
//
// Персистентный кэш РК когда-то отключали из-за несовместимости: после деплоя нового
// формата ответа старые данные из стораджа ломали рендер. Здесь это снято тремя мерами:
//   1) версия схемы в ключе — после бампа версии старые записи просто не читаются;
//   2) валидация формы значения при чтении — кривое/устаревшее игнорируется как cache-miss;
//   3) TTL — совсем протухшее не показываем.
// Плюс stale-while-revalidate на уровне хуков: значение из стораджа рисуется мгновенно,
// свежее тихо догружается с бэка и подменяется. sessionStorage живёт лишь до закрытия
// вкладки, поэтому риск показать устаревшее минимален.

// Бампать при ЛЮБОЙ несовместимой смене формата ответа workspace/cluster-table,
// чтобы старые персистентные данные после деплоя автоматически инвалидировались.
const CACHE_SCHEMA_VERSION = 1;

export interface SessionPersistedCache<T> {
  read(key: string): T | null;
  write(key: string, value: T): void;
  remove(key: string): void;
  removeByPrefix(keyPrefix: string): void;
}

interface Envelope {
  /** epoch ms записи — для TTL. */
  t: number;
  /** полезная нагрузка. */
  d: unknown;
}

/**
 * @param namespace короткий префикс хранилища (например "wbws").
 * @param ttlMs срок годности записи; старше — игнор.
 * @param validate проверка формы значения при чтении (защита от несовместимого формата).
 */
export function createSessionPersistedCache<T>(options: {
  namespace: string;
  ttlMs: number;
  validate: (value: unknown) => value is T;
}): SessionPersistedCache<T> {
  const { namespace, ttlMs, validate } = options;
  const prefix = `${namespace}:v${CACHE_SCHEMA_VERSION}:`;

  function storageKey(key: string): string {
    return `${prefix}${key}`;
  }

  function getStore(): Storage | null {
    try {
      return window.sessionStorage;
    } catch {
      // sessionStorage недоступен (приватный режим / SSR / отключён) — работаем без персиста.
      return null;
    }
  }

  function read(key: string): T | null {
    const store = getStore();
    if (!store) return null;
    let raw: string | null;
    try {
      raw = store.getItem(storageKey(key));
    } catch {
      return null;
    }
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as Envelope;
      if (!parsed || typeof parsed.t !== "number") {
        store.removeItem(storageKey(key));
        return null;
      }
      if (Date.now() - parsed.t > ttlMs) {
        store.removeItem(storageKey(key));
        return null;
      }
      if (!validate(parsed.d)) {
        // Формат не совпал (несовместимый/повреждённый) — выбрасываем как cache-miss.
        store.removeItem(storageKey(key));
        return null;
      }
      return parsed.d;
    } catch {
      // Битый JSON — чистим и считаем промахом.
      try {
        store.removeItem(storageKey(key));
      } catch {
        /* ignore */
      }
      return null;
    }
  }

  function evictNamespace(store: Storage): void {
    const toRemove: string[] = [];
    for (let i = 0; i < store.length; i += 1) {
      const k = store.key(i);
      if (k && k.startsWith(`${namespace}:`)) toRemove.push(k);
    }
    for (const k of toRemove) {
      try {
        store.removeItem(k);
      } catch {
        /* ignore */
      }
    }
  }

  function write(key: string, value: T): void {
    const store = getStore();
    if (!store) return;
    const envelope: Envelope = { t: Date.now(), d: value };
    let serialized: string;
    try {
      serialized = JSON.stringify(envelope);
    } catch {
      return;
    }
    try {
      store.setItem(storageKey(key), serialized);
    } catch {
      // Скорее всего QuotaExceeded — чистим свой namespace и пробуем один раз. Персист
      // не критичен (есть сеть), поэтому при повторной неудаче просто пропускаем.
      try {
        evictNamespace(store);
        store.setItem(storageKey(key), serialized);
      } catch {
        /* give up silently */
      }
    }
  }

  function remove(key: string): void {
    const store = getStore();
    if (!store) return;
    try {
      store.removeItem(storageKey(key));
    } catch {
      /* ignore */
    }
  }

  function removeByPrefix(keyPrefix: string): void {
    const store = getStore();
    if (!store) return;
    const fullPrefix = storageKey(keyPrefix);
    const toRemove: string[] = [];
    for (let i = 0; i < store.length; i += 1) {
      const k = store.key(i);
      if (k && k.startsWith(fullPrefix)) toRemove.push(k);
    }
    for (const k of toRemove) {
      try {
        store.removeItem(k);
      } catch {
        /* ignore */
      }
    }
  }

  return { read, write, remove, removeByPrefix };
}
