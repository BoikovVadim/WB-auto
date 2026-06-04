import { Injectable, Logger } from "@nestjs/common";

import { ProductCpoService } from "./product-cpo.service";
import type {
  AutomationMode,
  ClusterAutomationStateValue,
  ClusterCpoInput,
  ClusterOverrideItem,
  ClusterOverridePickerRow,
} from "./wb-clusters.repository.automation";
import { WbClustersRepository } from "./wb-clusters.repository";
import { WbClustersService } from "./wb-clusters.service";

/** Доля кластеров, выше которой массовое авто-исключение блокируется (защита от обнуления РК). */
const MAX_EXCLUDE_SHARE = 0.8;

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

interface ClusterDecision {
  normalizedClusterName: string;
  clusterName: string;
  effectiveCpo: number | null;
  /** Расход кластера за окно — для отображения «стоимости» там, где CPO неопределён (нет заказов). */
  spend: number | null;
  state: ClusterAutomationStateValue;
  manualProtected: boolean;
  /** Действие относительно текущего состояния на WB. */
  decision: "include" | "exclude" | "noop";
}

/**
 * Автоматизация управления кластерами по CPO. Каждые 10 минут для кампаний с включённой
 * автоматизацией пересчитывает CPO каждого кластера и приводит состав к правилу
 * «CPO ≤ макс. CPO товара → включить, CPO > макс → исключить».
 *
 * CPO кластера берётся РОВНО как значение колонки «СРО» таблицы РК (никаких отдельных
 * расчётов): spend / (shks ?? orders_РК) за скользящие 30 дней; при 0 заказов колонка
 * показывает сам расход — его и сравниваем. JAM в CPO-колонке не участвует. Правило:
 * значение ≤ макс. CPO → включить, > макс → исключить — независимо от наличия заказов
 * (если «сумма» ниже плана, кластер должен работать). Нет расхода вовсе → кандидат в
 * активные (сигнала против нет). Исход «выбыл» (dropped) не назначается.
 *
 * Режимы: 'preview' — считаем и сохраняем решения, WB НЕ трогаем; 'live' — реально
 * включаем/исключаем через существующую очередь действий (applyProductClusterAction).
 */
@Injectable()
export class ProductClusterAutomationService {
  private readonly logger = new Logger("ProductClusterAutomation");

  constructor(
    private readonly repository: WbClustersRepository,
    private readonly wbClustersService: WbClustersService,
    private readonly productCpoService: ProductCpoService,
  ) {}

  async setMode(advertId: number, nmId: number, mode: AutomationMode): Promise<void> {
    await this.repository.setAutomationMode(advertId, nmId, mode);
    // Сразу один прогон, чтобы решения появились без ожидания крона (preview — без записи в WB).
    if (mode !== "off") {
      await this.evaluateOne(advertId, nmId, mode).catch((e: unknown) => {
        this.logger.warn(`Initial automation pass failed for ${advertId}/${nmId}: ${String(e)}`);
      });
    }
  }

  /** Статус автоматизации + per-cluster решения (для UI рекламного воркспейса). */
  async getStatus(advertId: number, nmId: number): Promise<{
    mode: AutomationMode;
    maxCpo: number | null;
    clusters: {
      normalizedClusterName: string;
      state: ClusterAutomationStateValue;
      manualProtected: boolean;
      lastCpo: number | null;
      lastDecision: string | null;
    }[];
  }> {
    const [mode, productCpo, states] = await Promise.all([
      this.repository.getAutomationMode(advertId, nmId),
      this.productCpoService.getProductCpo(nmId),
      // Только управляемые сейчас кластеры — чтобы счётчики «актив/искл/выбыло»
      // сходились с «Все N» таблицы РК (исторические строки state не считаем).
      this.repository.getManagedClusterAutomationStates(advertId, nmId),
    ]);
    return { mode, maxCpo: productCpo.maxCpo, clusters: states };
  }

  /** Read-model для модалки «Настройка фильтров»: список кластеров + защита. */
  async getFilterConfig(advertId: number, nmId: number): Promise<{
    clusters: ClusterOverridePickerRow[];
  }> {
    const clusters = await this.repository.getClusterOverridePicker(advertId, nmId);
    return { clusters };
  }

