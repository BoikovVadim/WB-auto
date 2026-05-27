import { Injectable } from "@nestjs/common";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

@Injectable()
export class WbRuntimeConfigService {
  private runtimeToken = "";
  private runtimePromotionToken = "";

  getResolvedToken() {
    return this.runtimeToken || this.getEnvToken();
  }

  getTokenSource(): "runtime" | "env" | "missing" {
    if (this.runtimeToken) {
      return "runtime";
    }

    if (this.getEnvToken()) {
      return "env";
    }

    return "missing";
  }

  getResolvedPromotionToken() {
    return this.runtimePromotionToken || this.getEnvValue("WB_PROMOTION_API_TOKEN");
  }

  getPromotionTokenSource(): "runtime" | "env" | "missing" {
    if (this.runtimePromotionToken) {
      return "runtime";
    }

    if (this.getEnvValue("WB_PROMOTION_API_TOKEN")) {
      return "env";
    }

    return "missing";
  }

  async setRuntimeToken(token: string) {
    const normalizedToken = token.trim();

    await this.persistEnvValue("WB_API_TOKEN", normalizedToken);
    this.runtimeToken = normalizedToken;
    process.env.WB_API_TOKEN = normalizedToken;
  }

  async clearRuntimeToken() {
    await this.persistEnvValue("WB_API_TOKEN", "");
    this.runtimeToken = "";
    process.env.WB_API_TOKEN = "";
  }

  async setRuntimePromotionToken(token: string) {
    const normalizedToken = token.trim();

    await this.persistEnvValue("WB_PROMOTION_API_TOKEN", normalizedToken);
    this.runtimePromotionToken = normalizedToken;
    process.env.WB_PROMOTION_API_TOKEN = normalizedToken;
  }

  async clearRuntimePromotionToken() {
    await this.persistEnvValue("WB_PROMOTION_API_TOKEN", "");
    this.runtimePromotionToken = "";
    process.env.WB_PROMOTION_API_TOKEN = "";
  }

  private getEnvToken() {
    return this.getEnvValue("WB_API_TOKEN");
  }

  private getEnvValue(name: string) {
    return (process.env[name] ?? "").trim();
  }

  private async persistEnvValue(name: string, value: string) {
    // Defense-in-depth: a value containing CR/LF (or other control characters)
    // would inject arbitrary additional lines into the .env file, which are
    // loaded on next boot. Reject them before writing.
    // eslint-disable-next-line no-control-regex -- intentionally matching control chars
    if (/[\r\n\x00]/.test(value)) {
      throw new Error(`Refusing to persist ${name}: value contains control characters`);
    }

    const envFilePath = await this.getWritableEnvFilePath();
    const envDir = path.dirname(envFilePath);

    await mkdir(envDir, { recursive: true });

    let currentContent = "";

    try {
      currentContent = await readFile(envFilePath, "utf-8");
    } catch {
      currentContent = "";
    }

    const nextLine = `${name}=${value}`;
    const envLinePattern = new RegExp(`^${name}=.*$`, "m");
    const nextContent = envLinePattern.test(currentContent)
      ? currentContent.replace(envLinePattern, nextLine)
      : `${currentContent.replace(/\s*$/, "\n")}${nextLine}\n`;

    await writeFile(envFilePath, nextContent, "utf-8");
  }

  private async getWritableEnvFilePath() {
    const cwd = process.cwd();
    const rootDir =
      path.basename(cwd) === "backend" ? path.resolve(cwd, "..") : cwd;
    const sharedEnvPath = path.join(rootDir, "shared", ".env");
    const rootEnvPath = path.join(rootDir, ".env");

    if (
      (await this.pathExists(sharedEnvPath)) ||
      (await this.pathExists(path.dirname(sharedEnvPath)))
    ) {
      return sharedEnvPath;
    }

    return rootEnvPath;
  }

  private async pathExists(targetPath: string) {
    try {
      await access(targetPath);
      return true;
    } catch {
      return false;
    }
  }
}
