import type { SearchQueryTextView } from "../wb-sync/wb-sync.types";

import type { ProductAdvertisingSheetResponse } from "./types/product-advertising-sheet.types";
import { pickAdvertisingSheetGreaterNullableNumber } from "./product-advertising-sheet.snapshot.jam.merge";

export interface AdvertisingSheetJamSearchTextLookupValue {
  frequency: number | null;
  openCard: number | null;
  addToCart: number | null;
  orders: number | null;
  avgPosition: number | null;
  openToCart: number | null;
}

export function buildAdvertisingSheetJamSearchTextLookup(
  searchTexts: SearchQueryTextView[],
  normalizeAdvertisingText: (value: string) => string,
) {
  const lookup = new Map<string, AdvertisingSheetJamSearchTextLookupValue>();

  for (const item of searchTexts) {
    const normalizedText = normalizeAdvertisingText(item.text);
    if (!normalizedText) {
      continue;
    }

    const current = {
      frequency: item.frequency,
      openCard: item.openCard.current,
      addToCart: item.addToCart.current,
      orders: item.orders.current,
      avgPosition: item.avgPosition.current,
      openToCart: item.openToCart.current,
    };
    const existing = lookup.get(normalizedText);
    if (!existing) {
      lookup.set(normalizedText, current);
      continue;
    }

    lookup.set(normalizedText, {
      frequency: pickAdvertisingSheetGreaterNullableNumber(existing.frequency, current.frequency),
      openCard: pickAdvertisingSheetGreaterNullableNumber(existing.openCard, current.openCard),
      addToCart: pickAdvertisingSheetGreaterNullableNumber(existing.addToCart, current.addToCart),
      orders: pickAdvertisingSheetGreaterNullableNumber(existing.orders, current.orders),
      avgPosition: pickAdvertisingSheetGreaterNullableNumber(
        existing.avgPosition,
        current.avgPosition,
      ),
      openToCart: pickAdvertisingSheetGreaterNullableNumber(
        existing.openToCart,
        current.openToCart,
      ),
    });
  }

  return lookup;
}

export function isAggregateSafeAdvertisingSheetClusterQuery(
  query: ProductAdvertisingSheetResponse["clusterQueries"][number],
  normalizeAdvertisingText: (value: string) => string,
) {
  if (query.querySource === "soft-match") {
    return false;
  }

  if (
    query.querySource === "cabinet-private-api" ||
    query.querySource === "stats" ||
    query.querySource === "cluster-name"
  ) {
    return true;
  }

  const clusterTokenStems = extractAdvertisingSheetTokenStems(
    normalizeAdvertisingText(query.clusterName),
  );
  if (clusterTokenStems.length <= 1) {
    const queryTokenStems = extractAdvertisingSheetTokenStems(
      normalizeAdvertisingText(query.queryText),
    );
    return queryTokenStems.length === 1 && queryTokenStems[0] === clusterTokenStems[0];
  }

  return true;
}

function extractAdvertisingSheetTokenStems(value: string) {
  return value
    .replace(/ё/g, "е")
    .split(/[^0-9a-zа-я]+/iu)
    .map((token) => token.trim())
    .filter((token) => token.length > 1 && !isAdvertisingSheetStopword(token))
    .map((token) => stemAdvertisingSheetToken(token));
}

function isAdvertisingSheetStopword(token: string) {
  return (
    token === "для" ||
    token === "без" ||
    token === "под" ||
    token === "над" ||
    token === "или" ||
    token === "the" ||
    token === "and" ||
    token === "with" ||
    token === "что" ||
    token === "это" ||
    token === "как" ||
    token === "из" ||
    token === "на" ||
    token === "по" ||
    token === "за" ||
    token === "от" ||
    token === "до" ||
    token === "в" ||
    token === "во" ||
    token === "к" ||
    token === "ко" ||
    token === "у" ||
    token === "с" ||
    token === "со" ||
    token === "и"
  );
}

function stemAdvertisingSheetToken(token: string) {
  if (token.length <= 4) {
    return token;
  }

  return token.replace(/[аеёиоуыэюяьй]+$/iu, "");
}
