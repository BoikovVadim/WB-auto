// Транзиентный сбой сетевого запроса (типичный — 502 в окне рестарта бэкенда после
// деплоя) не должен «сдаваться» навсегда и оставлять UI в пустом состоянии до ручного
// F5. Этот хелпер ретраит асинхронную операцию с экспоненциальным backoff; дефолты
// (8 попыток, 2s→30s) суммарно покрывают ~2-минутное окно деплоя — те же параметры,
// что у ретрая загрузки каталога (см. useDashboardProductCatalog).

export type RetryWithBackoffOptions = {
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** Решает, стоит ли ретраить данную ошибку. По умолчанию — ретраим любую. */
  shouldRetry?: (error: unknown, attempt: number) => boolean;
};

const DEFAULT_MAX_RETRIES = 8;
const DEFAULT_BASE_DELAY_MS = 2_000;
const DEFAULT_MAX_DELAY_MS = 30_000;

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

export async function retryWithBackoff<T>(
  operation: () => Promise<T>,
  options: RetryWithBackoffOptions = {},
): Promise<T> {
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  const baseDelayMs = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const maxDelayMs = options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
  const shouldRetry = options.shouldRetry ?? (() => true);

  let attempt = 0;
  for (;;) {
    try {
      return await operation();
    } catch (error) {
      if (attempt >= maxRetries || !shouldRetry(error, attempt)) {
        throw error;
      }
      const waitMs = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt);
      attempt += 1;
      await delay(waitMs);
    }
  }
}
