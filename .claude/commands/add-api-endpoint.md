Add a new typed API endpoint to the frontend API client layer.

Arguments: $ARGUMENTS
Expected format: `<functionName> <method> <backendPath> <ResponseTypeName> [params: field:type field:type]`
Examples:
  `fetchClusterStats GET /wb-clusters/stats ClusterStatsRow[]`
  `updateBidOverride POST /wb-clusters/bids/override BidOverrideResponse nmId:number bid:number`

`<functionName>` = camelCase function name exported from the API module.
`<method>` = GET | POST | DELETE | PATCH
`<ResponseTypeName>` = TypeScript type name for the response (may be an array, e.g. `FooRow[]`)
`params` = optional list of request params (query params for GET, body fields for POST/PATCH/DELETE)

---

## What to build

Every API function follows a strict 3-piece pattern: **type → validator → fetch function**. All three must be added together.

**Discovery first**: search `Frontend/src/api/` for existing functions that hit the same backend module (e.g. `wb-sync`, `wb-clusters`) to find the right file for each piece.

### Step 1 — Determine target files

- **Types**: `Frontend/src/api/syncClientAdvertisingWorkspaceTypes.ts` (advertising workspace), `syncClientAdvertisingSnapshotTypes.ts` (snapshots), or add to the inline types section in `syncClientCore.ts` for general sync/health endpoints.
- **Validators**: `syncClientAdvertisingWorkspaceValidatorGuards.ts`, `syncClientAdvertisingSnapshotValidatorGuards.ts`, or `syncClientValidators.ts`.
- **Fetch functions**: `syncClientCore.ts` (general), `syncClientAdvertisingRead.ts` (advertising reads), or `syncClientAdvertising.ts` (advertising mutations).

When unsure, follow the nearest similar function to find the right file.

### Step 2 — Response type

Add to the appropriate types file:
```ts
export interface <ResponseTypeName> {
  // fields matching backend response shape
  // use `| null` for optional numeric/string fields
}
```

If the response is an array (`FooRow[]`), define the row type; the function will return `Promise<FooRow[]>`.

### Step 3 — Validator / type guard

Add to the appropriate validator file:
```ts
export function is<ResponseTypeName>(value: unknown): value is <ResponseTypeName> {
  return (
    isRecord(value) &&
    // check each required field
    typeof value.someField === "number" &&
    isNullableNonEmptyString(value.someStringField)
    // ...
  );
}

// If the response is an array:
export function assert<ResponseTypeName>List(value: unknown): asserts value is <ResponseTypeName>[] {
  if (!Array.isArray(value) || !value.every(is<ResponseTypeName>)) {
    throw new Error("Invalid <ResponseTypeName> list response");
  }
}
```

Use helpers from `syncClientValidatorUtils.ts`: `isRecord`, `isNullableNumber`, `isNullableNonEmptyString`, `isNullableIsoDateString`, `isNonEmptyString`.

### Step 4 — Fetch function

Add to the appropriate API file:
```ts
// GET example:
export async function <functionName>(params?: { <paramName>?: <type> }) {
  const response = await apiClient.get<unknown>('<backendPath>', { params });
  assert<ResponseTypeName>List(response.data); // or assertXxx
  return response.data;
}

// POST example:
export async function <functionName>(body: { <field>: <type> }) {
  const response = await apiClient.post<unknown>('<backendPath>', body);
  assert<ResponseTypeName>(response.data);
  return response.data;
}
```

For advertising endpoints that may be slow, add a timeout:
```ts
const response = await apiClient.get<unknown>('<backendPath>', {
  params,
  timeout: advertisingApiTimeoutMs,
});
```

### Step 5 — Export (if needed)

If the type or function is needed in dashboard components, ensure it is re-exported from `Frontend/src/api/syncClient.ts` (check whether this barrel file is used for the relevant module).

### Step 6 — Verify

- Run `npm run typecheck` — no new errors.
- Check that the validator correctly rejects a `null` or `{}` input (mentally trace through the guard).
- If the backend route does not yet exist, note it explicitly so the backend step can be done separately.

---

## Rules that apply

- **Never use `as <Type>`** to cast API responses — always go through a validator/assert function. A cast without a guard is invisible tech debt.
- **Null safety**: backend fields that could be absent must be typed `| null` and guarded with `isNullableXxx`.
- **Do not duplicate types**: search existing files before defining a new type — the response shape may already exist.
- **Timeout on advertising routes**: all `/wb-clusters/advertising/**` endpoints must use `advertisingApiTimeoutMs`.
