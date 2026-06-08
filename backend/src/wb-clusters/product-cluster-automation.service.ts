import { Injectable, Logger } from "@nestjs/common";

import { ProductCpoService } from "./product-cpo.service";
import { ProductClusterAccrualService } from "./product-cluster-accrual.service";
import { ProductClusterRelevanceService } from "./product-cluster-relevance.service";
import {
  applyDecisionsToWb,
  buildAutomationStateRows,
  revertBlockedDecisions,
} from "./product-cluster-automation.persist";
import { decideForCluster, type ClusterDecision } from "./product-cluster-decision";
import { decideForClusterV2 } from "./product-cluster-decision.v2";
import type {
  AutomationMode,
  ClusterAutomationStateValue,
  ClusterOverrideItem,
  ClusterOverridePickerRow,
  ClusterReviewStatus,
} from "./wb-clusters.repository.automation";
import { WbClustersRepository } from "./wb-clusters.repository";
import { WbClustersService } from "./wb-clusters.service";

/** Доля кластеров, выше которой массовое авто-исключение блокируется (защита от обнуления РК). */
const MAX_EXCLUDE_SHARE = 0.8;

/** Статус автоматизации кампании для UI (режим + порог + счётчик ревью + per-cluster решения). */
export interface ClusterAutomationStatusResult {
  mode: AutomationMode;
  maxCpo: number | null;
  /** Сколько новых кластеров ждёт ручной модерации (review_status=pending). */
  pendingCount: number;
  clusters: {
    normalizedClusterName: string;
    state: ClusterAutomationStateValue;
    manualProtected: boolean;
    lastCpo: number | null;
    lastDecision: string | null;
    reviewStatus: ClusterReviewStatus;
  }[];
}

/**
 * Автоматизация управления кластерами по CPO. Каждые 10 минут для кампаний с включённой
 * автоматизацией пересчитывает CPO каждого кластера и приводит состав к правилу
 * «CPO ≤ макс. CPO товара → включить, CPO > макс → исключить».
 *
 * CPO кластера = той же формуле, что колонка «СРО» таблицы РК: spend / max(заказы РК,
 * джем-заказы) за скользящие 30 дней (РК-часть = shks ?? orders_РК); при 0 заказов колонка
 * показывает сам расход — его и сравниваем. Правило: значение ≤ макс. CPO → включить,
 * > макс → исключить — независимо от наличия заказов. Нет расхода вовсе → кандидат в
 * активные (сигнала против нет). Исход «выбыл» (dropped) не назначается.
 *
 * Модерация новых кластеров: кластер, который ВБ добавил в РК ПОСЛЕ baseline кампании,
 * встаёт в `pending_review` — движок его НЕ трогает (decision=noop), пока человек не
 * примет решение (в работу / чёрный / белый список) через reviewCluster. Существующие на
 * момент включения автоматизации кластеры грандфазерятся как approved.
 *
 * Режимы: 'preview' — считаем и сохраняем решения, WB НЕ трогаем; 'live' — реально
 * включаем/исключаем через существующую очередь действий (applyProductClusterAction).
 */
@Injectable()
export class ProductClusterAutomationService {
  private readonly logger = new Logger("ProductClusterAutomation");
  /** Busy-guard: длинный live-обход не должен накладываться на свой предыдущий 10-мин тик. */
  private runAllInFlight = false;

  constructor(
    private readonly repository: WbClustersRepository,
    private readonly wbClustersService: WbClustersService,
    private readonly productCpoService: ProductCpoService,
    private readonly relevanceService: ProductClusterRelevanceService,
    private readonly accrualService: ProductClusterAccrualService,
  ) {}

  /**
   * Смена режима + немедленный прогон. Возвращает статус, собранный ПРЯМО из посчитанных
   * decisions — без второго тяжёлого чтения (getManagedClusterAutomationStates). Это делает
   * первый показ цифр в панели моментальным. На off / без порога — обычное чтение getStatus.
   */
  async setMode(advertId: number, nmId: number, mode: AutomationMode): Promise<ClusterAutomationStatusResult> {
    await this.repository.setAutomationMode(advertId, nmId, mode);
    if (mode === "off") {
      return { mode: "off", maxCpo: null, pendingCount: 0, clusters: [] };
    }
    try {
      const { decisions, maxCpo } = await this.evaluateOne(advertId, nmId, mode);
      if (maxCpo === null) return this.getStatus(advertId, nmId); // нет порога — отдадим как есть
      return this.buildStatusFromDecisions(mode, maxCpo, decisions);
    } catch (e: unknown) {
      this.logger.warn(`Initial automation pass failed for ${advertId}/${nmId}: ${String(e)}`);
      return this.getStatus(advertId, nmId);
    }
  }

