Scaffold a new raw-table dashboard section end-to-end.

Arguments: $ARGUMENTS
Expected format: `<SectionName> <backendRoute> <RowTypeName> [col:label col:label ...]`
Example: `SyncRuns wb-sync/runs SyncRunRow runId:ID startedAt:Старт status:Статус`

---

## What to build

You are adding a new read-only section to the WB dashboard that shows rows from a backend table using the `RawTableSection` component. Follow every step in order — do not skip any file.

### Step 1 — Backend DTO / endpoint (if missing)

Check `backend/src/wb-sync/wb-sync.controller.ts` and `wb-sync.service.ts`.
If the route `GET /<backendRoute>` does not exist yet:
- Add a DTO in `backend/src/wb-sync/dto/` following the existing DTO files (class-validator decorators, optional query params typed with primitives).
- Add the service method in `wb-sync.service.ts` — only reads, no mutations.
- Add the controller method in `wb-sync.controller.ts` — `@Get('<backendRoute>')`, returns service result.
- Follow `backend-layering` rule: controller = transport only, service = logic, repository = SQL.

### Step 2 — API client function

File: `Frontend/src/api/syncClientCore.ts`

Add at the bottom:
```ts
export type <RowTypeName> = {
  // fields matching backend response rows
};

type <RowTypeName>Response = { rows: <RowTypeName>[] };

export async function fetch<SectionName>({ limit }: { limit?: number } = {}) {
  const response = await apiClient.get<unknown>('/<backendRoute>', { params: { limit } });
  // add a minimal runtime assert or trust the shape — keep it consistent with nearby fetch functions
  return (response.data as <RowTypeName>Response).rows;
}
```

Use the same pattern as `fetchRawDailyStats` immediately above or below for reference.

### Step 3 — Section component

Create `Frontend/src/features/dashboard/Dashboard<SectionName>Section.tsx`:

```tsx
import { useCallback } from "react";
import { fetch<SectionName>, type <RowTypeName> } from "../../api/syncClientCore";
import { RawTableSection, type ColumnDef } from "./RawTableSection";
import { mutedStyle } from "./RawTableSection.styles";

function num(v: number | null, d = 0) {
  if (v == null) return <span style={mutedStyle}>—</span>;
  return d > 0 ? v.toFixed(d) : String(v);
}

const columns: ColumnDef<<RowTypeName>>[] = [
  // one entry per col argument — use { fontFamily: "monospace" } for IDs/dates, num() for numbers
];

export function Dashboard<SectionName>Section({ onBack }: { onBack: () => void }) {
  const fetchData = useCallback(() => fetch<SectionName>({ limit: 2000 }), []);

  return (
    <RawTableSection
      title="<human readable title in Russian>"
      subtitle="{count} строк · <db_table_name>"
      onBack={onBack}
      fetchData={fetchData}
      columns={columns}
      getRowKey={(r) => r.<primaryKeyField>}
      filterRow={(r, q) =>
        // search across ID and text fields
        String(r.<primaryKeyField>).includes(q)
      }
    />
  );
}
```

### Step 4 — Register the section type

File: `Frontend/src/features/dashboard/persistence/dashboardViewStateTypes.ts`

Add the new section key to the `DashboardSection` union type. Use kebab-case matching the section name, e.g. `"sync-runs"`.

### Step 5 — Wire into the shell

File: `Frontend/src/features/dashboard/WbDashboardShell.tsx`

1. Add import: `import { Dashboard<SectionName>Section } from "./Dashboard<SectionName>Section";`
2. Add a menu button in the sidebar (copy the pattern of the nearest existing button — `wb-cabinet-menu-item`, with `activeSection === "<section-key>"` check).
3. Add a render branch in the ternary chain: `} : activeSection === "<section-key>" ? (`
   `  <Dashboard<SectionName>Section onBack={onSetExportsSection} />`

### Step 6 — Verify

- Run `npm run typecheck` (or `tsc --noEmit`) from the repo root — must pass with no new errors.
- Confirm the section name appears in the sidebar and clicking it renders the table.

---

## Rules that apply

- Table must use `RawTableSection` — do NOT inline a custom `<table>`.
- Do NOT hardcode `fontSize`, `padding` on `th`/`td` — use CSS variables per `frontend-table-standards` rule.
- The `DashboardSection` type change and `WbDashboardShell` change must happen together — they are coupled.
- Follow `core-architecture` rule: the new `GET` endpoint must return a stored snapshot or simple query result — no mutations, no heavy computations triggered by user read.