  /**
   * Сводный статус автоматизации по всем товарам с включённой автоматизацией — для колонки
   * в таблице товаров (понять, у кого включено). byNmId: nmId → режим товара + число кампаний.
   * Товары без автоматизации в карте отсутствуют (фронт трактует как "off").
   */
  async getProductAutomationStatuses(): Promise<{
    byNmId: Record<number, { mode: AutomationMode; campaignsWithAutomation: number }>;
  }> {
    const rows = await this.repository.getProductAutomationModes();
    const byNmId: Record<number, { mode: AutomationMode; campaignsWithAutomation: number }> = {};
    for (const r of rows) {
      byNmId[r.nmId] = { mode: r.mode, campaignsWithAutomation: r.campaignsWithAutomation };
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
    counts: { active: number; blacklisted: number; high: number };
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
            (x) => x.state === "active" || x.state === "manual_protected" || x.state === "protected",
          ).length,
          blacklisted: status.clusters.filter((x) => x.state === "blacklisted").length,
          high: status.clusters.filter((x) => x.state === "excluded_high").length,
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
      }),
      { active: 0, blacklisted: 0, high: 0 },
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
    counts: { active: number; blacklisted: number; high: number };
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
    const enabled = await this.repository.listEnabledAutomations();
    for (const a of enabled) {
      await this.evaluateOne(a.advertId, a.nmId, a.mode).catch((e: unknown) => {
        this.logger.warn(`Automation pass failed for ${a.advertId}/${a.nmId}: ${String(e)}`);
      });
    }
  }

  /** Считает решения по всем кластерам кампании; в live — применяет к WB. */
  async evaluateOne(advertId: number, nmId: number, mode: AutomationMode): Promise<ClusterDecision[]> {
    if (mode === "off") return [];
    const maxCpo = (await this.productCpoService.getProductCpo(nmId)).maxCpo;
    if (maxCpo == null) return []; // нет порога (нет цены/выкупа/ДРР) — решать не на чем

    const [inputs, prevStates, roles] = await Promise.all([
      this.repository.getClusterCpoInputs(advertId, nmId),
      this.repository.getClusterAutomationStates(advertId, nmId),
      this.repository.getClusterOverrideRoles(advertId, nmId),
    ]);
    const prevByCluster = new Map(prevStates.map((s) => [s.normalizedClusterName, s]));

    const decisions = inputs.map((input) =>
      this.decideForCluster(input, maxCpo, prevByCluster.get(input.normalizedClusterName), mode, {
        isProtected: roles.protectedNames.has(input.normalizedClusterName),
        isBlacklisted: roles.blacklistedNames.has(input.normalizedClusterName),
      }),
    );

    // Применяем к WB только в live и только при отличии от текущего состояния.
    if (mode === "live") {
      await this.applyDecisions(advertId, nmId, decisions, inputs.length);
    }

    // Сохраняем состояние (и в preview — для отображения «что бы сделали»).
    for (const d of decisions) {
      await this.repository.upsertClusterAutomationState({
        advertId,
        nmId,
        normalizedClusterName: d.normalizedClusterName,
        state: d.state,
        manualProtected: d.manualProtected,
        lastCpo: d.effectiveCpo,
        lastSpend: d.spend,
        lastDecision: d.decision,
      });
    }
    return decisions;
  }

  private decideForCluster(
    input: ClusterCpoInput,
    maxCpo: number,
    prev: { state: ClusterAutomationStateValue; manualProtected: boolean; lastDecision: string | null } | undefined,
    mode: AutomationMode,
    roles: { isProtected: boolean; isBlacklisted: boolean },
  ): ClusterDecision {
    const isExcludedNow = input.currentSourceKind === "excluded";
    // Знаменатель CPO = max(заказы РК, джем-заказы): даём кластеру «зачёт» за
    // органические/джемовые заказы. РК-часть — заказанные товары shks, если есть,
    // иначе заказы РК. JAM = 0 при отсутствии, тогда max сводится к РК-части.
    // Та же формула в колонке «СРО» таблицы (getAdvertisingCpoOrderedItems на фронте).
    const rkOrdered = input.shks !== null ? input.shks : input.ordersRk;
    const orderedItems = Math.max(rkOrdered, input.ordersJam);
    // «CPO» = ровно getAdvertisingCpoOrSpend: есть заказы → расход/заказы; нет заказов,
    // но есть расход → показываем расход (это и есть «сумма» в колонке); нет расхода → null.
    const displayCpo =
      orderedItems > 0 ? input.spend / orderedItems : input.spend > 0 ? input.spend : null;
    const effectiveCpoForDisplay = displayCpo != null ? round2(displayCpo) : null;

    // Чёрный список — наивысший приоритет: кластер никогда не должен быть включён.
    // Если сейчас активен на WB — исключаем; иначе noop.
    if (roles.isBlacklisted) {
      return {
        normalizedClusterName: input.normalizedClusterName,
        clusterName: input.clusterName,
        effectiveCpo: effectiveCpoForDisplay,
        spend: input.spend,
        state: "blacklisted",
        manualProtected: false,
        decision: isExcludedNow ? "noop" : "exclude",
      };
    }

    // Белый список — приоритет над CPO-правилом: кластер всегда активен. Если сейчас
    // исключён на WB — включаем; иначе noop. CPO считаем только для отображения.
    if (roles.isProtected) {
      return {
        normalizedClusterName: input.normalizedClusterName,
        clusterName: input.clusterName,
        effectiveCpo: effectiveCpoForDisplay,
        spend: input.spend,
        state: "protected",
        manualProtected: false,
        decision: isExcludedNow ? "include" : "noop",
      };
    }

    // Ручная защита: в live, если кластер сейчас активен, а автоматика в прошлый прогон
    // его исключала — значит сотрудник вернул вручную → иммунитет к выбыванию по «нет данных».
    let manualProtected = prev?.manualProtected ?? false;
    if (mode === "live" && !isExcludedNow && prev?.lastDecision === "exclude") {
      manualProtected = true;
    }

    // Решение РОВНО по числу из колонки «СРО»: ≤ макс. CPO товара → кластер работает
    // (включить), > макс → исключить. Есть заказы или нет — неважно: важно само значение
    // в колонке (при 0 заказов это расход = «сумма»). Если расхода вовсе нет
    // (displayCpo=null) → сигнала против нет → кандидат в активные.
    let desiredActive: boolean;
    let state: ClusterAutomationStateValue;
    if (displayCpo === null) {
      desiredActive = true;
      state = manualProtected ? "manual_protected" : "active";
    } else if (displayCpo <= maxCpo) {
      desiredActive = true;
      state = "active";
      manualProtected = false; // CPO в пределах плана — защита не нужна
    } else {
      desiredActive = false;
      state = "excluded_high";
      manualProtected = false; // авто-исключение по CPO сильнее ручной защиты
    }

    let decision: ClusterDecision["decision"] = "noop";
    if (desiredActive && isExcludedNow) decision = "include";
    else if (!desiredActive && !isExcludedNow) decision = "exclude";

    return {
      normalizedClusterName: input.normalizedClusterName,
      clusterName: input.clusterName,
      effectiveCpo: effectiveCpoForDisplay,
      spend: input.spend,
      state,
      manualProtected,
      decision,
    };
  }

  private async applyDecisions(
    advertId: number,
    nmId: number,
    decisions: ClusterDecision[],
    totalClusters: number,
  ): Promise<void> {
    const toExclude = decisions.filter((d) => d.decision === "exclude");
    const toInclude = decisions.filter((d) => d.decision === "include");

    // Гард: не исключать разом почти всё (защита от обнуления кампании).
    if (totalClusters > 0 && toExclude.length / totalClusters > MAX_EXCLUDE_SHARE) {
      this.logger.warn(
        `Automation ${advertId}/${nmId}: исключение ${toExclude.length}/${totalClusters} кластеров превышает порог ${MAX_EXCLUDE_SHARE * 100}% — пропускаю запись на WB.`,
      );
      return;
    }

    if (toExclude.length > 0) {
      await this.wbClustersService.applyProductClusterAction(
        nmId,
        advertId,
        "exclude",
        toExclude.map((d) => d.clusterName),
        "automation",
      );
    }
    if (toInclude.length > 0) {
      await this.wbClustersService.applyProductClusterAction(
        nmId,
        advertId,
        "include",
        toInclude.map((d) => d.clusterName),
        "automation",
      );
    }
  }
}
