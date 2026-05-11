import type { WbClustersSchemaContext } from "./wb-clusters.schema.types";

export async function executeSchemaStatements(
  context: WbClustersSchemaContext,
  statements: readonly string[],
) {
  for (const statement of statements) {
    await context.pool.query(statement);
  }
}

export async function ensureWbClustersSchema(
  context: WbClustersSchemaContext,
) {
  await context.pool.query(
    `CREATE SCHEMA IF NOT EXISTS ${context.escapeIdentifier(context.schema)}`,
  );
}
