import { getClientId } from "./client-id";
import { apiUrl, getToken, clearAuth } from "./auth";

const baseHeaders = (): HeadersInit => {
  const headers: Record<string, string> = {
    "X-Client-Id": getClientId(),
    "Content-Type": "application/json",
  };
  const token = getToken();
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  return headers;
};

// Em 401 (key inválida/expirada) limpa a auth e volta pra tela de login.
const guard = (status: number) => {
  if (status === 401) {
    clearAuth();
    location.reload();
  }
};

export const apiGet = async <T>(path: string): Promise<T> => {
  const r = await fetch(apiUrl(path), { headers: baseHeaders() });
  if (!r.ok) {
    guard(r.status);
    throw new Error(`${path} ${r.status}`);
  }
  return r.json() as Promise<T>;
};

export const apiPost = async <T>(path: string, body: unknown): Promise<T> => {
  const r = await fetch(apiUrl(path), { method: "POST", headers: baseHeaders(), body: JSON.stringify(body) });
  if (!r.ok) {
    guard(r.status);
    const text = await r.text().catch(() => "");
    throw new Error(`${path} ${r.status} ${text}`);
  }
  return r.json() as Promise<T>;
};

export const apiDelete = async (path: string): Promise<void> => {
  const r = await fetch(apiUrl(path), { method: "DELETE", headers: baseHeaders() });
  if (!r.ok) {
    guard(r.status);
    throw new Error(`${path} ${r.status}`);
  }
};

export const apiPut = async <T>(path: string, body: unknown): Promise<T> => {
  const r = await fetch(apiUrl(path), { method: "PUT", headers: baseHeaders(), body: JSON.stringify(body) });
  if (!r.ok) {
    guard(r.status);
    const text = await r.text().catch(() => "");
    throw new Error(`${path} ${r.status} ${text}`);
  }
  return r.json() as Promise<T>;
};
