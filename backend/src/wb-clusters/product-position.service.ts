import { Injectable, Logger } from "@nestjs/common";

import type { ClusterPositionLatest } from "./wb-clusters.repository.positions";
import { WbClustersRepository } from "./wb-clusters.repository";
import { WbSearchPositionProbeClient } from "./wb-search-position-probe.client";

const DEST_MOSCOW = "-1257786";
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
/** Щадящий темп между кластерами — 1 чистый IP держит примерно 1 запрос в 3–4 c. */
const CLUSTER_DELAY_MS = 3500;
/** На 429 ждём дольше — даём IP остыть. */
const THROTTLE_BACKOFF_MS = 15_000;
/** Подряд столько троттлов → IP перегрет, прекращаем обход (v1, 1 IP). */
const MAX_CONSECUTIVE_THROTTLES = 6;

export type PositionRunPhase = "idle" | "running" | "done";

interface RunState {
  status: PositionRunPhase;
  total: number;
  processed: number;
  found: number;
  notFound: number;
  throttled: number;
  blocked: number;
  startedAt: string | null;
  finishedAt: string | null;
  stoppedEarly: boolean;
}

export interface PositionRunStatus extends RunState {
  nmId: number;
  items: ClusterPositionLatest[];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Фича «место товара в выдаче по кластеру на момент замера» (v1, ручной запуск, 1 IP).
 *
 * По кнопке «Запустить парсер» оркестратор берёт топ-N кластеров товара (по частотности),
 * на каждый — самый высокочастотный запрос, и зондом (WbSearchPositionProbeClient) ищет
 * место товара в выдаче. Ходит с IP прод-сервера, щадящим темпом, с backoff на 429.
 * Результаты пишутся в историю (wb_cluster_position_snapshots). Цель v1 — нащупать
 * реальные лимиты на 1 IP (доля found vs throttled), потом — автоматика/несколько IP.
 *
 * Прогон асинхронный: POST запускает фоном, статус читается через GET (кнопка → «идёт…»
 * → результаты). Состояние прогона держим in-memory (один инстанс, pm2 fork).
 */
@Injectable()
export class ProductPositionService {
  private readonly logger = new Logger(ProductPositionService.name);
  private readonly runs = new Map<number, RunState>();

  constructor(
    private readonly repository: WbClustersRepository,
    private readonly probe: WbSearchPositionProbeClient,
  ) {}

  /** Запустить обход позиций по товару (если уже идёт — вернуть текущее состояние). */
  async startRun(nmId: number, limit?: number): Promise<PositionRunStatus> {
    const existing = this.runs.get(nmId);
    if (existing?.status === "running") return this.buildStatus(nmId, existing);

    const cappedLimit = Math.min(Math.max(limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
    const clusters = await this.repository.getRepresentativeClusterQueries(
      nmId,
      cappedLimit,
    );

    const state: RunState = {
      status: clusters.length > 0 ? "running" : "done",
      total: clusters.length,
      processed: 0,
      found: 0,
      notFound: 0,
      throttled: 0,
      blocked: 0,
      startedAt: new Date().toISOString(),
      finishedAt: clusters.length > 0 ? null : new Date().toISOString(),
      stoppedEarly: false,
    };
    this.runs.set(nmId, state);
    if (clusters.length > 0) {
      void this.runProbe(nmId, clusters, state);
    }
    return this.buildStatus(nmId, state);
  }

  /** Текущий статус обхода + последние замеры по кластерам. */
  async getStatus(nmId: number): Promise<PositionRunStatus> {
    const state =
      this.runs.get(nmId) ??
      ({
        status: "idle",
        total: 0,
        processed: 0,
        found: 0,
        notFound: 0,
        throttled: 0,
        blocked: 0,
        startedAt: null,
        finishedAt: null,
        stoppedEarly: false,
      } satisfies RunState);
    return this.buildStatus(nmId, state);
  }

  private async buildStatus(
    nmId: number,
    state: RunState,
  ): Promise<PositionRunStatus> {
    const items = await this.repository.getLatestClusterPositions(nmId);
    return { nmId, ...state, items };
  }

  private async runProbe(
    nmId: number,
    clusters: Awaited<
      ReturnType<WbClustersRepository["getRepresentativeClusterQueries"]>
    >,
    state: RunState,
  ): Promise<void> {
    let consecutiveThrottles = 0;
    try {
      for (const cluster of clusters) {
        const result = await this.probe.probeQueryPosition(cluster.topQuery, nmId);
        await this.repository.insertClusterPositionSnapshot({
          nmId,
          normalizedClusterName: cluster.normalizedClusterName,
          clusterName: cluster.clusterName,
          probeQuery: cluster.topQuery,
          probeFrequency: cluster.monthlyFrequency,
          dest: DEST_MOSCOW,
          status: result.status,
          organicPosition: result.organicPosition,
          adPosition: result.adPosition,
          isAd: result.isAd,
          page: result.page,
          scannedCount: result.scanned,
        });

        state.processed++;
        if (result.status === "found") state.found++;
        else if (result.status === "not_found") state.notFound++;
        else if (result.status === "throttled") state.throttled++;
        else state.blocked++;

        if (result.status === "throttled") {
          consecutiveThrottles++;
          if (consecutiveThrottles >= MAX_CONSECUTIVE_THROTTLES) {
            state.stoppedEarly = true;
            this.logger.warn(
              `nm ${nmId}: ${consecutiveThrottles} троттлов подряд — IP перегрет, стоп.`,
            );
            break;
          }
          await sleep(THROTTLE_BACKOFF_MS);
        } else {
          consecutiveThrottles = 0;
          await sleep(CLUSTER_DELAY_MS);
        }
      }
    } catch (error) {
      this.logger.error(`nm ${nmId} probe run failed: ${(error as Error).message}`);
    } finally {
      state.status = "done";
      state.finishedAt = new Date().toISOString();
    }
  }
}
