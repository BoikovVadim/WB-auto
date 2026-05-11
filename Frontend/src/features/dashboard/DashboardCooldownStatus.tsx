import { useEffect, useState, type ReactNode } from "react";

import {
  getMethodCooldownWaitSeconds,
  getMethodStateLabel,
  getMethodStateValue,
} from "./dashboardSectionHelpers";

export function DashboardCooldownStatus(props: {
  nextAvailableAt: string | null;
  children: (input: {
    waitSeconds: number;
    label: string;
    value: string;
  }) => ReactNode;
}) {
  const [nowTick, setNowTick] = useState(0);
  void nowTick;

  const waitSeconds = getMethodCooldownWaitSeconds(props.nextAvailableAt);
  useEffect(() => {
    if (waitSeconds <= 0) {
      return;
    }

    const intervalId = window.setInterval(() => {
      setNowTick((currentValue) => currentValue + 1);
    }, 1_000);
    return () => window.clearInterval(intervalId);
  }, [waitSeconds]);

  return props.children({
    waitSeconds,
    label: getMethodStateLabel(waitSeconds),
    value: getMethodStateValue(waitSeconds),
  });
}
