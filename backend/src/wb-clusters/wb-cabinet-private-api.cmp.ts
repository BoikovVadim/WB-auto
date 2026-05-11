import { chromium, type LaunchOptions } from "playwright";
import * as XLSX from "xlsx";

import { appEnv } from "../common/env";
import type { WbCabinetCmpProbeResponse } from "./wb-clusters.types";

export type WordsClustersFetchResponse = {
  ok: boolean;
  status: number | null;
  base64: string | null;
  sourceEndpoint: string | null;
  pageUrl: string;
  capturedAt: string;
  requests: WbCabinetCmpProbeResponse["requests"];
};

type CmpPageRuntime = {
  localStorage: {
    getItem: (key: string) => string | null;
  };
  document: {
    cookie: string;
  };
  location: {
    href: string;
  };
  fetch: (
    input: string,
    init: {
      method: string;
      credentials: "include";
      headers: Record<string, string>;
    },
  ) => Promise<{
    ok: boolean;
    status: number;
    arrayBuffer: () => Promise<ArrayBuffer>;
  }>;
  btoa: (value: string) => string;
};

export function buildCmpCampaignUrl(advertId: number, nmId: number) {
  return `${appEnv.wbCabinetCmpBaseUrl}/campaigns/edit/${advertId}?advertID=${advertId}&nmId=${nmId}`;
}

export async function fetchWordsClustersFromCmp(
  advertId: number,
  nmId: number,
): Promise<WordsClustersFetchResponse> {
  const launchOptions: LaunchOptions = {
    headless: appEnv.wbCabinetHeadless,
  };
  if (appEnv.wbCabinetExecutablePath) {
    launchOptions.executablePath = appEnv.wbCabinetExecutablePath;
  }

  const browser = await chromium.launch(launchOptions);
  const context = await browser.newContext({
    storageState: appEnv.wbCabinetStorageStatePath,
  });

  try {
    const page = await context.newPage();
    const requests: WbCabinetCmpProbeResponse["requests"] = [];
    const requestByUrl = new Map<string, number>();
    page.on("request", (request) => {
      if (!request.url().startsWith(appEnv.wbCabinetCmpBaseUrl)) {
        return;
      }
      if (requests.length >= appEnv.wbCabinetProbeMaxRequests) {
        return;
      }

      requestByUrl.set(request.url(), requests.length);
      requests.push({
        url: request.url(),
        method: request.method(),
        resourceType: request.resourceType(),
        status: null,
      });
    });
    page.on("response", (response) => {
      const index = requestByUrl.get(response.url());
      if (index === undefined) {
        return;
      }

      requests[index].status = response.status();
    });

    await page.goto(buildCmpCampaignUrl(advertId, nmId), {
      waitUntil: "domcontentloaded",
      timeout: appEnv.wbCabinetRequestTimeoutMs,
    });
    await page.waitForLoadState("networkidle", {
      timeout: appEnv.wbCabinetRequestTimeoutMs,
    }).catch(() => undefined);

    const fetchPayload = await page.evaluate(
      async ({ advertId: currentAdvertId }) => {
        const runtime = globalThis as unknown as CmpPageRuntime;
        const token = runtime.localStorage.getItem("access-token") || "";
        const supplierMatch = runtime.document.cookie.match(
          /(?:^|; )x-supplier-id-external=([^;]+)/,
        );
        const supplier = supplierMatch ? supplierMatch[1] : "";
        const sourceEndpoint = `/api/v5/words-clusters?advertID=${currentAdvertId}`;
        if (!token || !supplier) {
          return {
            ok: false,
            status: null,
            base64: null,
            sourceEndpoint,
            pageUrl: runtime.location.href,
            capturedAt: new Date().toISOString(),
          };
        }

        const response = await runtime.fetch(sourceEndpoint, {
          method: "GET",
          credentials: "include",
          headers: {
            AuthorizeV3: token,
            "x-supplierid": decodeURIComponent(supplier),
            Lang: "ru",
          },
        });
        const arrayBuffer = await response.arrayBuffer();
        const bytes = new Uint8Array(arrayBuffer);
        let binary = "";
        const chunkSize = 32768;
        for (let offset = 0; offset < bytes.length; offset += chunkSize) {
          binary += String.fromCharCode(...Array.from(bytes.subarray(offset, offset + chunkSize)));
        }

        return {
          ok: response.ok,
          status: response.status,
          base64: runtime.btoa(binary),
          sourceEndpoint,
          pageUrl: runtime.location.href,
          capturedAt: new Date().toISOString(),
        };
      },
      { advertId },
    );

    return {
      ...fetchPayload,
      requests,
    };
  } finally {
    await context.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
  }
}

export function decodeWorkbookBuffer(base64: string) {
  return Buffer.from(base64, "base64");
}

export function countWorkbookRows(workbookBuffer: Buffer) {
  const workbook = XLSX.read(workbookBuffer, { type: "buffer" });
  const firstSheetName = workbook.SheetNames[0];
  return firstSheetName
    ? XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[firstSheetName], {
        defval: "",
      }).length
    : 0;
}
