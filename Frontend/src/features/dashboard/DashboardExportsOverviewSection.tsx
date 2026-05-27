import type {
  ExportMethodStatus,
  HealthResponse,
  IntegrationStatusResponse,
  TokenSessionResponse,
} from "../../api/syncClient";
import { ui } from "./copy";
import {
  formatDateTime,
  translateTokenSource,
} from "./dashboardSectionHelpers";
import { DashboardCooldownStatus } from "./DashboardCooldownStatus";
import { MetricCard } from "./MetricCard";

type DashboardExportsOverviewSectionProps = {
  health: HealthResponse | null;
  integrationStatus: IntegrationStatusResponse | null;
  tokenSession: TokenSessionResponse | null;
  methodCards: ExportMethodStatus[];
  tokenInput: string;
  isTokenSaving: boolean;
  onTokenInputChange: (value: string) => void;
  onSaveToken: () => void | Promise<void>;
  onClearToken: () => void | Promise<void>;
  onOpenMethod: (entityType: ExportMethodStatus["entityType"]) => void | Promise<void>;
  onPrefetchMethod: (entityType: ExportMethodStatus["entityType"]) => void;
  onOpenJam: () => void;
  onOpenCatalog: () => void;
  onOpenCampaigns: () => void;
  onOpenSyncRuns: () => void;
  onOpenClusterStats: () => void;
  onOpenDailyStats: () => void;
  onOpenMinusPhrases: () => void;
  onOpenQueryFrequencies: () => void;
  onOpenOrders: () => void;
};

