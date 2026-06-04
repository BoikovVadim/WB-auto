import { execFile } from "node:child_process";

/** Нативный баннер macOS (best-effort; на других ОС — no-op). */
export function macNotify(title: string, message: string): void {
  if (process.platform !== "darwin") return;
  const script = `display notification ${JSON.stringify(message)} with title ${JSON.stringify(title)}`;
  execFile("osascript", ["-e", script], () => undefined);
}
