// Скелетон-каркас таблицы кластеров РК. Переиспользуется и внутри секции таблицы (пока
// грузится таблица), и в воркспейс-пейне (пока грузится сам workspace) — чтобы при холодном
// старте показывать единый каркас вместо текста «Загружаем…», без лишнего переключения.
export function ProductAdvertisingClusterTableSkeleton() {
  return (
    <div className="wb-cluster-skeleton-wrap">
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} className="wb-cluster-skeleton-row">
          <div className="wb-cluster-skeleton-cell wb-cluster-skeleton-cell--wide" />
          <div className="wb-cluster-skeleton-cell" />
          <div className="wb-cluster-skeleton-cell" />
          <div className="wb-cluster-skeleton-cell" />
          <div className="wb-cluster-skeleton-cell" />
          <div className="wb-cluster-skeleton-cell" />
        </div>
      ))}
    </div>
  );
}