export function DashboardExportsOverviewSection(
  props: DashboardExportsOverviewSectionProps,
) {
  return (
    <div className="wb-exports-scroll">
      <section className="wb-hero">
        <div className="wb-hero-kicker">{ui.badge}</div>
        <h1>{ui.title}</h1>
        <p>{ui.subtitle}</p>
        <div className="wb-hero-stats">
          <HeroStat
            value={props.health?.status === "ok" ? ui.online : ui.offline}
            label={ui.backendStatus}
          />
          <HeroStat
            value={props.integrationStatus?.tokenConfigured ? ui.ready : ui.notReady}
            label={ui.integrationReady}
          />
          <HeroStat
            value={props.tokenSession?.tokenConfigured ? ui.connected : ui.notSet}
            label={ui.tokenStatus}
          />
          <HeroStat value={String(props.methodCards.length)} label={ui.methodsCount} />
        </div>
      </section>

      <section className="wb-card wb-card--accent">
        <div className="wb-card-header">
          <div>
            <h2>{ui.tokenTitle}</h2>
            <p className="wb-card-meta">{ui.tokenText}</p>
          </div>
          <div className="wb-inline-badges">
            <span className="wb-chip">
              {translateTokenSource(props.tokenSession?.tokenSource ?? "missing")}
            </span>
          </div>
        </div>

        <div className="wb-form-row">
          <input
            className="wb-input"
            type="password"
            value={props.tokenInput}
            onChange={(event) => props.onTokenInputChange(event.target.value)}
            placeholder={ui.tokenPlaceholder}
          />
        </div>

        <div className="wb-action-row">
          <button
            className="wb-primary-button"
            disabled={props.isTokenSaving}
            onClick={() => void props.onSaveToken()}
          >
            {props.isTokenSaving ? ui.savingToken : ui.saveToken}
          </button>
          <button
            className="wb-secondary-button"
            disabled={props.isTokenSaving}
            onClick={() => void props.onClearToken()}
          >
            {ui.clearToken}
          </button>
        </div>

        <div className="wb-mini-grid">
          <MetricCard
            label={ui.tokenStatus}
            value={props.tokenSession?.tokenConfigured ? ui.connected : ui.notSet}
          />
          <MetricCard
            label={ui.tokenMetaSource}
            value={translateTokenSource(props.tokenSession?.tokenSource ?? "missing")}
          />
          <MetricCard
            label={ui.tokenMetaChecked}
            value={
              props.tokenSession?.updatedAt
                ? formatDateTime(props.tokenSession.updatedAt)
                : "-"
            }
          />
        </div>
      </section>

      {/* WB API — разовые выгрузки */}
      <DataSection title="WB API — разовые выгрузки" description="Запрос к WB Analytics API, результат сохраняется в архив">
        {props.methodCards.map((method) => (
          <MethodCard
            key={method.entityType}
            method={method}
            onPrefetch={() => props.onPrefetchMethod(method.entityType)}
            onOpen={() => void props.onOpenMethod(method.entityType)}
          />
        ))}
      </DataSection>

      {/* Поисковые данные */}
      <DataSection title="Поисковые данные" description="Накопленные данные по поисковым фразам из WB Analytics">
        <DataCard
          title="JAM — поисковые запросы"
          description="30 дней поисковых фраз по каждому товару, накапливается ежедневно"
          chip="Analytics"
          rows={[
            { label: "Расписание", value: "ежедневно 06:00 МСК" },
            { label: "Хранение", value: "бессрочно" },
            { label: "Вариантов", value: "клики + заказы" },
          ]}
          buttonLabel="Открыть данные"
          onOpen={props.onOpenJam}
        />
        <DataCard
          title="Частоты поисковых запросов"
          description="Еженедельные частоты по поисковым фразам из отчёта WB Analytics (seller portal)"
          chip="Analytics"
          rows={[
            { label: "Таблица", value: "wb_search_query_frequencies" },
            { label: "Обновление", value: "еженедельно (воскресенье 07:00 МСК)" },
            { label: "Покрытие", value: "49 предметов · скользящий месяц" },
          ]}
          buttonLabel="Открыть данные"
          onOpen={props.onOpenQueryFrequencies}
        />
        <DataCard
          title="История частот (ретроспектива)"
          description="Еженедельные снимки частот — для анализа динамики и трендов от недели к неделе"
          chip="Analytics"
          rows={[
            { label: "Таблица", value: "wb_query_frequency_history" },
            { label: "Снимки", value: "еженедельно, автоматически" },
            { label: "Хранение", value: "бессрочно" },
          ]}
          buttonLabel="Скоро"
          onOpen={null}
        />
      </DataSection>

      {/* Товары и каталог */}
      <DataSection title="Товары и каталог" description="Справочные данные о товарах, синхронизируются с WB ежедневно">
        <DataCard
          title="Каталог товаров"
          description="Список всех товаров: артикул, nmId, название, бренд, предмет"
          chip="Content API"
          rows={[
            { label: "Таблица", value: "wb_product_catalog" },
            { label: "Обновление", value: "ежедневно 07:00 МСК" },
            { label: "Хранение", value: "бессрочно" },
          ]}
          buttonLabel="Открыть каталог"
          onOpen={props.onOpenCatalog}
        />
        <DataCard
          title="Рекламные кампании"
          description="Все кампании в WB: тип, статус, бюджет, даты, привязанные товары"
          chip="Promotion API"
          rows={[
            { label: "Таблица", value: "wb_campaigns" },
            { label: "Обновление", value: "каждые 10 мин" },
            { label: "Хранение", value: "бессрочно" },
          ]}
          buttonLabel="Открыть данные"
          onOpen={props.onOpenCampaigns}
        />
        <DataCard
          title="Заказы по товарам"
          description="Агрегированные заказы по nmId и дате за последние 7 дней из WB Statistics API"
          chip="Statistics API"
          rows={[
            { label: "Таблица", value: "wb_product_daily_orders" },
            { label: "Обновление", value: "каждые 30 мин" },
            { label: "Хранение", value: "скользящие 7 дней" },
            { label: "Лимит WB", value: "1 запрос / мин" },
          ]}
          buttonLabel="Открыть данные"
          onOpen={props.onOpenOrders}
        />
      </DataSection>

      {/* Кластеры и статистика */}
      <DataSection title="Кластеры и статистика" description="Рекламные кластеры, ставки и показатели эффективности">
        <DataCard
          title="Кластеры рекламы"
          description="Именованные кластеры по товарам и кампаниям с агрегированной статистикой"
          chip="Promotion API"
          rows={[
            { label: "Таблица", value: "wb_clusters + wb_cluster_stats" },
            { label: "Обновление", value: "каждые 10 мин" },
            { label: "Хранение", value: "бессрочно" },
          ]}
          buttonLabel="Открыть данные"
          onOpen={props.onOpenClusterStats}
        />
        <DataCard
          title="Дневная статистика кластеров"
          description="Показатели по дням: показы, заказы, корзина, ставки, расход"
          chip="Promotion API"
          rows={[
            { label: "Таблица", value: "wb_cluster_daily_stats" },
            { label: "Обновление", value: "каждые 10 мин" },
            { label: "Хранение", value: "бессрочно" },
          ]}
          buttonLabel="Открыть данные"
          onOpen={props.onOpenDailyStats}
        />
        <DataCard
          title="Минус-фразы"
          description="Отрицательные ключевые слова по кампаниям и товарам"
          chip="Promotion API"
          rows={[
            { label: "Таблица", value: "wb_campaign_minus_phrases" },
            { label: "Обновление", value: "каждые 10 мин" },
            { label: "Хранение", value: "бессрочно" },
          ]}
          buttonLabel="Открыть данные"
          onOpen={props.onOpenMinusPhrases}
        />
        <DataCard
          title="Запросы → кластер"
          description="Маппинг поисковых запросов к кластерам из Promotion API и личного кабинета"
          chip="Promotion API"
          rows={[
            { label: "Таблицы", value: "wb_cluster_queries" },
            { label: "Обновление", value: "каждые 10 мин" },
            { label: "Хранение", value: "бессрочно" },
          ]}
          buttonLabel="Скоро"
          onOpen={null}
        />
      </DataSection>

      {/* Системные данные */}
      <DataSection title="Системные данные" description="Журналы синхронизации и технические данные">
        <DataCard
          title="Прогоны синхронизации"
          description="История синхронизаций с WB: статусы, счётчики, ошибки, временны́е метки"
          chip="Внутренние"
          rows={[
            { label: "Таблица", value: "wb_cluster_sync_runs" },
            { label: "Обновление", value: "каждые 10 мин" },
            { label: "Хранение", value: "бессрочно" },
          ]}
          buttonLabel="Открыть данные"
          onOpen={props.onOpenSyncRuns}
        />
        <DataCard
          title="Сырые архивы WB"
          description="Raw JSON-ответы от WB API до нормализации (для отладки и аудита)"
          chip="Внутренние"
          rows={[
            { label: "Таблица", value: "wb_cluster_raw_archive" },
            { label: "Прунинг", value: "старше 14 дней" },
            { label: "Хранение", value: "14 дней" },
          ]}
          buttonLabel="Скоро"
          onOpen={null}
        />
      </DataSection>
    </div>
  );
}

