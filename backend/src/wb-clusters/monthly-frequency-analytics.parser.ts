import AdmZip from "adm-zip";
import * as XLSX from "xlsx";

import { decodeBestEffortMonthlyFrequencyCsv } from "./monthly-frequency-analytics.decode";
import {
  findMonthlyFrequencyHeaderRow,
  readMonthlyFrequencyValue,
} from "./monthly-frequency-analytics.headers";
import type { MonthlyFrequencyRow } from "./monthly-frequency-analytics.types";

export function extractCsvBufferFromZip(input: {
  archiveBuffer: Buffer;
  onWarn: (message: string) => void;
  describeError: (error: unknown) => string;
}) {
  try {
    const zip = new AdmZip(input.archiveBuffer);
    const csvEntry =
      zip
        .getEntries()
        .find((entry) => !entry.isDirectory && /\.csv$/i.test(entry.entryName)) ??
      zip.getEntries().find((entry) => !entry.isDirectory);

    return csvEntry ? csvEntry.getData() : null;
  } catch (error) {
    input.onWarn(
      `Failed to unpack WB Seller Analytics ZIP archive: ${input.describeError(error)}`,
    );
    return null;
  }
}

export function parseMonthlyFrequencyCsv(input: {
  csvBuffer: Buffer;
  readOptionalString: (value: unknown) => string | null;
  normalizeAdvertisingText: (value: string) => string;
}) {
  const workbook = XLSX.read(
    decodeBestEffortMonthlyFrequencyCsv(input.csvBuffer),
    {
      type: "string",
    },
  );
  return parseMonthlyFrequencyWorkbook(workbook, input);
}

export function parseMonthlyFrequencyWorkbookBuffer(input: {
  workbookBuffer: Buffer;
  readOptionalString: (value: unknown) => string | null;
  normalizeAdvertisingText: (value: string) => string;
}) {
  const workbook = XLSX.read(input.workbookBuffer, { type: "buffer" });
  return parseMonthlyFrequencyWorkbook(workbook, input);
}

function parseMonthlyFrequencyWorkbook(
  workbook: XLSX.WorkBook,
  input: {
    readOptionalString: (value: unknown) => string | null;
    normalizeAdvertisingText: (value: string) => string;
  },
) {
  for (const sheetName of workbook.SheetNames) {
    const worksheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<unknown[]>(worksheet, {
      header: 1,
      defval: "",
    });
    const headerMatch = findMonthlyFrequencyHeaderRow(rows);
    if (!headerMatch) {
      continue;
    }

    const deduplicatedRows = new Map<string, MonthlyFrequencyRow>();
    for (const row of rows.slice(headerMatch.headerRowIndex + 1)) {
      if (!Array.isArray(row)) {
        continue;
      }

      const queryText = input.readOptionalString(row[headerMatch.queryColumnIndex]);
      const monthlyFrequency = readMonthlyFrequencyValue(
        row[headerMatch.frequencyColumnIndex],
      );
      if (!queryText || monthlyFrequency === null) {
        continue;
      }

      const subjectName =
        headerMatch.subjectColumnIndex !== -1
          ? (input.readOptionalString(row[headerMatch.subjectColumnIndex]) ?? null)
          : null;

      const normalizedQuery = input.normalizeAdvertisingText(queryText);
      const existing = deduplicatedRows.get(normalizedQuery);
      if (!existing || monthlyFrequency > existing.monthlyFrequency) {
        deduplicatedRows.set(normalizedQuery, {
          queryText,
          monthlyFrequency,
          subjectName,
        });
      }
    }

    if (deduplicatedRows.size > 0) {
      return Array.from(deduplicatedRows.values());
    }
  }

  return [] as MonthlyFrequencyRow[];
}
