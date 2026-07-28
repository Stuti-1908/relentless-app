// Lightweight CSRF defense for state-changing API routes: require that a browser-issued POST
// originates from our own site. Browsers always send `Origin` on cross-origin POSTs, so a forged
// cross-site request is rejected. Non-browser callers (no Origin header) are allowed through.
export function sameOriginOk(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true; // server-to-server / same-origin fetch without Origin — allow
  try {
    const originHost = new URL(origin).host;
    const host = request.headers.get("host") || request.headers.get("x-forwarded-host") || "";
    return !!host && originHost === host;
  } catch {
    return false;
  }
}