function HeroStat(props: { value: string; label: string }) {
  return (
    <div className="wb-hero-stat">
      <span className="wb-hero-stat-value">{props.value}</span>
      <span className="wb-hero-stat-label">{props.label}</span>
    </div>
  );
}

function DataSection(props: { title: string; description: string; children: React.ReactNode }) {
  return (
    <section className="wb-card" style={{ padding: "clamp(12px, 1vw, 16px)" }}>
      <div className="wb-card-header">
        <div>
          <h2>{props.title}</h2>
          <p className="wb-card-meta">{props.description}</p>
        </div>
      </div>
      <div className="wb-method-grid">{props.children}</div>
    </section>
  );
}

function DataCard(props: {
  title: string;
  description: string;
  chip: string;
  rows: { label: string; value: string }[];
  buttonLabel: string;
  onOpen: (() => void) | null;
}) {
  return (
    <div className="wb-method-card">
      <div className="wb-card-header">
        <div>
          <h3>{props.title}</h3>
          <p className="wb-card-meta">{props.description}</p>
        </div>
        <div className="wb-inline-badges">
          <span className="wb-chip">{props.chip}</span>
        </div>
      </div>

      <div className="wb-method-card-details">
        {props.rows.map((row) => (
          <div key={row.label} className="wb-method-card-row">
            <span className="wb-method-card-label">{row.label}</span>
            <strong className="wb-method-card-value">{row.value}</strong>
          </div>
        ))}
      </div>

      <div className="wb-action-row">
        <button
          className="wb-primary-button"
          onClick={props.onOpen ?? undefined}
          disabled={props.onOpen === null}
          style={props.onOpen === null ? { opacity: 0.45, cursor: "not-allowed" } : undefined}
        >
          {props.buttonLabel}
        </button>
      </div>
    </div>
  );
}

function MethodCard(props: {
  method: ExportMethodStatus;
  onPrefetch: () => void;
  onOpen: () => void;
}) {
  return (
    <div
      className="wb-method-card"
      onMouseEnter={props.onPrefetch}
      onFocus={props.onPrefetch}
    >
      <div className="wb-card-header">
        <div>
          <h3>{props.method.title}</h3>
          <p className="wb-card-meta">{props.method.description}</p>
        </div>
        <div className="wb-inline-badges">
          <span className="wb-chip">{props.method.tokenCategory}</span>
        </div>
      </div>

      <div className="wb-method-card-details">
        <DashboardCooldownStatus nextAvailableAt={props.method.cooldown.nextAvailableAt}>
          {({ label, value }) => (
            <div className="wb-method-card-row">
              <span className="wb-method-card-label">{label}</span>
              <strong className="wb-method-card-value">{value}</strong>
            </div>
          )}
        </DashboardCooldownStatus>
        <div className="wb-method-card-row">
          <span className="wb-method-card-label">{ui.lastSuccess}</span>
          <strong className="wb-method-card-value">
            {props.method.lastSuccessAt ? formatDateTime(props.method.lastSuccessAt) : "-"}
          </strong>
        </div>
        <div className="wb-method-card-row">
          <span className="wb-method-card-label">{ui.lastError}</span>
          <strong className="wb-method-card-value">
            {props.method.lastErrorMessage ?? "-"}
          </strong>
        </div>
      </div>

      <div className="wb-action-row">
        <button className="wb-primary-button" onClick={props.onOpen}>
          {ui.openMethod}
        </button>
      </div>
    </div>
  );
}
