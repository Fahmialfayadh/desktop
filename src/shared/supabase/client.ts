import {
  getSupabaseUrl,
  getSupabaseAnonKey,
  isSupabaseConfigured,
} from "@/shared/api/baseUrl";
import { ApiError } from "@/shared/api/ApiError";

export { isSupabaseConfigured };

export async function supabaseAuthRequest<T>(
  endpoint: string,
  options?: RequestInit,
): Promise<T> {
  const url = `${getSupabaseUrl()}/auth/v1${endpoint.startsWith("/") ? endpoint : `/${endpoint}`}`;
  const key = getSupabaseAnonKey();
  const headers = new Headers(options?.headers);
  headers.set("apikey", key);
  if (!headers.has("Content-Type") && options?.body) {
    headers.set("Content-Type", "application/json");
  }

  const res = await fetch(url, {
    ...options,
    headers,
  });

  const contentType = res.headers.get("content-type") || "";
  const isJson = contentType.includes("application/json");
  const data = isJson ? await res.json().catch(() => null) : await res.text().catch(() => null);

  if (!res.ok) {
    const errorMsg =
      (typeof data === "object" && data !== null && (data.error_description || data.msg || data.message || data.error)) ||
      res.statusText ||
      "Auth request failed";
    const errorCode =
      (typeof data === "object" && data !== null && (data.error_code || data.code)) ||
      String(res.status);
    throw new ApiError(res.status, String(errorMsg), String(errorCode));
  }

  return data as T;
}

export async function supabaseRestRequest<T>(
  pathWithQuery: string,
  options?: RequestInit,
  token?: string,
): Promise<T> {
  const url = `${getSupabaseUrl()}/rest/v1${pathWithQuery.startsWith("/") ? pathWithQuery : `/${pathWithQuery}`}`;
  const key = getSupabaseAnonKey();
  const headers = new Headers(options?.headers);
  headers.set("apikey", key);
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  if (!headers.has("Content-Type") && options?.body) {
    headers.set("Content-Type", "application/json");
  }
  const method = (options?.method || "GET").toUpperCase();
  if (method === "POST" || method === "PATCH" || method === "DELETE" || method === "PUT") {
    if (!headers.has("Prefer")) {
      headers.set("Prefer", "return=representation");
    }
  }

  const res = await fetch(url, {
    ...options,
    headers,
  });

  if (res.status === 204) {
    return [] as unknown as T;
  }

  const contentType = res.headers.get("content-type") || "";
  const isJson = contentType.includes("application/json");
  const data = isJson ? await res.json().catch(() => null) : await res.text().catch(() => null);

  if (!res.ok) {
    const errorMsg =
      (typeof data === "object" && data !== null && (data.message || data.details || data.hint || data.error)) ||
      res.statusText ||
      "Database request failed";
    const errorCode =
      (typeof data === "object" && data !== null && data.code) ||
      String(res.status);
    throw new ApiError(res.status, String(errorMsg), String(errorCode));
  }

  return data as T;
}
