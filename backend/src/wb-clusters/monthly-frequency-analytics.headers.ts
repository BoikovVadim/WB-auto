function normalizeCsvHeader(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLocaleLowerCase("ru")
    .replace(/[_\s/\\().:-]+/g, "");
}

function isMonthlyFrequencyQueryHeader(value: unknown) {
  const header = normalizeCsvHeader(value);
  if (!header) {
    return false;
  }

  if (
    header.includes("count") ||
    header.includes("колич") ||
    header.includes("частот") ||
    header.includes("average") ||
    header.includes("сред") ||
    header.includes("динамик") ||
    header.includes("предмет")
  ) {
    return false;
  }

  return (
    header.includes("searchtext") ||
    header.includes("searchquery") ||
    header.includes("querytext") ||
    header.includes("textquery") ||
    header === "query" ||
    header === "searchquery" ||
    header === "searchtext" ||
    header === "запрос" ||
    header === "поисковыйзапрос" ||
    header === "поисковойзапрос" ||
    header === "поисковаяфраза"
  );
}

function isMonthlyFrequencyValueHeader(value: unknown) {
  const header = normalizeCsvHeader(value);
  if (!header) {
    return false;
  }

  const explicitMonthlyMatch =
    header.includes("monthlyfrequency") ||
    header.includes("monthfrequency") ||
    header.includes("frequency30") ||
    header.includes("frequencycurrent") ||
    header.includes("частотностьза30дней") ||
    header.includes("частотность30дней") ||
    header.includes("месячнаячастотность") ||
    header.includes("частотностьтекущая");
  if (explicitMonthlyMatch) {
    return true;
  }

  const explicitCountMatch =
    header.includes("количествозапросов") ||
    header.includes("числозапросов") ||
    header.includes("querycount") ||
    header.includes("queriescount") ||
    header.includes("countofqueries");
  if (explicitCountMatch) {
    return true;
  }

  return (
    (header.includes("frequency") || header.includes("частот")) &&
    !header.includes("week") &&
    !header.includes("недел") &&
    !header.includes("average") &&
    !header.includes("сред") &&
    !header.includes("day") &&
    !header.includes("день")
  );
}

function isMonthlyFrequencySubjectHeader(value: unknown) {
  const header = normalizeCsvHeader(value);
  if (!header) {
    return false;
  }
  // Matches:
  //   "Предмет"                          → "предмет"
  //   "Больше всего заказов в предмете"  → "большевсегозаказоввпредмете" (WB JAM report column)
  //   "subject", "SubjectName", etc.
  return (
    header === "предмет" ||
    header.startsWith("предмет") ||
    header.endsWith("предмете") ||
    header === "subject" ||
    header === "subjectname" ||
    header === "subjectcategory" ||
    header === "категория"
  );
}

export function findMonthlyFrequencyHeaderRow(rows: unknown[][]) {
  for (
    let headerRowIndex = 0;
    headerRowIndex < Math.min(rows.length, 25);
    headerRowIndex += 1
  ) {
    const headerRow = rows[headerRowIndex];
    if (!Array.isArray(headerRow) || headerRow.length === 0) {
      continue;
    }

    const queryColumnIndex = headerRow.findIndex((header) =>
      isMonthlyFrequencyQueryHeader(header),
    );
    const frequencyColumnIndex = headerRow.findIndex((header) =>
      isMonthlyFrequencyValueHeader(header),
    );
    if (
      queryColumnIndex !== -1 &&
      frequencyColumnIndex !== -1 &&
      queryColumnIndex !== frequencyColumnIndex
    ) {
      const subjectColumnIndex = headerRow.findIndex((header) =>
        isMonthlyFrequencySubjectHeader(header),
      );
      return {
        headerRowIndex,
        queryColumnIndex,
        frequencyColumnIndex,
        /** -1 if the "Предмет" column is absent in this report format. */
        subjectColumnIndex: subjectColumnIndex !== frequencyColumnIndex && subjectColumnIndex !== queryColumnIndex
          ? subjectColumnIndex
          : -1,
      };
    }
  }

  return null;
}

export function readMonthlyFrequencyValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value !== "string") {
    return null;
  }

  const normalizedValue = value
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, "")
    .replace(",", ".");
  if (!normalizedValue) {
    return null;
  }

  const parsedValue = Number(normalizedValue);
  return Number.isFinite(parsedValue) ? parsedValue : null;
}
