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
  700,
  Number(process.env.TDX_MIN_REQUEST_INTERVAL_MS ?? 1_200)
);
const REQUEST_TIMEOUT_MS = Math.max(
  4_000,
  Number(process.env.TDX_REQUEST_TIMEOUT_MS ?? 8_000)
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

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
      cache: "no-store",
      signal: controller.signal,
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
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("TDX 認證逾時");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
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

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    return await fetch(url, {
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/json",
        "accept-encoding": "gzip, br",
      },
      signal: controller.signal,
      ...(noStore
        ? { cache: "no-store" as const }
        : { next: { revalidate: revalidateSeconds } }),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new TdxHttpError("TDX API 查詢逾時", 504, url.pathname);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export async function tdxFetch<T>(
  path: string,
  params: Record<string, string | number | undefined> = {},
  revalidateSeconds = 30
): Promise<T> {
  const url = new URL(`${API_BASE}${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }

  let token = await getTdxToken();
  let lastResponse: Response | null = null;

  for (let attempt = 0; attempt < 2; attempt += 1) {
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

    if (response.status === 429 && attempt === 0) {
      lastResponse = response;
      const retryAfterSeconds = Number(response.headers.get("retry-after"));
      const backoffMs =
        Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
          ? Math.min(retryAfterSeconds * 1_000, 2_500)
          : 1_100;
      await sleep(backoffMs);
      continue;
    }

    if (!response.ok) {
      const detail = await response.text();
      console.error("TDX API error", response.status, path, detail.slice(0, 300));
      throw new TdxHttpError(
        `TDX API 呼叫失敗（HTTP ${response.status}）`,
        response.status,
        path,
        detail.slice(0, 300)
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
  revalidateSeconds = 30
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
