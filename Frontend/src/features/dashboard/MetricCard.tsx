type MetricCardProps = {
  label: string;
  value: string;
};

export function MetricCard(props: MetricCardProps) {
  return (
    <div className="wb-metric-card">
      <span className="wb-metric-card-label">{props.label}</span>
      <strong className="wb-metric-card-value">{props.value}</strong>
    </div>
  );
}
