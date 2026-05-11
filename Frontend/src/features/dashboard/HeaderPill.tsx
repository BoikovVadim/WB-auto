export function HeaderPill(props: { label: string; value: string }) {
  return (
    <div className="wb-header-pill">
      <span className="wb-header-pill-label">{props.label}</span>
      <strong className="wb-header-pill-value">{props.value}</strong>
    </div>
  );
}
