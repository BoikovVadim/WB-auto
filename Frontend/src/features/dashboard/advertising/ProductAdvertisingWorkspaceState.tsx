type ProductAdvertisingWorkspaceStateProps = {
  title: string;
  message: string;
};

export function ProductAdvertisingWorkspaceState(
  props: ProductAdvertisingWorkspaceStateProps,
) {
  return (
    <div className="wb-product-workspace">
      <div className="wb-product-workspace-state">
        <h3>{props.title}</h3>
        <p className="wb-empty-copy">{props.message}</p>
      </div>
    </div>
  );
}
