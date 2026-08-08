export function isOriginAllowed(origin: string | undefined, allowedOrigins: readonly string[]): boolean {
  if (!origin) {
    return true;
  }

  if (allowedOrigins.length === 0 || allowedOrigins.includes('*')) {
    return true;
  }

  return allowedOrigins.includes(origin);
}

/** Cookie-authenticated browser traffic must name one configured origin. */
export function isCredentialedBrowserOriginAllowed(origin: string | undefined, allowedOrigins: readonly string[]): boolean {
  return Boolean(origin) && allowedOrigins.length > 0 && !allowedOrigins.includes('*') && allowedOrigins.includes(origin!);
}

/** MCP clients normally omit Origin; a present Origin still has to be explicitly allowed. */
export function isMcpOriginAllowed(origin: string | undefined, allowedOrigins: readonly string[]): boolean {
  return origin === undefined || isCredentialedBrowserOriginAllowed(origin, allowedOrigins);
}
