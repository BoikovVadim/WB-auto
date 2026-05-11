export type MonthlyFrequencyImportPeriod = {
  from: string;
  to: string;
};

export function getDefaultMonthlyFrequencyImportPeriod(): MonthlyFrequencyImportPeriod {
  const end = new Date();
  end.setUTCDate(end.getUTCDate() - 1);

  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 29);

  return {
    from: toIsoDate(start),
    to: toIsoDate(end),
  };
}

function toIsoDate(value: Date) {
  return value.toISOString().slice(0, 10);
}
