/** Vercel schedule invocations sometimes pass a path instead of an absolute URL. */
export function requestUrl(request: Request): URL {
  const raw = request.url ?? '';
  try {
    return new URL(raw);
  } catch {
    const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host') ?? 'localhost';
    const proto = request.headers.get('x-forwarded-proto') ?? 'https';
    const path = raw.startsWith('/') ? raw : `/${raw}`;
    return new URL(path, `${proto}://${host}`);
  }
}
