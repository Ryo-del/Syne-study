import { ApiError, authHeaders, getApiBase, whenApiReady } from "../lib/api";

/** Байты файла через локальный API. Заголовок с токеном остаётся в запросе, в адрес токен не попадает. */
export async function fetchFileBlob(owner: string, path: string, signal?: AbortSignal): Promise<Blob> {
  await whenApiReady();
  const res = await fetch(new URL("/api/files/blob", getApiBase()).toString(), {
    method: "POST",
    signal,
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ owner, path }),
  });
  if (!res.ok) {
    let message = `Request failed: ${res.status}`;
    let code = "";
    try {
      const body = (await res.json()) as { error?: string; code?: string };
      if (body.error) message = body.error;
      if (body.code) code = body.code;
    } catch {
      // тело ответа не JSON
    }
    throw new ApiError(message, res.status, code);
  }
  return res.blob();
}

const MAX_CACHE = 80;
const cache = new Map<string, Promise<string>>();

/** Адрес картинки для <img>. Живёт в памяти окна, на диск ничего не пишется. */
export function loadImageUrl(owner: string, path: string): Promise<string> {
  const key = `${owner}\u0000${path}`;
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }
  const p = fetchFileBlob(owner, path).then((b) => URL.createObjectURL(b));
  cache.set(key, p);
  p.catch(() => cache.delete(key));
  while (cache.size > MAX_CACHE) {
    const [k, v] = cache.entries().next().value as [string, Promise<string>];
    cache.delete(k);
    v.then(
      (u) => URL.revokeObjectURL(u),
      () => undefined,
    );
  }
  return p;
}

export function clearImageCache() {
  for (const v of cache.values()) {
    v.then(
      (u) => URL.revokeObjectURL(u),
      () => undefined,
    );
  }
  cache.clear();
}