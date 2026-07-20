const URL_KEY = "kallia.apiUrl";
const TOKEN_KEY = "kallia.token";
const USER_KEY = "kallia.user";

const LEGACY_TOKEN_KEY = "wacalls.token";
const LEGACY_USER_KEY = "wacalls.user";
const LEGACY_URL_KEY = "wacalls.apiUrl";

export const getApiBase = (): string =>
  (localStorage.getItem(URL_KEY) || localStorage.getItem(LEGACY_URL_KEY) || "").replace(/\/+$/, "") || window.location.origin;

export const getToken = (): string =>
  localStorage.getItem(TOKEN_KEY) || localStorage.getItem(LEGACY_TOKEN_KEY) || "";

export const getUser = (): any => {
  try {
    const raw = localStorage.getItem(USER_KEY) || localStorage.getItem(LEGACY_USER_KEY);
    return JSON.parse(raw || "null");
  } catch {
    return null;
  }
};
export const isAuthed = (): boolean => !!getToken();

export const setAuth = (url: string, token: string, user: any): void => {
  localStorage.setItem(URL_KEY, url.replace(/\/+$/, ""));
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
};

export const clearAuth = (): void => {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  localStorage.removeItem(LEGACY_TOKEN_KEY);
  localStorage.removeItem(LEGACY_USER_KEY);
};

export const apiUrl = (path: string): string => getApiBase() + path;

// checkAuth verifica se o token JWT atual ainda é válido
export const checkAuth = async (): Promise<boolean> => {
  if (!getToken()) return false;
  try {
    const r = await fetch(apiUrl("/api/config"), { 
      headers: { "Authorization": `Bearer ${getToken()}` } 
    });
    return r.ok;
  } catch {
    return false;
  }
};
