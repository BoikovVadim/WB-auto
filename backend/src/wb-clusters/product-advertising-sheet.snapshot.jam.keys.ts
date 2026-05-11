export function buildAdvertisingSheetJamGroupKey(
  advertId: number,
  clusterName: string,
  normalizeAdvertisingText: (value: string) => string,
) {
  return `${String(advertId)}:${normalizeAdvertisingText(clusterName)}`;
}

export function buildAdvertisingSheetJamQueryKey(
  advertId: number,
  clusterName: string,
  queryText: string,
  normalizeAdvertisingText: (value: string) => string,
) {
  return `${buildAdvertisingSheetJamGroupKey(advertId, clusterName, normalizeAdvertisingText)}:${normalizeAdvertisingText(queryText)}`;
}
