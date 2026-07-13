const TOKEN_URL =
  "https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token";
const API_BASE = "https://tdx.transportdata.tw/api/basic";

interface TokenCache {
  value: string;
  expiresAt: number;
}

let tokenCache: TokenCache | null = null;

function requiredEnv(name: "TDX_CLIENT_ID" | "TDX_CLIENT_SECRET"): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`伺服器尚未設定 ${name}`);
  }
  return value;
}

async function requestToken(): Promise<string> {
  const clientId = requiredEnv("TDX_CLIENT_ID");
  const clientSecret = requiredEnv("TDX_CLIENT_SECRET");
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
  });

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`TDX 認證失敗（HTTP ${response.status}）`);
  }

  const payload = (await response.json()) as {
    access_token?: string;
    expires_in?: number;
  };

  if (!payload.access_token) {
    throw new Error("TDX 認證回應缺少 access_token");
  }

  const expiresIn = Math.max(300, payload.expires_in ?? 3_600);
  tokenCache = {
    value: payload.access_token,
    expiresAt: Date.now() + (expiresIn - 120) * 1_000,
  };
  return payload.access_token;
}

export async function getTdxToken(): Promise<string> {
  if (tokenCache && tokenCache.expiresAt > Date.now()) {
    return tokenCache.value;
  }
  return requestToken();
}

export async function tdxFetch<T>(
  path: string,
  params: Record<string, string | number | undefined> = {},
  revalidateSeconds = 20
): Promise<T> {
  const token = await getTdxToken();
  const url = new URL(`${API_BASE}${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }

  let response = await fetch(url, {
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/json",
      "accept-encoding": "gzip, br",
    },
    next: { revalidate: revalidateSeconds },
  });

  if (response.status === 401) {
    tokenCache = null;
    const refreshedToken = await getTdxToken();
    response = await fetch(url, {
      headers: {
        authorization: `Bearer ${refreshedToken}`,
        accept: "application/json",
        "accept-encoding": "gzip, br",
      },
      cache: "no-store",
    });
  }

  if (!response.ok) {
    const text = await response.text();
    console.error("TDX API error", response.status, path, text.slice(0, 300));
    throw new Error(`TDX API 呼叫失敗（HTTP ${response.status}）`);
  }

  return (await response.json()) as T;
}

export async function firstSuccessfulTdxFetch<T>(
  attempts: Array<{ path: string; params?: Record<string, string | number | undefined> }>,
  revalidateSeconds = 20
): Promise<T> {
  let lastError: unknown;
  for (const attempt of attempts) {
    try {
      return await tdxFetch<T>(attempt.path, attempt.params, revalidateSeconds);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("TDX 查詢失敗");
}
