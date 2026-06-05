import net from "node:net";
import http from "node:http";

/**
 * Локальный http-CONNECT → SOCKS5 релей для зонда позиций.
 *
 * Chromium не умеет SOCKS5-auth, а мобильный прокси WB-зонда — авторизованный SOCKS5.
 * Поэтому браузер ходит через http://127.0.0.1:<port>, а этот релей пробрасывает каждый
 * CONNECT в SOCKS5 (RFC1928 + RFC1929 user/pass auth). Вынесено из клиента-зонда как
 * самостоятельная сетевая ответственность.
 */

export interface ParsedProxy {
  host: string;
  port: number;
  user: string;
  pass: string;
}

/** Парсит WB_SEARCH_PROBE_PROXY вида socks5://user:pass@host:port. */
export function parseProbeProxy(): ParsedProxy | null {
  const raw = process.env.WB_SEARCH_PROBE_PROXY;
  if (!raw) return null;
  try {
    const u = new URL(raw);
    return {
      host: u.hostname,
      port: Number(u.port),
      user: decodeURIComponent(u.username),
      pass: decodeURIComponent(u.password),
    };
  } catch {
    return null;
  }
}

/** Устанавливает SOCKS5-туннель к (host:port) через авторизованный прокси. */
function socks5Connect(
  proxy: ParsedProxy,
  host: string,
  port: number,
): Promise<{ sock: net.Socket; leftover: Buffer }> {
  return new Promise((resolve, reject) => {
    const s = net.connect(proxy.port, proxy.host);
    let buf = Buffer.alloc(0);
    let stage = 0;
    const fail = (e: unknown) => {
      s.destroy();
      reject(e instanceof Error ? e : new Error(String(e)));
    };
    s.once("error", fail);
    s.once("connect", () => s.write(Buffer.from([0x05, 0x01, 0x02])));
    const onData = (d: Buffer) => {
      buf = Buffer.concat([buf, d]);
      if (stage === 0) {
        if (buf.length < 2) return;
        if (buf[0] !== 0x05 || buf[1] !== 0x02) return fail("no userpass auth");
        buf = buf.subarray(2);
        stage = 1;
        const ub = Buffer.from(proxy.user);
        const pb = Buffer.from(proxy.pass);
        s.write(
          Buffer.concat([Buffer.from([0x01, ub.length]), ub, Buffer.from([pb.length]), pb]),
        );
      }
      if (stage === 1) {
        if (buf.length < 2) return;
        if (buf[1] !== 0x00) return fail("auth rejected");
        buf = buf.subarray(2);
        stage = 2;
        const hb = Buffer.from(host);
        s.write(
          Buffer.concat([
            Buffer.from([0x05, 0x01, 0x00, 0x03, hb.length]),
            hb,
            Buffer.from([port >> 8, port & 0xff]),
          ]),
        );
      }
      if (stage === 2) {
        if (buf.length < 5) return;
        if (buf[1] !== 0x00) return fail("connect failed " + buf[1]);
        const atyp = buf[3];
        const need = atyp === 0x01 ? 10 : atyp === 0x04 ? 22 : 4 + 1 + buf[4]! + 2;
        if (buf.length < need) return;
        const leftover = buf.subarray(need);
        s.removeListener("data", onData);
        s.removeListener("error", fail);
        resolve({ sock: s, leftover });
      }
    };
    s.on("data", onData);
  });
}

/** Поднимаемый один раз локальный http→socks5 релей; держит свой http.Server. */
export class Socks5HttpRelay {
  private server: http.Server | null = null;

  /** Слушает 127.0.0.1:0 (произвольный порт), резолвит выбранный порт. */
  start(proxy: ParsedProxy): Promise<number> {
    return new Promise((resolve, reject) => {
      const server = http.createServer();
      server.on("connect", (req, clientSocket, head) => {
        const [host, portStr] = (req.url ?? "").split(":");
        void socks5Connect(proxy, host!, Number(portStr || 443))
          .then(({ sock, leftover }) => {
            clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
            if (leftover.length) clientSocket.write(leftover);
            if (head.length) sock.write(head);
            sock.pipe(clientSocket);
            clientSocket.pipe(sock);
            const kill = () => {
              sock.destroy();
              clientSocket.destroy();
            };
            sock.on("error", kill);
            clientSocket.on("error", kill);
          })
          .catch(() => {
            try {
              clientSocket.write("HTTP/1.1 502 Bad Gateway\r\n\r\n");
            } catch {
              /* noop */
            }
            clientSocket.destroy();
          });
      });
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address();
        this.server = server;
        resolve(typeof addr === "object" && addr ? addr.port : 0);
      });
    });
  }

  close(): void {
    this.server?.close();
    this.server = null;
  }
}
