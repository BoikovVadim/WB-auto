import { useEffect } from "react";

import { warmAllSectionChunks } from "./WbDashboardLazySections";

/**
 * После первого кадра дашборда прогревает в idle все ленивые чанки секций, чтобы первый клик в
 * любой раздел открывался без Suspense-fallback (чанк уже в кэше браузера). Initial paint при
 * этом не страдает — прогрев идёт в requestIdleCallback (или с задержкой, если его нет).
 * Однократно за маунт; import() внутри дедуплицируется.
 */
export function useIdleSectionChunkWarmup(): void {
  useEffect(() => {
    const ric = (
      window as unknown as {
        requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
        cancelIdleCallback?: (handle: number) => void;
      }
    ).requestIdleCallback;
    if (typeof ric === "function") {
      const handle = ric(() => warmAllSectionChunks(), { timeout: 3000 });
      return () => {
        const cancel = (window as unknown as { cancelIdleCallback?: (h: number) => void })
          .cancelIdleCallback;
        if (typeof cancel === "function") cancel(handle);
      };
    }
    // Safari (нет requestIdleCallback) — откладываем таймером, чтобы не конкурировать с paint.
    const timer = window.setTimeout(() => warmAllSectionChunks(), 1500);
    return () => window.clearTimeout(timer);
  }, []);
}
