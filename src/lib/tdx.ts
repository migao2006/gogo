const TOKEN_URL =
  "https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token";
const API_BASE = "https://tdx.transportdata.tw/api/basic";

interface TokenCache {
  value: string;
  expiresAt: number;
}

let tokenCache: TokenCache | null = null;
let requestQueue: Promise<void> = Promise.resolve();
let nextRequestAt = 0;

const MIN_REQUEST_INTERVAL_MS = Math.max(
  500,
  Number(process.env.TDX_MIN_REQUEST_INTERVAL_MS ?? 1_000)
);

export class TdxHttpError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly path: string,
    public readonly detail?: string
  ) {
    super(message);
    this.name = "TdxHttpError";
  }
}

function requiredEnv(name: "TDX_CLIENT_ID" | "TDX_CLIENT_SECRET"): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`伺服器尚未設定 ${name}`);
  }
  return value;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForRequestSlot(): Promise<void> {
  const turn = requestQueue.then(async () => {
    const waitMs = Math.max(0, nextRequestAt - Date.now());
    if (waitMs > 0) await sleep(waitMs);
    nextRequestAt = Date.now() + MIN_REQUEST_INTERVAL_MS;
  });
  requestQueue = turn.catch(() => undefined);
  await turn;
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

async function fetchTdxResponse(
  url: URL,
  token: string,
  revalidateSeconds: number,
  noStore = false
): Promise<Response> {
  await waitForRequestSlot();
  return fetch(url, {
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/json",
      "accept-encoding": "gzip, br",
    },
    ...(noStore
      ? { cache: "no-store" as const }
      : { next: { revalidate: revalidateSeconds } }),
  });
}

export async function tdxFetch<T>(
  path: string,
  params: Record<string, string | number | undefined> = {},
  revalidateSeconds = 20
): Promise<T> {
  const url = new URL(`${API_BASE}${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }

  let token = await getTdxToken();
  let lastResponse: Response | null = null;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    let response = await fetchTdxResponse(
      url,
      token,
      revalidateSeconds,
      attempt > 0
    );

    if (response.status === 401 && attempt === 0) {
      tokenCache = null;
      token = await getTdxToken();
      response = await fetchTdxResponse(url, token, revalidateSeconds, true);
    }

    if (response.status === 429 && attempt < 2) {
      lastResponse = response;
      const retryAfterSeconds = Number(response.headers.get("retry-after"));
      const backoffMs = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
        ? retryAfterSeconds * 1_000
        : 1_500 * (attempt + 1);
      await sleep(backoffMs);
      continue;
    }

    if (!response.ok) {
      const text = await response.text();
      console.error("TDX API error", response.status, path, text.slice(0, 300));
      throw new TdxHttpError(
        `TDX API 呼叫失敗（HTTP ${response.status}）`,
        response.status,
        path,
        text.slice(0, 300)
      );
    }

    return (await response.json()) as T;
  }

  const status = lastResponse?.status ?? 429;
  throw new TdxHttpError(
    `TDX API 呼叫失敗（HTTP ${status}）`,
    status,
    path
  );
}

export async function firstSuccessfulTdxFetch<T>(
  attempts: Array<{
    path: string;
    params?: Record<string, string | number | undefined>;
  }>,
  revalidateSeconds = 20
): Promise<T> {
  let lastError: unknown;
  for (const attempt of attempts) {
    try {
      return await tdxFetch<T>(
        attempt.path,
        attempt.params,
        revalidateSeconds
      );
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("TDX 查詢失敗");
}
