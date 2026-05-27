Add a new numeric metric to the advertising cluster model end-to-end.

Arguments: $ARGUMENTS
Expected format: `<fieldName> "<RU label>" <type> [derivedFrom: formula]`
Examples:
  `cpo "CPO" number`
  `conversionRate "Конверсия" percent derivedFrom: orders/clicks`

`<fieldName>` = camelCase field name used in all TypeScript types.
`type` = `number` | `percent` | `currency` | `integer`
`derivedFrom` = optional formula hint (metric computed from other fields, not from backend directly)

---

## What to build

Adding a metric touches **7 places**. Work through them in order. Missing one will cause a type error or a silent display gap.

**Discovery first**: grep for a nearby existing metric (e.g. `ctr`, `cpo`, `spend`) across all files listed below to understand the exact pattern before writing any code.

### Step 1 — Backend type / response (if metric comes from backend)

If the metric comes from the backend (not computed in frontend):
- Check `backend/src/wb-clusters/` for the relevant snapshot/workspace service.
- Add the field to the backend response type and the DB query projection.
- Add the field to the NestJS DTO if one is used.

If it is a derived/computed metric (from existing fields), skip to Step 2.

### Step 2 — Workspace types

File: `Frontend/src/api/syncClientAdvertisingWorkspaceTypes.ts`

Add `<fieldName>: number | null` to:
- `ProductAdvertisingWorkspaceCampaignTotals` interface
- Any other interface that aggregates metrics (search for the pattern of a nearby metric)

### Step 3 — Snapshot types (if applies)

File: `Frontend/src/api/syncClientAdvertisingSnapshotTypes.ts`

If the metric is part of the product snapshot (check whether `spend`, `clicks` etc. appear there):
- Add `<fieldName>: number | null` to the relevant snapshot row interface.

### Step 4 — Validator guards

File: `Frontend/src/api/syncClientAdvertisingWorkspaceValidatorGuards.ts`

Find the `isProductAdvertisingWorkspaceCampaignTab` function (or whichever guard covers the type updated in Step 2). Add:
```ts
isNullableNumber(value.totals.<fieldName>) &&
```
in the position consistent with the field order in the type.

If you also updated snapshot types, update the corresponding guard in `syncClientAdvertisingSnapshotValidatorGuards.ts`.

### Step 5 — Frontend model types

File: `Frontend/src/features/dashboard/advertising/advertisingModelTypes.ts`

Add `<fieldName>: number | null` to `AdvertisingClusterRow` type in the correct logical group (stats, bid, action, etc.).

### Step 6 — Model computation (if derived metric)

File: `Frontend/src/features/dashboard/advertising/advertisingModelHelpers.ts`
or `advertisingModelMetrics.ts`

Add a pure function that computes the metric:
```ts
export function compute<FieldName>(row: AdvertisingClusterRow): number | null {
  // e.g. return row.orders && row.clicks ? row.orders / row.clicks : null;
}
```
Call it wherever the model row is assembled (search for where `AdvertisingClusterRow` objects are constructed).

### Step 7 — Table column

File: `Frontend/src/features/dashboard/advertising/advertisingClusterTableColumns.ts`

Add a column definition using the same pattern as `ctr`, `cpo`, or `spend` column nearby:
```ts
{
  key: "<fieldName>",
  label: "<RU label>",
  width: 70,
  render: (row) => row.<fieldName> != null ? <formatted value> : <span style={mutedStyle}>—</span>,
  sortValue: (row) => row.<fieldName>,
},
```

For `percent` type: multiply by 100 and append `%`.
For `currency` type: use `toLocaleString("ru-RU")` pattern from nearby columns.
For `integer` type: use `String(value)`.

### Step 8 — Column order

File: `Frontend/src/features/dashboard/advertising/advertisingClusterColumnOrder.ts`

Add `"<fieldName>"` to the default column order array in the logically correct position.

### Step 9 — Verify

- Run `npm run typecheck` — no new errors.
- Confirm the column appears in the advertising cluster table.
- Confirm totals row shows the metric (if it aggregates).

---

## Rules that apply

- New metrics must have a `null`-safe render path — never assume the value is non-null.
- Validator guards must be updated **together** with types — a missing guard check will cause a runtime validation failure.
- Do NOT add the column to `advertisingClusterTableColumns.ts` without adding it to the column order — it will never appear.
- Keep field names consistent across all 7 files — one typo creates a hard-to-find mismatch.
