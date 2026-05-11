import { DashboardShell } from "./components/DashboardShell";
import { WbDashboard } from "./features/dashboard/WbDashboard";

export default function App() {
  return (
    <DashboardShell>
      <WbDashboard />
    </DashboardShell>
  );
}
