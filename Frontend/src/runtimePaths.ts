const rawBaseUrl = import.meta.env.BASE_URL ?? "/";

function normalizeBasePath(value: string) {
  const trimmed = value.trim();

  if (!trimmed || trimmed === "/") {
    return "/";
  }

  const withLeadingSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  return withLeadingSlash.endsWith("/")
    ? withLeadingSlash
    : `${withLeadingSlash}/`;
}

export const APP_BASE_PATH = normalizeBasePath(rawBaseUrl);

export function buildAppPath(path: string) {
  const normalizedPath = path.startsWith("/") ? path.slice(1) : path;
  return new URL(normalizedPath, `https://app.local${APP_BASE_PATH}`).pathname;
}

export function buildApiPath(path: string) {
  return buildAppPath(`api/${path}`);
}
