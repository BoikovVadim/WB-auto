import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";

import { appEnv } from "../env";

const writeIntentHeader = "x-wb-write-intent";
const writeKeyHeader = "x-wb-write-key";
const expectedWriteIntent = "dashboard";

@Injectable()
export class WbClustersWriteGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{
      headers?: Record<string, string | string[] | undefined>;
    }>();
    const headers = request.headers ?? {};
    const writeIntent = readHeader(headers, writeIntentHeader);
    if (writeIntent !== expectedWriteIntent) {
      throw new ForbiddenException("Недостаточно прав для write-операции WB.");
    }

    if (!appEnv.wbClustersWriteApiKey) {
      return true;
    }

    const providedKey = readHeader(headers, writeKeyHeader);
    if (providedKey !== appEnv.wbClustersWriteApiKey) {
      throw new ForbiddenException("Недостаточно прав для write-операции WB.");
    }

    return true;
  }
}

function readHeader(
  headers: Record<string, string | string[] | undefined>,
  key: string,
) {
  const rawValue = headers[key];
  if (Array.isArray(rawValue)) {
    return rawValue[0] ?? null;
  }

  return typeof rawValue === "string" && rawValue.trim() ? rawValue.trim() : null;
}
