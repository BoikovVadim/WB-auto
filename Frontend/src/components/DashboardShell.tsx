import type { PropsWithChildren } from "react";

export function DashboardShell({ children }: PropsWithChildren) {
  return (
    <div className="wb-shell">
      <div className="wb-shell-inner">
        {children}
      </div>
    </div>
  );
}