  /** Статус автоматизации + per-cluster решения (для UI рекламного воркспейса). */
  async getStatus(advertId: number, nmId: number): Promise<ClusterAutomationStatusResult> {
    const [mode, productCpo, states] = await Promise.all([
      this.repository.getAutomationMode(advertId, nmId),
      this.productCpoService.getProductCpo(nmId),
      // Только управляемые сейчас кластеры — чтобы счётчики «актив/искл/выбыло»
      // сходились с «Все N» таблицы РК (исторические строки state не считаем).
      this.repository.getManagedClusterAutomationStates(advertId, nmId),
    ]);
    const pendingCount = states.filter((s) => s.reviewStatus === "pending").length;
    return { mode, maxCpo: productCpo.maxCpo, pendingCount, clusters: states };
  }

  /**
   * Ручная модерация нового кластера. action:
   *   'approve' — в работу (review_status=approved → дальше решает CPO-правило);
   *   'reject'  — в чёрный список (is_blacklisted=true, больше не всплывёт);
   *   'protect' — в белый список (is_protected=true, всегда активен).
   * После — один прогон evaluateOne, чтобы решение применилось сразу (в live — на WB).
   */
  async reviewCluster(
    advertId: number,
    nmId: number,
    normalizedClusterName: string,
    clusterName: string,
    action: "approve" | "reject" | "protect",
  ): Promise<ClusterAutomationStatusResult> {
    if (action === "reject") {
      await this.repository.setSingleClusterOverride(advertId, nmId, normalizedClusterName, clusterName, {
        isProtected: false,
        isBlacklisted: true,
      });
    } else if (action === "protect") {
      await this.repository.setSingleClusterOverride(advertId, nmId, normalizedClusterName, clusterName, {
        isProtected: true,
        isBlacklisted: false,
      });
    }
    // Обучение мусор-фильтра от решения менеджера (по товару): слова кластера → pos/neg.
    // approve/protect — релевантно, reject — в чёрный. Дальше движок сам авто-бракует
    // новые кластеры с выученными «чёрными» словами (случай «для шиншилл»).
    await this.relevanceService.learnFromReview(nmId, clusterName, action);

    // Во всех исходах кластер выходит из карантина (approved) — дальше им управляет
    // CPO-правило / чёрный / белый список по обычной логике движка.
    await this.repository.setClusterReviewStatus(advertId, nmId, normalizedClusterName, "approved");

    const mode = await this.repository.getAutomationMode(advertId, nmId);
    if (mode === "off") return this.getStatus(advertId, nmId);
    try {
      const { decisions, maxCpo } = await this.evaluateOne(advertId, nmId, mode);
      if (maxCpo === null) return this.getStatus(advertId, nmId);
      return this.buildStatusFromDecisions(mode, maxCpo, decisions);
    } catch (e: unknown) {
      this.logger.warn(`reviewCluster evaluate failed ${advertId}/${nmId}: ${String(e)}`);
      return this.getStatus(advertId, nmId);
    }
  }

  /** Read-model для модалки «Настройка фильтров»: список кластеров + защита. */
  async getFilterConfig(advertId: number, nmId: number): Promise<{
    clusters: ClusterOverridePickerRow[];
  }> {
    const clusters = await this.repository.getClusterOverridePicker(advertId, nmId);
    return { clusters };
  }

  /** Кластеры на проверке кампании, обогащённые (имя + предв. CPO + частота + JAM) — для модалки ревью. */
  async getPendingClusters(advertId: number, nmId: number) {
    return this.repository.getPendingClusters(advertId, nmId);
  }

  /**
   * Сводный статус автоматизации по всем товарам с включённой автоматизацией — для колонки
   * в таблице товаров (понять, у кого включено). byNmId: nmId → режим товара + число кампаний
   * + сколько новых кластеров на проверке (pendingCount, для бейджа). Товары без автоматизации
   * в карте отсутствуют (фронт трактует как "off").
   */
  async getProductAutomationStatuses(): Promise<{
    byNmId: Record<number, { mode: AutomationMode; campaignsWithAutomation: number; pendingCount: number }>;
  }> {
    const [rows, pending] = await Promise.all([
      this.repository.getProductAutomationModes(),
      this.repository.getProductPendingCounts(),
    ]);
    const pendingByNmId = new Map(pending.map((p) => [p.nmId, p.pendingCount]));
    const byNmId: Record<number, { mode: AutomationMode; campaignsWithAutomation: number; pendingCount: number }> = {};
    for (const r of rows) {
      byNmId[r.nmId] = {
        mode: r.mode,
        campaignsWithAutomation: r.campaignsWithAutomation,
        pendingCount: pendingByNmId.get(r.nmId) ?? 0,
      };
    }
    return { byNmId };
  }

