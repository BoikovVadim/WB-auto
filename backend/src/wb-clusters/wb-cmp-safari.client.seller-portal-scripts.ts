export { buildSellerPortalExportAppleScript } from "./wb-cmp-safari.client.seller-portal-apple-script";

import { buildSellerPortalHelperCoreScript } from "./wb-cmp-safari.client.seller-portal-helper-core";
import { buildSellerPortalHelperDownloadScript } from "./wb-cmp-safari.client.seller-portal-helper-download";

export function buildSellerPortalHelperScript() {
  return [
    buildSellerPortalHelperCoreScript(),
    buildSellerPortalHelperDownloadScript(),
  ].join("\n").trim();
}
