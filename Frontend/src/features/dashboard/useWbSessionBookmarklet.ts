import { useMemo } from "react";

const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "";
const writeApiKey = ((import.meta.env.VITE_WB_CLUSTERS_WRITE_API_KEY as string | undefined) ?? "").trim();

/**
 * Generates a bookmarklet href that the user can drag to their bookmarks bar.
 * When clicked on seller.wildberries.ru it sends the page's localStorage to
 * our session-update endpoint so Playwright can download the daily frequency report.
 */
export function useWbSessionBookmarklet(): { bookmarkletHref: string; apiUrl: string } {
  return useMemo(() => {
    const base = apiBaseUrl.replace(/\/$/, "");
    const apiUrl = `${base}/wb-clusters/seller-portal/session/update`;
    const keyHeader = writeApiKey ? `,'X-WB-Write-Key':'${writeApiKey}'` : "";
    // One-liner bookmarklet: capture localStorage, POST to our server, show alert.
    const code = [
      "(function(){",
      "var d=Object.entries(localStorage).map(function(e){return{name:e[0],value:e[1]}}); ",
      `fetch('${apiUrl}',{method:'POST',headers:{'Content-Type':'application/json','X-WB-Write-Intent':'dashboard'${keyHeader}},body:JSON.stringify({localStorage:d})})`,
      ".then(function(r){return r.json()})",
      ".then(function(r){alert('\\u2705 WB \\u0441\\u0435\\u0441\\u0441\\u0438\\u044f \\u043e\\u0431\\u043d\\u043e\\u0432\\u043b\\u0435\\u043d\\u0430! \\u0417\\u0430\\u043f\\u0438\\u0441\\u0435\\u0439: '+(r.itemCount||0))})",
      ".catch(function(e){alert('\\u274c \\u041e\\u0448\\u0438\\u0431\\u043a\\u0430: '+e.message)})",
      "})();",
    ].join("");
    return { bookmarkletHref: `javascript:${code}`, apiUrl };
  }, []);
}
