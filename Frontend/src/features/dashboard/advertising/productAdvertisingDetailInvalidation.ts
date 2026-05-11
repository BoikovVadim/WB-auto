export type ProductAdvertisingDetailRevisions = {
  workspace: number;
  table: number;
  queries: number;
};

export type ProductAdvertisingDetailInvalidationTarget =
  | "workspace"
  | "table"
  | "queries"
  | "detail"
  | "all";

export const initialProductAdvertisingDetailRevisions: ProductAdvertisingDetailRevisions = {
  workspace: 0,
  table: 0,
  queries: 0,
};

export function invalidateProductAdvertisingDetailRevisions(
  currentValue: ProductAdvertisingDetailRevisions,
  target: ProductAdvertisingDetailInvalidationTarget,
): ProductAdvertisingDetailRevisions {
  if (target === "workspace") {
    return {
      ...currentValue,
      workspace: currentValue.workspace + 1,
    };
  }

  if (target === "table") {
    return {
      ...currentValue,
      table: currentValue.table + 1,
      queries: currentValue.queries + 1,
    };
  }

  if (target === "queries") {
    return {
      ...currentValue,
      queries: currentValue.queries + 1,
    };
  }

  if (target === "detail") {
    return {
      ...currentValue,
      workspace: currentValue.workspace + 1,
      table: currentValue.table + 1,
      queries: currentValue.queries + 1,
    };
  }

  return {
    workspace: currentValue.workspace + 1,
    table: currentValue.table + 1,
    queries: currentValue.queries + 1,
  };
}
