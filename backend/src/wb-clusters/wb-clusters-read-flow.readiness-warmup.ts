type WbClustersService = any;

export function buildProductSnapshotWarmupStateKey(
  self: WbClustersService,
  input: {
    exportRequestId: string | null;
    period: { start: string; end: string };
    nmId: number;
  },
) {
  return `${input.exportRequestId ?? "no-export"}:${input.period.start}:${input.period.end}:${String(input.nmId)}`;
}

export function buildProductSnapshotWarmupJobKey(
  self: WbClustersService,
  exportRequestId: string,
  period: { start: string; end: string },
  priority: string,
) {
  return `${exportRequestId}:${period.start}:${period.end}:${priority}`;
}

export function markProductSnapshotWarmupQueued(
  self: WbClustersService,
  nmIds: number[],
  period: { start: string; end: string } | null,
  exportRequestId: string | null,
  priority: string,
) {
  if (!period) {
    return;
  }

  const updatedAt = new Date().toISOString();
  for (const nmId of nmIds) {
    const key = self.buildProductSnapshotWarmupStateKey({
      exportRequestId,
      period,
      nmId,
    });
    const existingValue = self.productSnapshotWarmupState.get(key);
    if (
      existingValue &&
      (existingValue.status === "running" ||
        self.getWarmupPriorityRank(existingValue.priority) <=
          self.getWarmupPriorityRank(priority))
    ) {
      continue;
    }

    self.productSnapshotWarmupState.set(key, {
      status: "queued",
      priority,
      updatedAt,
      failureReason: null,
    });
  }
}

export function markProductSnapshotWarmupRunning(
  self: WbClustersService,
  nmIds: number[],
  period: { start: string; end: string },
  exportRequestId: string | null,
) {
  const updatedAt = new Date().toISOString();
  for (const nmId of nmIds) {
    const key = self.buildProductSnapshotWarmupStateKey({
      exportRequestId,
      period,
      nmId,
    });
    const existingValue = self.productSnapshotWarmupState.get(key);
    self.productSnapshotWarmupState.set(key, {
      status: "running",
      priority: existingValue?.priority ?? "background",
      updatedAt,
      failureReason: null,
    });
  }
}

export function markProductSnapshotWarmupFailed(
  self: WbClustersService,
  nmIds: number[],
  period: { start: string; end: string },
  exportRequestId: string | null,
  failureReason: string,
) {
  const updatedAt = new Date().toISOString();
  for (const nmId of nmIds) {
    const key = self.buildProductSnapshotWarmupStateKey({
      exportRequestId,
      period,
      nmId,
    });
    const existingValue = self.productSnapshotWarmupState.get(key);
    self.productSnapshotWarmupState.set(key, {
      status: "failed",
      priority: existingValue?.priority ?? "background",
      updatedAt,
      failureReason,
    });
  }
}

export function clearProductSnapshotWarmupState(
  self: WbClustersService,
  nmIds: number[],
  period: { start: string; end: string },
  exportRequestId: string | null,
) {
  for (const nmId of nmIds) {
    self.productSnapshotWarmupState.delete(
      self.buildProductSnapshotWarmupStateKey({
        exportRequestId,
        period,
        nmId,
      }),
    );
  }
}

export function getProductSnapshotWarmupState(
  self: WbClustersService,
  input: {
    nmId: number;
    period: { start: string; end: string };
    exportRequestId: string | null;
  },
) {
  return (
    self.productSnapshotWarmupState.get(
      self.buildProductSnapshotWarmupStateKey({
        exportRequestId: input.exportRequestId,
        period: input.period,
        nmId: input.nmId,
      }),
    ) ?? null
  );
}

export function getWarmupPriorityRank(self: WbClustersService, priority: string) {
  switch (priority) {
    case "visible":
      return 0;
    case "candidate":
      return 1;
    case "startup":
      return 3;
    default:
      return 2;
  }
}

