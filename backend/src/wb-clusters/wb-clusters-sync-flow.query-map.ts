import * as XLSX from "xlsx";

type WbClustersService = any;

export function parseWordsClustersWorkbook(self: WbClustersService, workbookBuffer: Buffer) {
  const workbook = XLSX.read(workbookBuffer, { type: "buffer" });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) {
    return [];
  }

  const worksheet = workbook.Sheets[firstSheetName];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, {
    defval: "",
  });
  const parsedRows: Array<{ clusterName: string; queryText: string }> = [];
  const seenRows = new Set<string>();

  for (const row of rows) {
    const values = Object.values(row);
    const clusterName = self.readOptionalString(values[0]);
    const queryText = self.readOptionalString(values[1]);
    if (!clusterName || !queryText) {
      continue;
    }

    const rowKey = `${clusterName.toLocaleLowerCase("ru")}\u0000${queryText.toLocaleLowerCase("ru")}`;
    if (seenRows.has(rowKey)) {
      continue;
    }
    seenRows.add(rowKey);
    parsedRows.push({ clusterName, queryText });
  }

  return parsedRows;
}

export async function syncCabinetClusterQueries(
  self: WbClustersService,
  input: {
    syncRunId: string;
    advertId: number;
    nmId: number;
    warningMessages: string[];
    archiveBuffer?: {
      push: (entry: {
        archiveType: string;
        advertId: number | null;
        nmId: number | null;
        payload: unknown;
      }) => void;
    };
  },
) {
  const cabinetResult = await self.tryCmpStep(
    `cabinet private words-clusters for advert ${input.advertId}, nm ${input.nmId}`,
    () => self.wbCabinetPrivateApiClient.exportWordsClusters(input.advertId, input.nmId),
    input.warningMessages,
  );
  if (!cabinetResult) {
    return 0;
  }

  const queryRows = self.parseWordsClustersWorkbook(cabinetResult.workbookBuffer);
  if (queryRows.length === 0) {
    return 0;
  }

  const archivePayload = {
    probe: cabinetResult.probe,
    rowCount: queryRows.length,
    sample: queryRows.slice(0, 25),
  };
  if (input.archiveBuffer) {
    input.archiveBuffer.push({
      archiveType: "cabinet-private-words-clusters",
      advertId: input.advertId,
      nmId: input.nmId,
      payload: archivePayload,
    });
  } else {
    await self.wbClustersRepository.saveRawArchive({
      syncRunId: input.syncRunId,
      archiveType: "cabinet-private-words-clusters",
      advertId: input.advertId,
      nmId: input.nmId,
      payload: archivePayload,
    });
  }

  return self.wbClustersRepository.replaceCabinetClusterQueries({
    advertId: input.advertId,
    nmId: input.nmId,
    captureMode: "private-api-words-clusters",
    sourceEndpoint: cabinetResult.probe.workbook.sourceEndpoint,
    capturedAt: cabinetResult.probe.capturedAt,
    rows: queryRows,
  });
}

export async function syncCmpClusterQueries(
  self: WbClustersService,
  input: {
    syncRunId: string;
    advertId: number;
    nmId: number;
    warningMessages: string[];
    archiveBuffer?: {
      push: (entry: {
        archiveType: string;
        advertId: number | null;
        nmId: number | null;
        payload: unknown;
      }) => void;
    };
  },
) {
  const workbook = await self.tryCmpStep(
    `cmp words-clusters for advert ${input.advertId}, nm ${input.nmId}`,
    () => self.wbCmpSafariClient.exportWordsClusters(input.advertId, input.nmId),
    input.warningMessages,
  );
  if (!workbook) {
    return 0;
  }

  const queryRows = self.parseWordsClustersWorkbook(workbook);
  if (queryRows.length === 0) {
    return 0;
  }

  const archivePayload = {
    rowCount: queryRows.length,
    sample: queryRows.slice(0, 25),
  };
  if (input.archiveBuffer) {
    input.archiveBuffer.push({
      archiveType: "cmp-words-clusters",
      advertId: input.advertId,
      nmId: input.nmId,
      payload: archivePayload,
    });
  } else {
    await self.wbClustersRepository.saveRawArchive({
      syncRunId: input.syncRunId,
      archiveType: "cmp-words-clusters",
      advertId: input.advertId,
      nmId: input.nmId,
      payload: archivePayload,
    });
  }

  return self.wbClustersRepository.replaceClusterQueries({
    advertId: input.advertId,
    nmId: input.nmId,
    rows: queryRows,
  });
}

export async function isCabinetSessionReady(self: WbClustersService) {
  const cabinetSession = await self.wbCabinetPrivateApiClient.getSessionStatus();
  return cabinetSession.status === "ready" && Boolean(cabinetSession.supplierId);
}
