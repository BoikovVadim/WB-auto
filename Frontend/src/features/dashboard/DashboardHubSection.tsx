type DashboardHubSectionProps = {
  onOpenTech: () => void;
  onOpenCabinet: () => void;
};

export function DashboardHubSection({ onOpenTech, onOpenCabinet }: DashboardHubSectionProps) {
  return (
    <div className="wb-dashboard-hub">
      <h2 className="wb-dashboard-hub__title">Дашборд</h2>
      <div className="wb-dashboard-hub__cards">
        <button className="wb-dashboard-hub__card" type="button" onClick={onOpenTech}>
          <span className="wb-dashboard-hub__card-icon">⚙</span>
          <span className="wb-dashboard-hub__card-name">Технический дашборд</span>
          <span className="wb-dashboard-hub__card-desc">
            Расписание всех задач, выгрузок и триггеров проекта по дням и времени
          </span>
        </button>
        <button className="wb-dashboard-hub__card" type="button" onClick={onOpenCabinet}>
          <span className="wb-dashboard-hub__card-icon">📊</span>
          <span className="wb-dashboard-hub__card-name">Дашборд кабинета</span>
          <span className="wb-dashboard-hub__card-desc">
            Сводная аналитика по кабинету WB — в разработке
          </span>
        </button>
      </div>
    </div>
  );
}
