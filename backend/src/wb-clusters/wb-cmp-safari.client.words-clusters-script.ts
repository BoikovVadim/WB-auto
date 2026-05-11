export function buildWordsClustersBrowserScript(advertId: number) {
  return `
    (function () {
      try {
        var token = localStorage.getItem("access-token") || "";
        var supplierMatch = document.cookie.match(/(?:^|; )x-supplier-id-external=([^;]+)/);
        var supplier = supplierMatch ? supplierMatch[1] : "";
        if (!token || !supplier) {
          return JSON.stringify({
            ok: false,
            error: "Missing WB seller session in Safari. Open the campaign page in Safari first."
          });
        }

        var xhr = new XMLHttpRequest();
        xhr.open("GET", "/api/v5/words-clusters?advertID=${advertId}", false);
        xhr.overrideMimeType("text/plain; charset=x-user-defined");
        xhr.withCredentials = true;
        xhr.setRequestHeader("AuthorizeV3", token);
        xhr.setRequestHeader("x-supplierid", decodeURIComponent(supplier));
        xhr.setRequestHeader("Lang", "ru");
        xhr.send(null);

        var text = xhr.responseText || "";
        var bytes = new Uint8Array(text.length);
        for (var index = 0; index < text.length; index += 1) {
          bytes[index] = text.charCodeAt(index) & 255;
        }

        var chunkSize = 32768;
        var binary = "";
        for (var offset = 0; offset < bytes.length; offset += chunkSize) {
          binary += String.fromCharCode.apply(
            null,
            Array.from(bytes.subarray(offset, offset + chunkSize)),
          );
        }

        return JSON.stringify({
          ok: xhr.status >= 200 && xhr.status < 300,
          status: xhr.status,
          length: bytes.length,
          base64: btoa(binary),
        });
      } catch (error) {
        return JSON.stringify({
          ok: false,
          error: String(error),
          stack: error && error.stack ? String(error.stack) : "",
        });
      }
    })()
  `.trim();
}
