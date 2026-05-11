import type { SafariExecutionOptions } from "./wb-cmp-safari.client.types";

interface RunAppleScriptOptions {
  timeoutMs: number;
}

interface ReusableSafariWindowRunnerDeps {
  defaultTimeoutMs: number;
  runAppleScript: (
    appleScript: string,
    options: RunAppleScriptOptions,
  ) => Promise<string>;
}

interface ReusableWindowScriptInput {
  targetUrl: string;
  browserScript: string;
  readyUrlSubstring: string;
  readyWaitCycles: number;
  timeoutMs: number;
}

export class ReusableSafariWindowRunner {
  private reusableWindowId: number | null = null;

  constructor(private readonly deps: ReusableSafariWindowRunnerDeps) {}

  async run(
    targetUrl: string,
    browserScript: string,
    options: SafariExecutionOptions = {},
  ) {
    const readyUrlSubstring = options.readyUrlSubstring ?? new URL(targetUrl).host;
    const readyWaitCycles = options.readyWaitCycles ?? 240;
    const timeoutMs = options.timeoutMs ?? this.deps.defaultTimeoutMs;

    try {
      return await this.runInternal({
        targetUrl,
        browserScript,
        readyUrlSubstring,
        readyWaitCycles,
        timeoutMs,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!isReusableWindowFailure(message)) {
        throw error;
      }

      this.reusableWindowId = null;
      return this.runInternal({
        targetUrl,
        browserScript,
        readyUrlSubstring,
        readyWaitCycles,
        timeoutMs,
      });
    }
  }

  private async runInternal(input: ReusableWindowScriptInput) {
    const windowId = await this.ensureWindow(input.targetUrl, input.timeoutMs);
    await this.navigateWindow({
      windowId,
      targetUrl: input.targetUrl,
      readyUrlSubstring: input.readyUrlSubstring,
      readyWaitCycles: input.readyWaitCycles,
      timeoutMs: input.timeoutMs,
    });
    return this.executeJavaScript(windowId, input.browserScript, input.timeoutMs);
  }

  private async ensureWindow(targetUrl: string, timeoutMs: number) {
    const appleScript = `
      set targetUrl to ${JSON.stringify(targetUrl)}
      set reuseWindowId to ${this.reusableWindowId === null ? "missing value" : this.reusableWindowId}

      tell application "Safari"
        if reuseWindowId is not missing value then
          try
            set targetWindow to window id reuseWindowId
            return id of targetWindow
          on error
          end try
        end if

        make new document with properties {URL:targetUrl}
        delay 0.2
        set targetWindow to front window
        return id of targetWindow
      end tell
    `;

    const rawWindowId = await this.deps.runAppleScript(appleScript, { timeoutMs });
    const windowId = Number.parseInt(rawWindowId, 10);
    if (!Number.isInteger(windowId)) {
      throw new Error(
        `Safari bridge returned an invalid reusable window id: ${rawWindowId}`,
      );
    }

    this.reusableWindowId = windowId;
    return windowId;
  }

  private async navigateWindow(input: {
    windowId: number;
    targetUrl: string;
    readyUrlSubstring: string;
    readyWaitCycles: number;
    timeoutMs: number;
  }) {
    const appleScript = `
      set targetUrl to ${JSON.stringify(input.targetUrl)}
      set readyUrlSubstring to ${JSON.stringify(input.readyUrlSubstring)}
      set readyWaitCycles to ${input.readyWaitCycles}
      set safariWindowId to ${input.windowId}

      tell application "Safari"
        set targetWindow to window id safariWindowId
        set URL of current tab of targetWindow to targetUrl
        delay 0.2

        repeat readyWaitCycles times
          try
            set pageState to do JavaScript "JSON.stringify({href: location.href, readyState: document.readyState})" in current tab of targetWindow
            if pageState is not "" then
              set hrefReady to pageState contains readyUrlSubstring
              set loadReady to pageState contains "\\"readyState\\":\\"complete\\""
              if hrefReady and loadReady then
                return "ready"
              end if
            end if
          on error
          end try
          delay 0.25
        end repeat

        repeat 20 times
          try
            set currentHref to do JavaScript "location.href" in current tab of targetWindow
            if currentHref contains readyUrlSubstring then
              return "ready"
            end if
          on error
          end try
          delay 0.25
        end repeat

        error "Reusable Safari window did not reach the expected page state."
      end tell
    `;

    await this.deps.runAppleScript(appleScript, { timeoutMs: input.timeoutMs });
  }

  private executeJavaScript(
    windowId: number,
    browserScript: string,
    timeoutMs: number,
  ) {
    const appleScript = `
      set browserScript to ${JSON.stringify(browserScript)}
      set safariWindowId to ${windowId}

      tell application "Safari"
        set targetWindow to window id safariWindowId
        return do JavaScript browserScript in current tab of targetWindow
      end tell
    `;

    return this.deps.runAppleScript(appleScript, { timeoutMs });
  }
}

function isReusableWindowFailure(message: string) {
  const normalized = message.toLocaleLowerCase("en");
  return (
    normalized.includes("window id") ||
    normalized.includes("can’t get window") ||
    normalized.includes("can't get window") ||
    normalized.includes("invalid index") ||
    normalized.includes("current tab") ||
    normalized.includes("expected page state")
  );
}
