import type { ProductAdvertisingSheetRequestInput } from "../../../api/productAdvertisingSheetIdentity";
import type {
  ProductAdvertisingSheetResponse,
  ProductAdvertisingWorkspaceResponse,
} from "../../../api/syncClient";

export function matchesProductAdvertisingSheetRequest(
  value: ProductAdvertisingSheetResponse | null,
  nmId: number | null,
  requestInput: ProductAdvertisingSheetRequestInput | null,
) {
  return Boolean(
    value &&
      nmId !== null &&
      value.nmId === nmId &&
      requestInput &&
      value.range.startDate === requestInput.startDate &&
      value.range.endDate === requestInput.endDate,
  );
}

export function hasResolvedProductAdvertisingSheet(
  value: ProductAdvertisingSheetResponse | null,
  nmId: number | null,
) {
  return Boolean(value && nmId !== null && value.nmId === nmId);
}

export function resolveEffectiveProductAdvertisingRequestInput(input: {
  preferredRequestInput: ProductAdvertisingSheetRequestInput | null;
  workspace?: ProductAdvertisingWorkspaceResponse | null;
  sheet?: ProductAdvertisingSheetResponse | null;
}): ProductAdvertisingSheetRequestInput | null {
  // Явно выбранный пользователем диапазон имеет наивысший приоритет.
  // workspace.range / sheet.range используются только как запасной вариант,
  // когда preferredRequestInput не задан (dateRange не выбран).
  // Это гарантирует, что кластерная таблица всегда запрашивает данные
  // за выбранный период, а не за дефолтный диапазон воркспейса.
  if (input.preferredRequestInput?.startDate && input.preferredRequestInput.endDate) {
    return input.preferredRequestInput;
  }

  const workspaceRange = input.workspace?.range;
  if (workspaceRange?.startDate && workspaceRange.endDate) {
    return {
      startDate: workspaceRange.startDate,
      endDate: workspaceRange.endDate,
    };
  }

  const sheetRange = input.sheet?.range;
  if (sheetRange?.startDate && sheetRange.endDate) {
    return {
      startDate: sheetRange.startDate,
      endDate: sheetRange.endDate,
    };
  }

  return input.preferredRequestInput;
}
