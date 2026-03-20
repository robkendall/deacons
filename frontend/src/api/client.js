const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/$/, "");

function buildUrl(path) {
  if (/^https?:\/\//i.test(path)) {
    return path;
  }

  if (!path.startsWith("/")) {
    throw new Error(`Expected API path to start with '/': ${path}`);
  }

  return `${API_BASE_URL}${path}`;
}

export async function apiFetch(path, options = {}) {
  const url = buildUrl(path);

  return fetch(url, {
    credentials: "include",
    ...options,
  });
}
