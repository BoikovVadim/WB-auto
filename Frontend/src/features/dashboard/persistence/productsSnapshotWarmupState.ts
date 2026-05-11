import type { ProductSnapshotReadinessItem } from "../../../api/syncClient";

type PersistedProductsWarmupState = {
  visibleQueued: boolean;
  backgroundQueued: boolean;
  candidateNmIds: number[];
  updatedAt: string | null;
};

const productsWarmupStorageKeyPrefix = "wb-dashboard-products-warmup:";
const productsReadinessStorageKeyPrefix = "wb-dashboard-products-readiness:";

export function buildProductsSnapshotStorageKey(input: {
  exportRequestId?: string;
  startDate: string;
  endDate: string;
}) {
  return `${input.startDate}:${input.endDate}`;
}

export function readPersistedProductsWarmupState(storageKey: string): PersistedProductsWarmupState {
  if (typeof window === "undefined") {
    return createDefaultWarmupState();
  }

  try {
    const rawValue = window.sessionStorage.getItem(`${productsWarmupStorageKeyPrefix}${storageKey}`);
    if (!rawValue) {
      return createDefaultWarmupState();
    }

    const parsedValue = JSON.parse(rawValue) as Partial<PersistedProductsWarmupState>;
    return {
      visibleQueued: parsedValue.visibleQueued === true,
      backgroundQueued: parsedValue.backgroundQueued === true,
      candidateNmIds: Array.isArray(parsedValue.candidateNmIds)
        ? parsedValue.candidateNmIds.filter((value): value is number => typeof value === "number")
        : [],
      updatedAt: typeof parsedValue.updatedAt === "string" ? parsedValue.updatedAt : null,
    };
  } catch {
    return createDefaultWarmupState();
  }
}

export function writePersistedProductsWarmupState(
  storageKey: string,
  patch: Partial<PersistedProductsWarmupState>,
) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    const currentValue = readPersistedProductsWarmupState(storageKey);
    const nextValue: PersistedProductsWarmupState = {
      ...currentValue,
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    window.sessionStorage.setItem(
      `${productsWarmupStorageKeyPrefix}${storageKey}`,
      JSON.stringify(nextValue),
    );
  } catch {
    return;
  }
}

export function readPersistedProductsReadiness(
  storageKey: string,
): Record<number, ProductSnapshotReadinessItem> {
  if (typeof window === "undefined") {
    return {};
  }

  try {
    const rawValue = window.sessionStorage.getItem(
      `${productsReadinessStorageKeyPrefix}${storageKey}`,
    );
    if (!rawValue) {
      return {};
    }

    const parsedValue = JSON.parse(rawValue) as unknown;
    if (!parsedValue || typeof parsedValue !== "object" || Array.isArray(parsedValue)) {
      return {};
    }

    return Object.values(parsedValue as Record<string, ProductSnapshotReadinessItem>).reduce<
      Record<number, ProductSnapshotReadinessItem>
    >((accumulator, item) => {
      if (typeof item?.nmId === "number") {
        accumulator[item.nmId] = item;
      }
      return accumulator;
    }, {});
  } catch {
    return {};
  }
}

export function writePersistedProductsReadiness(
  storageKey: string,
  items: ProductSnapshotReadinessItem[],
) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    const record = items.reduce<Record<string, ProductSnapshotReadinessItem>>((accumulator, item) => {
      accumulator[String(item.nmId)] = item;
      return accumulator;
    }, {});
    window.sessionStorage.setItem(
      `${productsReadinessStorageKeyPrefix}${storageKey}`,
      JSON.stringify(record),
    );
  } catch {
    return;
  }
}

function createDefaultWarmupState(): PersistedProductsWarmupState {
  return {
    visibleQueued: false,
    backgroundQueued: false,
    candidateNmIds: [],
    updatedAt: null,
  };
}
