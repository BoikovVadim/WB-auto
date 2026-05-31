import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface ExecuteAppleScriptOptions {
  timeoutMs: number;
  errorContext: string;
  onStderr?: (message: string) => void;
}

export async function executeAppleScript(
  appleScript: string,
  options: ExecuteAppleScriptOptions,
) {
  try {
    const { stdout, stderr } = await execFileAsync("osascript", ["-e", appleScript], {
      timeout: options.timeoutMs,
      // Батч words-clusters из ~40 РК возвращает base64 на десятки МБ; 12 МБ не хватало
      // ("stdout maxBuffer length exceeded") и прогон падал на середине. 256 МБ с запасом.
      maxBuffer: 256 * 1024 * 1024,
    });

    if (stderr.trim()) {
      options.onStderr?.(stderr.trim());
    }

    return stdout.trim();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${options.errorContext}: ${message}`);
  }
}
