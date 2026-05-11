import { describe, expect, it } from "vitest";

import type { ProductAdvertisingSheetResponse, ProductAdvertisingWorkspaceResponse } from "../../../api/syncClient";
import {
  matchesProductAdvertisingSheetRequest,
  resolveEffectiveProductAdvertisingRequestInput,
} from "./productAdvertisingResolvedRange";

function createSheet(range: { startDate: string; endDate: string }) {
  return {
    nmId: 107,
    range: {
      startDate: range.startDate,
      endDate: range.endDate,
      jamIncluded: true,
      jamStatus: "ready",
    },
  } as ProductAdvertisingSheetResponse;
}

function createWorkspace(range: { startDate: string; endDate: string }) {
  return {
    nmId: 107,
    range: {
      startDate: range.startDate,
      endDate: range.endDate,
      jamIncluded: true,
      jamStatus: "ready",
    },
  } as ProductAdvertisingWorkspaceResponse;
}

describe("productAdvertisingResolvedRange", () => {
  it("matches only exact requested ranges", () => {
    expect(
      matchesProductAdvertisingSheetRequest(
        createSheet({ startDate: "2026-05-01", endDate: "2026-05-07" }),
        107,
        {
          startDate: "2026-05-01",
          endDate: "2026-05-07",
        },
      ),
    ).toBe(true);

    expect(
      matchesProductAdvertisingSheetRequest(
        createSheet({ startDate: "2026-04-01", endDate: "2026-04-30" }),
        107,
        {
          startDate: "2026-05-01",
          endDate: "2026-05-07",
        },
      ),
    ).toBe(false);
  });

  it("preserves export identity for exact ranges", () => {
    expect(
      resolveEffectiveProductAdvertisingRequestInput({
        preferredRequestInput: {
          startDate: "2026-05-01",
          endDate: "2026-05-07",
          exportRequestId: "export-123",
        },
        sheet: createSheet({ startDate: "2026-05-01", endDate: "2026-05-07" }),
      }),
    ).toEqual({
      startDate: "2026-05-01",
      endDate: "2026-05-07",
      exportRequestId: "export-123",
    });
  });

  it("uses preferred range when it is explicitly set (preferred wins over sheet)", () => {
    // Пользователь явно выбрал диапазон — он должен иметь приоритет над sheet.
    expect(
      resolveEffectiveProductAdvertisingRequestInput({
        preferredRequestInput: {
          startDate: "2026-05-08",
          endDate: "2026-05-08",
          exportRequestId: "export-today",
        },
        sheet: createSheet({ startDate: "2026-04-01", endDate: "2026-04-30" }),
      }),
    ).toEqual({
      startDate: "2026-05-08",
      endDate: "2026-05-08",
      exportRequestId: "export-today",
    });
  });

  it("uses preferred range when it is explicitly set (preferred wins over workspace)", () => {
    // Пользователь явно выбрал диапазон — он должен иметь приоритет над workspace.
    expect(
      resolveEffectiveProductAdvertisingRequestInput({
        preferredRequestInput: {
          startDate: "2026-05-08",
          endDate: "2026-05-08",
        },
        workspace: createWorkspace({ startDate: "2026-03-01", endDate: "2026-03-31" }),
        sheet: createSheet({ startDate: "2026-04-01", endDate: "2026-04-30" }),
      }),
    ).toEqual({
      startDate: "2026-05-08",
      endDate: "2026-05-08",
      exportRequestId: undefined,
    });
  });

  it("falls back to workspace range when no preferred range is given", () => {
    // Если пользователь не выбрал диапазон, используем диапазон workspace-а.
    expect(
      resolveEffectiveProductAdvertisingRequestInput({
        preferredRequestInput: null,
        workspace: createWorkspace({ startDate: "2026-03-01", endDate: "2026-03-31" }),
        sheet: createSheet({ startDate: "2026-04-01", endDate: "2026-04-30" }),
      }),
    ).toEqual({
      startDate: "2026-03-01",
      endDate: "2026-03-31",
    });
  });

  it("falls back to sheet range when no preferred and no workspace range", () => {
    // Если нет ни preferred, ни workspace — используем sheet.
    expect(
      resolveEffectiveProductAdvertisingRequestInput({
        preferredRequestInput: null,
        sheet: createSheet({ startDate: "2026-04-01", endDate: "2026-04-30" }),
      }),
    ).toEqual({
      startDate: "2026-04-01",
      endDate: "2026-04-30",
    });
  });

  it("returns null when nothing is available", () => {
    expect(
      resolveEffectiveProductAdvertisingRequestInput({
        preferredRequestInput: null,
      }),
    ).toBeNull();
  });
});
