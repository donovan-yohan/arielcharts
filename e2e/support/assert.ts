export function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

export function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
