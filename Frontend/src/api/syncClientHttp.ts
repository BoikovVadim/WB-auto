import axios from "axios";

import { buildApiPath } from "../runtimePaths";
import type { ProductAdvertisingSheetResponse } from "./syncClientTypes";

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? buildApiPath("");
const wbClustersWriteApiKey = (import.meta.env.VITE_WB_CLUSTERS_WRITE_API_KEY ?? "").trim();

export const apiClient = axios.create({
  baseURL: apiBaseUrl,
  timeout: 10000,
});

export const advertisingApiTimeoutMs = 45_000;

/**
 * Матричные эндпоинты (товары × даты) тяжелее обычных и на холодную (после деплоя,
 * пустой кэш PG) могут перешагнуть глобальный лимит 10 c — тогда axios тихо рвал
 * запрос, а лист ретроспективы оставался немо-пустым. Даём им запас.
 */
export const matrixApiTimeoutMs = 30_000;

export const productAdvertisingSheetRequestInFlight = new Map<
  string,
  Promise<ProductAdvertisingSheetResponse>
>();

export function buildWbClustersWriteHeaders() {
  return {
    "X-WB-Write-Intent": "dashboard",
    ...(wbClustersWriteApiKey ? { "X-WB-Write-Key": wbClustersWriteApiKey } : {}),
  };
}

/**
 * Транзиентная (восстановимая) ошибка запроса — есть смысл ретраить: сеть/таймаут (нет
 * ответа) или 5xx (типично 502/503/504 в окне рестарта бэка после деплоя). 4xx —
 * НЕ ретраим (валидация/авторизация сами не починятся).
 */
export function isTransientHttpError(error: unknown): boolean {
  if (!axios.isAxiosError(error)) return false;
  const status = error.response?.status;
  if (status === undefined) return true; // сеть/таймаут — ответа нет
  return status >= 500;
}
