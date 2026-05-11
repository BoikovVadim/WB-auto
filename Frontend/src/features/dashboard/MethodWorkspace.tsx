import { useEffect } from "react";

import type { SearchQueriesExportPayload, SearchQueryProduct } from "../../api/syncClient";
import { completeAdvertisingUxBudget } from "./advertising/advertisingUxBudgets";
import { ui } from "./copy";
import { MetricCard } from "./MetricCard";
import { WbRawTableSection } from "./WbRawTableSection";
import { formatMetric, formatNullableNumber } from "./formatters/metrics";

type MethodWorkspaceProps = {
  exportRequestId: string;
  exportedAtLabel: string;
  periodLabel: string;
  rawArchivePath: string | null;
  payload: SearchQueriesExportPayload;
  renderRawTables: boolean;
  selectedProductNmId: number | null;
  onSelectProduct: (value: number) => void;
  selectedProduct: SearchQueryProduct | null;
};

export function MethodWorkspace(props: MethodWorkspaceProps) {
  const rawTables = props.payload.wbTables ?? [];
  const selectedProductSearchTexts = props.selectedProduct?.searchTexts ?? [];

  useEffect(() => {
    completeAdvertisingUxBudget(`method-table:${props.exportRequestId}`);
  }, [props.exportRequestId, props.renderRawTables, rawTables.length, props.payload.products.length]);

  if (rawTables.length > 0) {
    return (
      <div className="wb-export-details">
        <div className="wb-card-header">
          <div>
            <h3>{ui.wbRawTables}</h3>
            <p className="wb-card-meta">{ui.wbRawHint}</p>
          </div>
        </div>

        <div className="wb-mini-grid">
          <MetricCard label={ui.selectedExport} value={props.exportRequestId} />
          <MetricCard label={ui.createdAt} value={props.exportedAtLabel} />
          <MetricCard label={ui.period} value={props.periodLabel} />
          <MetricCard label={ui.rawArchive} value={props.rawArchivePath ?? "-"} />
        </div>

        {props.renderRawTables ? (
          rawTables.map((table) => (
            <WbRawTableSection
              key={table.id}
              table={table}
              cacheKey={`${props.exportRequestId}:${table.id}`}
            />
          ))
        ) : (
          <p className="wb-empty-copy">{ui.loading}</p>
        )}
      </div>
    );
  }

  return (
    <div className="wb-export-details">
      <div className="wb-card-header">
        <div>
          <h3>{ui.exportSummary}</h3>
        </div>
      </div>

      <div className="wb-mini-grid">
        <MetricCard label={ui.selectedExport} value={props.exportRequestId} />
        <MetricCard label={ui.createdAt} value={props.exportedAtLabel} />
        <MetricCard label={ui.period} value={props.periodLabel} />
        <MetricCard label={ui.products} value={String(props.payload.summary.productsCount)} />
        <MetricCard label={ui.searchTexts} value={String(props.payload.summary.searchTextsCount)} />
        <MetricCard label={ui.pagesFetched} value={String(props.payload.summary.sourcePagesFetched)} />
        <MetricCard label={ui.batchesFetched} value={String(props.payload.summary.productBatchesFetched)} />
        <MetricCard label={ui.rawArchive} value={props.rawArchivePath ?? "-"} />
      </div>

      <section className="wb-table-section">
        <div className="wb-card-header">
          <div>
            <h3>{ui.productsTable}</h3>
          </div>
        </div>

        {props.payload.products.length > 0 ? (
          <div className="wb-table-wrap wb-table-wrap--windowed">
            <table className="wb-data-table">
              <thead>
                <tr>
                  <th>nmID</th>
                  <th>{ui.product}</th>
                  <th>{ui.brand}</th>
                  <th>{ui.subject}</th>
                  <th>{ui.vendorCode}</th>
                  <th>{ui.avgPosition}</th>
                  <th>{ui.orders}</th>
                  <th>{ui.openCard}</th>
                  <th>{ui.addToCart}</th>
                  <th>{ui.visibility}</th>
                </tr>
              </thead>
              <tbody>
                {props.payload.products.map((product) => (
                  <tr
                    key={product.nmId}
                    className={props.selectedProductNmId === product.nmId ? "active" : ""}
                    onClick={() => props.onSelectProduct(product.nmId)}
                  >
                    <td className="wb-table-cell--numeric">{String(product.nmId)}</td>
                    <td>{product.name}</td>
                    <td>{product.brandName}</td>
                    <td>{product.subjectName}</td>
                    <td>{product.vendorCode}</td>
                    <td className="wb-table-cell--numeric">{formatMetric(product.avgPosition)}</td>
                    <td className="wb-table-cell--numeric">{formatMetric(product.orders)}</td>
                    <td className="wb-table-cell--numeric">{formatMetric(product.openCard)}</td>
                    <td className="wb-table-cell--numeric">{formatMetric(product.addToCart)}</td>
                    <td className="wb-table-cell--numeric">{formatMetric(product.visibility)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="wb-empty-copy">{ui.noProducts}</p>
        )}
      </section>

      <section className="wb-table-section">
        <div className="wb-card-header">
          <div>
            <h3>{ui.searchTextTable}</h3>
            <p className="wb-card-meta">
              {props.selectedProduct ? props.selectedProduct.name : ui.selectProduct}
            </p>
          </div>
        </div>

        {props.selectedProduct && selectedProductSearchTexts.length > 0 ? (
          <div className="wb-table-wrap wb-table-wrap--windowed">
            <table className="wb-data-table">
              <thead>
                <tr>
                  <th>{ui.searchTexts}</th>
                  <th>{ui.frequency}</th>
                  <th>{ui.weekFrequency}</th>
                  <th>{ui.avgPosition}</th>
                  <th>{ui.orders}</th>
                  <th>{ui.openCard}</th>
                  <th>{ui.addToCart}</th>
                  <th>{ui.openToCart}</th>
                </tr>
              </thead>
              <tbody>
                {selectedProductSearchTexts.map((item, index) => (
                  <tr key={`${props.selectedProduct?.nmId}-${item.text}-${index}`}>
                    <td>{item.text}</td>
                    <td className="wb-table-cell--numeric">
                      {formatNullableNumber(item.frequency)}
                    </td>
                    <td className="wb-table-cell--numeric">
                      {formatNullableNumber(item.weekFrequency)}
                    </td>
                    <td className="wb-table-cell--numeric">{formatMetric(item.avgPosition)}</td>
                    <td className="wb-table-cell--numeric">{formatMetric(item.orders)}</td>
                    <td className="wb-table-cell--numeric">{formatMetric(item.openCard)}</td>
                    <td className="wb-table-cell--numeric">{formatMetric(item.addToCart)}</td>
                    <td className="wb-table-cell--numeric">{formatMetric(item.openToCart)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="wb-empty-copy">
            {props.selectedProduct ? ui.noQueries : ui.selectProduct}
          </p>
        )}
      </section>
    </div>
  );
}
