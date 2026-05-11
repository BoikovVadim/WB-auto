import { Injectable, Logger } from "@nestjs/common";

@Injectable()
export class ProductAdvertisingSnapshotJobService {
  private readonly logger = new Logger(ProductAdvertisingSnapshotJobService.name);

  async materializeSnapshots(input: {
    nmIds: number[];
    reason: string;
    explicitPeriod?: { start: string; end: string } | null;
    getWarmPeriods: () => Array<{ start: string; end: string }>;
    materializeSnapshot: (nmId: number, period: { start: string; end: string }) => Promise<void>;
    invalidateCaches: (nmId: number) => void;
    concurrency?: number;
    onRunning?: (nmId: number, period: { start: string; end: string }) => void;
    onSucceeded?: (nmId: number, period: { start: string; end: string }) => void;
    onFailed?: (nmId: number, period: { start: string; end: string }, errorMessage: string) => void;
  }) {
    const warmPeriods = input.getWarmPeriods();
    const periods = input.explicitPeriod
      ? [
          input.explicitPeriod,
          ...warmPeriods.filter(
            (period) =>
              period.start !== input.explicitPeriod?.start ||
              period.end !== input.explicitPeriod?.end,
          ),
        ]
      : warmPeriods;

    this.logger.log(
      `Materializing product advertising snapshots for ${input.nmIds.length} products after ${input.reason}.`,
    );

    const concurrency = input.concurrency ?? 4;

    for (const period of periods) {
      for (const chunk of this.chunkArray(input.nmIds, concurrency)) {
        await Promise.all(
          chunk.map(async (nmId) => {
            this.logger.log(
              `Materializing product advertising snapshot for nm ${nmId} period ${period.start}..${period.end}.`,
            );
            input.onRunning?.(nmId, period);
            try {
              await input.materializeSnapshot(nmId, period);
              input.invalidateCaches(nmId);
              input.onSucceeded?.(nmId, period);
            } catch (error: unknown) {
              const message =
                error instanceof Error
                  ? error.message
                  : "Unknown product advertising materialization error";
              input.onFailed?.(nmId, period, message);
              this.logger.warn(
                `Unable to materialize product advertising sheet for nm ${nmId} period ${period.start}..${period.end} after ${input.reason}: ${message}`,
              );
            }
          }),
        );
      }
    }
  }

  private chunkArray<T>(values: T[], chunkSize: number) {
    const chunks: T[][] = [];
    for (let index = 0; index < values.length; index += chunkSize) {
      chunks.push(values.slice(index, index + chunkSize));
    }
    return chunks;
  }
}
