export interface SafariBridgeResponse {
  ok?: boolean;
  status?: number;
  length?: number;
  base64?: string;
  error?: string;
  stack?: string;
  step?: string;
  fatal?: boolean;
  retryable?: boolean;
  downloadRequested?: boolean;
  downloadHint?: string;
  warnings?: string[];
}

export interface SafariExecutionOptions {
  readyUrlSubstring?: string;
  readyWaitCycles?: number;
  timeoutMs?: number;
}

export interface DownloadedXlsxFile {
  fileName: string;
  absolutePath: string;
  modifiedAt: string;
  workbookBuffer: Buffer;
}
