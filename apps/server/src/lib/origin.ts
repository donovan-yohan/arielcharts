export function isOriginAllowed(origin: string | undefined, allowedOrigins: readonly string[]): boolean {
  if (!origin) {
    return true;
  }

  if (allowedOrigins.length === 0 || allowedOrigins.includes('*')) {
    return true;
  }

  return allowedOrigins.includes(origin);
}
