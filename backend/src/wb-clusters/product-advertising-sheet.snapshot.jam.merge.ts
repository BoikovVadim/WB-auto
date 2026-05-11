import type {
  SearchQueryMetricValue,
  SearchQueryTextView,
} from "../wb-sync/wb-sync.types";

export function pickAdvertisingSheetGreaterNullableNumber(
  current: number | null,
  incoming: number | null,
) {
  if (current === null) {
    return incoming;
  }

  if (incoming === null) {
    return current;
  }

  return Math.max(current, incoming);
}

function mergeAdvertisingSheetMetricValue(
  current: SearchQueryMetricValue,
  incoming: SearchQueryMetricValue,
): SearchQueryMetricValue {
  return {
    current: pickAdvertisingSheetGreaterNullableNumber(current.current, incoming.current),
    dynamics: pickAdvertisingSheetGreaterNullableNumber(current.dynamics, incoming.dynamics),
  };
}

export function mergeAdvertisingSheetSearchTextItems(
  current: SearchQueryTextView,
  incoming: SearchQueryTextView,
): SearchQueryTextView {
  return {
    text: current.text.length >= incoming.text.length ? current.text : incoming.text,
    frequency: pickAdvertisingSheetGreaterNullableNumber(current.frequency, incoming.frequency),
    weekFrequency: pickAdvertisingSheetGreaterNullableNumber(
      current.weekFrequency,
      incoming.weekFrequency,
    ),
    wbCluster: current.wbCluster ?? incoming.wbCluster ?? null,
    avgPosition: mergeAdvertisingSheetMetricValue(current.avgPosition, incoming.avgPosition),
    orders: mergeAdvertisingSheetMetricValue(current.orders, incoming.orders),
    openCard: mergeAdvertisingSheetMetricValue(current.openCard, incoming.openCard),
    addToCart: mergeAdvertisingSheetMetricValue(current.addToCart, incoming.addToCart),
    openToCart: mergeAdvertisingSheetMetricValue(current.openToCart, incoming.openToCart),
  };
}

export function upsertAdvertisingSheetSearchTextItem(
  byNmId: Map<number, Map<string, SearchQueryTextView>>,
  nmId: number,
  item: SearchQueryTextView,
  normalizeAdvertisingText: (value: string) => string,
) {
  const key = normalizeAdvertisingText(item.text);
  const currentItems = byNmId.get(nmId) ?? new Map<string, SearchQueryTextView>();
  const existing = currentItems.get(key);

  currentItems.set(
    key,
    existing ? mergeAdvertisingSheetSearchTextItems(existing, item) : item,
  );
  byNmId.set(nmId, currentItems);
}
