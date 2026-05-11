import type { Pool } from "pg";

export type WbClustersSchemaContext = {
  pool: Pool;
  schema: string;
  escapeIdentifier: (name: string) => string;
  tableName: (name: string) => string;
};
