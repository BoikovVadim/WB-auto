function scoreDecodedCsv(value: string) {
  let score = 0;

  if (!value.includes("\uFFFD")) {
    score += 10;
  }
  if (/[А-Яа-я]/.test(value)) {
    score += 5;
  }
  if (/частот|frequency|query|запрос/.test(value.toLocaleLowerCase("ru"))) {
    score += 20;
  }

  return score;
}

export function decodeBestEffortMonthlyFrequencyCsv(csvBuffer: Buffer) {
  const encodings = ["utf-8", "windows-1251", "koi8-r"] as const;
  let bestText = "";
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const encoding of encodings) {
    let decodedText = "";
    try {
      decodedText = new TextDecoder(encoding).decode(csvBuffer);
    } catch {
      continue;
    }

    const score = scoreDecodedCsv(decodedText);
    if (score > bestScore) {
      bestText = decodedText;
      bestScore = score;
    }
  }

  return bestText || csvBuffer.toString("utf-8");
}
