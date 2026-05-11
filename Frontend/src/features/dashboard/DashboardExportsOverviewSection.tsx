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
};

export function DashboardExportsOverviewSection(
  props: DashboardExportsOverviewSectionProps,
) {
  return (
    <>
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

      <section className="wb-card wb-card--wide">
        <div className="wb-card-header">
          <div>
            <h2>{ui.methodsTitle}</h2>
            <p className="wb-card-meta">{ui.methodsText}</p>
          </div>
        </div>

        <div className="wb-method-grid">
          {props.methodCards.map((method) => (
            <MethodCard
              key={method.entityType}
              method={method}
              onPrefetch={() => props.onPrefetchMethod(method.entityType)}
              onOpen={() => void props.onOpenMethod(method.entityType)}
            />
          ))}
        </div>
      </section>
    </>
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
