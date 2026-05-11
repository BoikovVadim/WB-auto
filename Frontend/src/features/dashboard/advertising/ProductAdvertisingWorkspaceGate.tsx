import { ProductAdvertisingWorkspaceState } from "./ProductAdvertisingWorkspaceState";
import type { ProductAdvertisingSheetQueryStatus } from "./useProductAdvertisingSheetQuery";

type ProductAdvertisingWorkspaceGateProps = {
  status: ProductAdvertisingSheetQueryStatus;
  title: string;
  message: string;
  errorMessage: string | null;
};

export function ProductAdvertisingWorkspaceGate(
  props: ProductAdvertisingWorkspaceGateProps,
) {
  if (props.status === "bootstrapping" || props.status === "idle") {
    return null;
  }

  if (props.status === "error") {
    return (
      <ProductAdvertisingWorkspaceState
        title={props.title}
        message={props.errorMessage ?? props.message}
      />
    );
  }

  if (props.status === "confirmed-empty") {
    return (
      <ProductAdvertisingWorkspaceState
        title={props.title}
        message={props.message}
      />
    );
  }

  return null;
}
