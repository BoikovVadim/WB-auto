import { timingSafeEqual } from "node:crypto";

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

    const expectedKey = appEnv.wbClustersWriteApiKey;
    if (!expectedKey) {
      // The x-wb-write-intent header is static and guessable, so it is not a
      // secret. In production a missing key means every "guarded" mutation is
      // open — treat it as misconfiguration and deny. In dev we allow it so the
      // dashboard works without a key configured.
      if (appEnv.nodeEnv === "production") {
        throw new ForbiddenException(
          "Write-операции WB отключены: WB_CLUSTERS_WRITE_API_KEY не задан.",
        );
      }
      return true;
    }

    const providedKey = readHeader(headers, writeKeyHeader);
    if (!providedKey || !timingSafeStringEqual(providedKey, expectedKey)) {
      throw new ForbiddenException("Недостаточно прав для write-операции WB.");
    }

    return true;
  }
}

function timingSafeStringEqual(a: string, b: string): boolean {
  const bufferA = Buffer.from(a, "utf8");
  const bufferB = Buffer.from(b, "utf8");
  if (bufferA.length !== bufferB.length) {
    return false;
  }
  return timingSafeEqual(bufferA, bufferB);
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
