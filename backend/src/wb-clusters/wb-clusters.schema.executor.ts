import type { WbClustersSchemaContext } from "./wb-clusters.schema.types";

/** PostgreSQL SQLSTATE для отмены по lock_timeout (lock_not_available). */
const LOCK_TIMEOUT_SQLSTATE = "55P03";

export async function executeSchemaStatements(
  context: WbClustersSchemaContext,
  statements: readonly string[],
  options?: {
    /** Ограничить ожидание блокировки (мс). DDL на hot-таблице под параллельным импортом
     *  иначе ждёт ACCESS EXCLUSIVE до statement_timeout (5 мин) и вешает весь ensureSchema. */
    lockTimeoutMs?: number;
    /** Пропускать (а не падать) statement, отменённый по lock_timeout. Безопасно ТОЛЬКО для
     *  идемпотентного `IF NOT EXISTS` DDL: пропущенное применится на следующем старте без
     *  контенции; в установившемся состоянии объект уже существует, и DDL — no-op. */
    tolerateLockTimeout?: boolean;
  },
) {
  if (statements.length === 0) {
    return;
  }

  // Один выделенный клиент на весь батч: lock_timeout — сессионная настройка, а pool.query
  // мог бы раскидать statements по разным соединениям, где SET не действует.
  const client = await context.pool.connect();
  try {
    if (options?.lockTimeoutMs != null) {
      await client.query(`SET lock_timeout = ${Math.trunc(options.lockTimeoutMs)}`);
    }
    for (const statement of statements) {
      try {
        await client.query(statement);
      } catch (error) {
        const code = (error as { code?: string }).code;
        if (options?.tolerateLockTimeout && code === LOCK_TIMEOUT_SQLSTATE) {
          continue;
        }
        throw error;
      }
    }
  } finally {
    client.release();
  }
}

export async function ensureWbClustersSchema(
  context: WbClustersSchemaContext,
) {
  await context.pool.query(
    `CREATE SCHEMA IF NOT EXISTS ${context.escapeIdentifier(context.schema)}`,
  );
}
