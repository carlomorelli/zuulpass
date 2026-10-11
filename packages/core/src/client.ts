import {
  accountKeysResponseSchema,
  errorResponseSchema,
  loginResponseSchema,
  paramsResponseSchema,
  type AccountKeysResponse,
  type LoginRequest,
  type LoginResponse,
  type ParamsResponse,
  type RegisterRequest,
} from "@zuulpass/api-types";

// Typed HTTP client for the worker API (docs/architecture.md §6). All responses
// are validated against the shared `api-types` Zod schemas.
export class ApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
  }
}

export interface ApiClient {
  serverUrl: string;
  fetch: typeof fetch;
}

export function createApiClient(
  serverUrl: string,
  fetchImpl: typeof fetch = fetch,
): ApiClient {
  return { serverUrl: serverUrl.replace(/\/+$/, ""), fetch: fetchImpl };
}

async function toApiError(res: Response): Promise<ApiError> {
  let code = "internal_error";
  let message = `request failed with status ${res.status}`;
  try {
    const parsed = errorResponseSchema.parse(await res.json());
    code = parsed.error.code;
    message = parsed.error.message;
  } catch {
    // Non-JSON error body: keep the generic message.
  }
  return new ApiError(code, message, res.status);
}

async function ensureOk(res: Response): Promise<Response> {
  if (!res.ok) throw await toApiError(res);
  return res;
}

function requestHeaders(
  token: string | undefined,
  withBody = false,
): Record<string, string> {
  const headers: Record<string, string> = {};
  if (withBody) headers["content-type"] = "application/json";
  if (token) headers.authorization = `Bearer ${token}`;
  return headers;
}

export async function getParams(
  client: ApiClient,
  email: string,
): Promise<ParamsResponse> {
  const res = await ensureOk(
    await client.fetch(
      `${client.serverUrl}/params?email=${encodeURIComponent(email)}`,
      { method: "GET" },
    ),
  );
  return paramsResponseSchema.parse(await res.json());
}

export async function register(
  client: ApiClient,
  body: RegisterRequest,
): Promise<void> {
  await ensureOk(
    await client.fetch(`${client.serverUrl}/account/register`, {
      method: "POST",
      headers: requestHeaders(undefined, true),
      body: JSON.stringify(body),
    }),
  );
}

export async function login(
  client: ApiClient,
  body: LoginRequest,
): Promise<LoginResponse> {
  const res = await ensureOk(
    await client.fetch(`${client.serverUrl}/login`, {
      method: "POST",
      headers: requestHeaders(undefined, true),
      body: JSON.stringify(body),
    }),
  );
  return loginResponseSchema.parse(await res.json());
}

export async function logout(client: ApiClient, token: string): Promise<void> {
  await ensureOk(
    await client.fetch(`${client.serverUrl}/logout`, {
      method: "POST",
      headers: requestHeaders(token),
    }),
  );
}

export async function getAccountKeys(
  client: ApiClient,
  token: string,
): Promise<AccountKeysResponse> {
  const res = await ensureOk(
    await client.fetch(`${client.serverUrl}/account/keys`, {
      method: "GET",
      headers: requestHeaders(token),
    }),
  );
  return accountKeysResponseSchema.parse(await res.json());
}