  /**
   * Детализация автоматизации по ОДНОМУ товару (для модалки из таблицы товаров): режим
   * товара (live > preview > off), список его кампаний с их режимами и агрегированные
   * счётчики кластеров (актив/чёрный/искл. по CPO) по всем кампаниям. Когда режим off —
   * счётчики нулевые (движок ещё не считал); «Предпросмотр» включит расчёт и наполнит их.
   */
  async getProductAutomationDetail(nmId: number): Promise<{
    nmId: number;
    mode: AutomationMode;
    campaigns: { advertId: number; name: string | null; mode: AutomationMode }[];
    counts: { active: number; blacklisted: number; high: number; drrHeld: number };
  }> {
    const campaignList = await this.repository.getProductCampaignAdvertIds(nmId);
    const perCampaign = await Promise.all(
      campaignList.map(async (c) => {
        const status = await this.getStatus(c.advertId, nmId);
        return {
          advertId: c.advertId,
          name: c.name,
          mode: status.mode,
          active: status.clusters.filter(
            (x) =>
              x.state === "active" ||
              x.state === "manual_protected" ||
              x.state === "protected" ||
              x.state === "learning", // фаза набора данных — кластер работает, копит
          ).length,
          blacklisted: status.clusters.filter((x) => x.state === "blacklisted").length,
          high: status.clusters.filter((x) => x.state === "excluded_high").length,
          drrHeld: status.clusters.filter((x) => x.state === "excluded_drr").length,
        };
      }),
    );
    const mode: AutomationMode = perCampaign.some((c) => c.mode === "live")
      ? "live"
      : perCampaign.some((c) => c.mode === "preview")
        ? "preview"
        : "off";
    const counts = perCampaign.reduce(
      (acc, c) => ({
        active: acc.active + c.active,
        blacklisted: acc.blacklisted + c.blacklisted,
        high: acc.high + c.high,
        drrHeld: acc.drrHeld + c.drrHeld,
      }),
      { active: 0, blacklisted: 0, high: 0, drrHeld: 0 },
    );
    return {
      nmId,
      mode,
      campaigns: perCampaign.map((c) => ({ advertId: c.advertId, name: c.name, mode: c.mode })),
      counts,
    };
  }

  /**
   * Установить режим автоматизации сразу для ВСЕХ кампаний товара (вкл/выкл из таблицы
   * товаров). Серийно — setMode каждой кампании в preview/live запускает прогон evaluateOne
   * (в live реально пишет на WB); параллель засушила бы пул и долбила WB. Возвращает свежую
   * детализацию для модалки.
   */
  async setProductMode(nmId: number, mode: AutomationMode): Promise<{
    nmId: number;
    mode: AutomationMode;
    campaigns: { advertId: number; name: string | null; mode: AutomationMode }[];
    counts: { active: number; blacklisted: number; high: number; drrHeld: number };
  }> {
    const campaignList = await this.repository.getProductCampaignAdvertIds(nmId);
    for (const c of campaignList) {
      await this.setMode(c.advertId, nmId, mode);
    }
    return this.getProductAutomationDetail(nmId);
  }

  /**
   * Полная замена белого и чёрного списков. Если автоматика включена — сразу прогон, чтобы
   * списки применились без ожидания крона (в live реально вкл/выкл соответствующие кластеры).
   */
  async setClusterFilters(
    advertId: number,
    nmId: number,
    input: { protected: ClusterOverrideItem[]; blacklisted: ClusterOverrideItem[] },
  ): Promise<{ clusters: ClusterOverridePickerRow[] }> {
    await this.repository.setClusterFilters(advertId, nmId, input);
    const mode = await this.repository.getAutomationMode(advertId, nmId);
    if (mode !== "off") {
      await this.evaluateOne(advertId, nmId, mode).catch((e: unknown) => {
        this.logger.warn(`Filter pass failed for ${advertId}/${nmId}: ${String(e)}`);
      });
    }
    return this.getFilterConfig(advertId, nmId);
  }

