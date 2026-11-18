export function normalizeCallsign(input: string | null | undefined): string {
  const normalized = (input ?? '').trim().toUpperCase();

  if (
    normalized.length === 0 ||
    normalized.length > 32 ||
    !normalized.includes('-')
  ) {
    return 'VULTURE-07';
  }

  const separator = normalized.indexOf('-');
  const prefix = normalized.substring(0, separator).trim();
  const suffix = normalized.substring(separator + 1).trim();

  if (!prefix || !suffix) {
    return 'VULTURE-07';
  }

  return normalized;
}
