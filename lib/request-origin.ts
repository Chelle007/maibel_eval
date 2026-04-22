/**
 * Derive the public origin for redirects behind proxies/CDNs (e.g. Vercel).
 *
 * Vercel/Next middleware can observe an internal URL host (sometimes "localhost")
 * while the real public host is provided via forwarded headers.
 */
export function getRequestOrigin(req: Request): string {
  const h = req.headers;
  const forwardedProto = h.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const forwardedHost =
    h.get("x-forwarded-host")?.split(",")[0]?.trim() ??
    h.get("host")?.split(",")[0]?.trim();

  const proto = forwardedProto || "https";
  if (!forwardedHost) return `${proto}://localhost`;
  return `${proto}://${forwardedHost}`;
}