  /** Крон-обход: один прогон по всем включённым (preview/live) кампаниям. */
  async runAll(): Promise<void> {
    // Busy-guard: если предыдущий обход не успел закрыться к следующему 10-мин тику (в live
    // обход дёргает запись в WB по всем кампаниям и может растянуться) — пропускаем тик, чтобы
    // два прохода не толкали противоречивые решения в одну очередь.
    if (this.runAllInFlight) {
      this.logger.warn("runAll: предыдущий обход ещё идёт — пропускаю тик.");
      return;
    }
    this.runAllInFlight = true;
    try {
      const enabled = await this.repository.listEnabledAutomations();
      let failed = 0;
      for (const a of enabled) {
        await this.evaluateOne(a.advertId, a.nmId, a.mode).catch((e: unknown) => {
          failed += 1;
          this.logger.warn(`Automation pass failed for ${a.advertId}/${a.nmId}: ${String(e)}`);
        });
      }
      // Сводная телеметрия прогона: системную деградацию (истёкший токен, недоступность WB)
      // видно одной строкой, а не только россыпью per-campaign warn'ов.
      if (failed > 0) {
        this.logger.warn(`runAll: обход завершён с ошибками по ${failed}/${enabled.length} кампаниям.`);
      }
    } finally {
      this.runAllInFlight = false;
    }
  }

  /**
   * Считает решения по всем кластерам кампании; в live — применяет к WB. Возвращает решения
   * И maxCpo, чтобы вызывающий (setMode/reviewCluster) собрал статус БЕЗ повторного тяжёлого
   * чтения (getManagedClusterAutomationStates) — это и делает первый показ цифр моментальным.
   */
  async evaluateOne(
    advertId: number,
    nmId: number,
    mode: AutomationMode,
  ): Promise<{ decisions: ClusterDecision[]; maxCpo: number | null }> {
    if (mode === "off") return { decisions: [], maxCpo: null };
    const maxCpo = (await this.productCpoService.getProductCpo(nmId)).maxCpo;
    if (maxCpo == null) return { decisions: [], maxCpo: null }; // нет порога — решать не на чем

    const [inputs, prevStates, roles, baselinedAt] = await Promise.all([
      this.repository.getClusterCpoInputs(advertId, nmId),
      this.repository.getClusterAutomationStates(advertId, nmId),
      this.repository.getClusterOverrideRoles(advertId, nmId),
      this.repository.getCampaignBaselinedAt(advertId, nmId),
    ]);
    const prevByCluster = new Map(prevStates.map((s) => [s.normalizedClusterName, s]));
    // Грандфазер: при ПЕРВОМ прогоне (baseline ещё не зафиксирован) все текущие кластеры
    // считаются уже проверенными (approved). Кластер уходит на ревью (pending) только если
    // baseline уже стоит, а строки состояния у кластера ещё нет → ВБ добавил его позже.
    const isBaselined = baselinedAt !== null;

    // Правило v2 (фаза LEARNING на накопительных счётчиках) — за флагом. WB_CLUSTER_DECISION_V2=1
    // включает v2 в preview (обкатка, WB не трогается); +WB_CLUSTER_DECISION_V2_LIVE=1 — и в live.
    // По умолчанию обе выключены → боевая автоматика на старом правиле (v1, скользящие 30 дней).
    const useV2 =
      process.env.WB_CLUSTER_DECISION_V2 === "1" &&
      (mode === "preview" || process.env.WB_CLUSTER_DECISION_V2_LIVE === "1");
    // ЖИВОЙ накопитель (отстоявшаяся корзина + сегодняшний overlay) — освежается каждые 10 мин;
    // из него И решения вкл/выкл по СРО, И потолок ставки. Флаппинга нет: СРО снижается только от
    // заказа, а выключенный кластер замораживает расход → переключения ограничены частотой заказов
    // (у пограничных малозаказных кластеров — редки). Грузим всегда (нужен и для bid_cap-колонок).
    const accrualByCluster = await this.accrualService.loadCurrentBucketAccrualLive(advertId, nmId);

    const decisions = inputs.map((input) => {
      const prev = prevByCluster.get(input.normalizedClusterName);
      const reviewStatus: ClusterReviewStatus =
        prev?.reviewStatus ?? (isBaselined ? "pending" : "approved");
      const rolesForCluster = {
        isProtected: roles.protectedNames.has(input.normalizedClusterName),
        isBlacklisted: roles.blacklistedNames.has(input.normalizedClusterName),
        reviewStatus,
      };
      if (useV2) {
        const acc = accrualByCluster.get(input.normalizedClusterName);
        return decideForClusterV2(
          {
            normalizedClusterName: input.normalizedClusterName,
            clusterName: input.clusterName,
            currentSourceKind: input.currentSourceKind,
            accruedSpend: acc?.accruedSpend ?? 0,
            accruedOrdersRk: acc?.accruedOrdersRk ?? 0,
            accruedOrdersJam: acc?.accruedOrdersJam ?? 0,
          },
          maxCpo,
          prev,
          mode,
          { ...rolesForCluster, drrHeld: prev?.drrHeld ?? false },
        );
      }
      return decideForCluster(input, maxCpo, prev, mode, rolesForCluster);
    });

    // ADVISORY-рекомендация мусор-фильтра релевантности для pending-кластеров: движок только
    // подписывает «в работу / в чёрный список», решение принимает человек. Pending берём из
    // decisions (у нового кластера строки state ещё нет). См. product-cluster-relevance.ts.
    const pendingNames = new Set(
      decisions.filter((d) => d.reviewStatus === "pending").map((d) => d.normalizedClusterName),
    );
    const ordersByCluster = new Map(
      inputs.map((i) => [
        i.normalizedClusterName,
        { ordersRk: i.shks ?? i.ordersRk, ordersJam: i.ordersJam },
      ]),
    );
    const suggestions = await this.relevanceService.computeForPending(
      advertId,
      nmId,
      pendingNames,
      ordersByCluster,
    );

    // Применяем к WB только в live и только при отличии от текущего состояния.
    // pending-кластеры имеют decision='noop' → applyDecisionsToWb их не трогает. Если гард
    // MAX_EXCLUDE_SHARE заблокировал запись — откатываем заблокированные решения, чтобы БД не
    // разошлась с кабинетом (см. revertBlockedDecisions).
    let applyBlocked = false;
    if (mode === "live") {
      applyBlocked = (
        await applyDecisionsToWb({
          advertId,
          nmId,
          decisions,
          totalClusters: inputs.length,
          maxExcludeShare: MAX_EXCLUDE_SHARE,
          applyAction: (action, names) =>
            this.wbClustersService.applyProductClusterAction(nmId, advertId, action, names, "automation"),
          onBlocked: (message) => this.logger.warn(message),
        })
      ).blocked;
    }
    const decisionsToPersist = applyBlocked
      ? revertBlockedDecisions(decisions, prevByCluster)
      : decisions;

    // Сохраняем состояние (и в preview — для отображения «что бы сделали») ОДНИМ батч-
    // запросом — серийный цикл по ~всем кластерам давал десятки round-trip и тормозил
    // первый показ цифр в панели.
    await this.repository.upsertClusterAutomationStates(
      buildAutomationStateRows({ advertId, nmId, decisions: decisionsToPersist, accrualByCluster, suggestions, maxCpo }),
    );

    // Авто-в-чёрный: pending-кластер содержит слово, выученное менеджером как чёрное по этому
    // товару → в чёрный список без модерации (обучение от действий). Случай «для шиншилл»:
    // менеджер один раз бракнул — новые такие кластеры больше не всплывают. Применяем ПОСЛЕ
    // upsert (перетираем review_status на approved + ставим blacklist-override; следующий
    // прогон увидит роль blacklisted и выключит на WB в live).
    const clusterNameByNcn = new Map(inputs.map((i) => [i.normalizedClusterName, i.clusterName]));
    for (const [ncn, res] of suggestions) {
      if (!res.autoBlacklist) continue;
      await this.repository.setSingleClusterOverride(
        advertId,
        nmId,
        ncn,
        clusterNameByNcn.get(ncn) ?? ncn,
        { isProtected: false, isBlacklisted: true },
      );
      await this.repository.setClusterReviewStatus(advertId, nmId, ncn, "approved");
      this.logger.log(`Авто-чёрный (выучено) ${advertId}/${nmId}: ${ncn}`);
    }

    // Грандфазер завершён: фиксируем baseline, чтобы СЛЕДУЮЩИЕ новые кластеры шли на ревью.
    if (!isBaselined) {
      await this.repository.markCampaignBaselined(advertId, nmId);
    }
    return { decisions: decisionsToPersist, maxCpo };
  }

  /** Статус (как getStatus) из уже посчитанных decisions — без повторного чтения из БД. */
  private buildStatusFromDecisions(
    mode: AutomationMode,
    maxCpo: number | null,
    decisions: ClusterDecision[],
  ): ClusterAutomationStatusResult {
    const clusters = decisions.map((d) => ({
      normalizedClusterName: d.normalizedClusterName,
      state: d.state,
      manualProtected: d.manualProtected,
      lastCpo: d.effectiveCpo,
      lastDecision: d.decision,
      reviewStatus: d.reviewStatus,
    }));
    const pendingCount = clusters.filter((c) => c.reviewStatus === "pending").length;
    return { mode, maxCpo, pendingCount, clusters };
  }

}
