/**
 * Robust E.164 phone number formatter.
 * Pure TypeScript — no external dependencies.
 */

const MIN_DIGITS = 10;
const US_LOCAL_LENGTH = 10;

/**
 * Converts a raw phone string to E.164 format.
 *
 * @param raw            - The raw phone number input (may contain spaces, dashes, parens, etc.)
 * @param defaultCountry - 'US' (default) or 'GB'. Determines how bare numbers are prefixed.
 * @returns              - The E.164 formatted string, or `null` if the input is invalid.
 */
export function toE164(
  raw: string | null | undefined,
  defaultCountry: string = "US",
): string | null {
  if (!raw) return null;

  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;

  const hasLeadingPlus = trimmed.startsWith("+");

  // Strip everything except digits (and leading +)
  const digitsOnly = trimmed.replace(/[^\d]/g, "");

  if (digitsOnly.length === 0) return null;

  // Number already has an international prefix
  if (hasLeadingPlus) {
    if (digitsOnly.length < MIN_DIGITS) return null;
    return `+${digitsOnly}`;
  }

  const country = defaultCountry.toUpperCase();

  // UK handling: leading 0 is the trunk prefix → strip and prepend +44
  if (country === "GB") {
    if (digitsOnly.startsWith("0")) {
      const withoutTrunk = digitsOnly.slice(1);
      if (withoutTrunk.length < MIN_DIGITS - 1) return null;
      return `+44${withoutTrunk}`;
    }

    // Already starts with 44 (no plus) — just prepend +
    if (digitsOnly.startsWith("44") && digitsOnly.length >= MIN_DIGITS) {
      return `+${digitsOnly}`;
    }

    // Bare number without trunk zero or country code — prepend +44
    if (digitsOnly.length < MIN_DIGITS - 1) return null;
    return `+44${digitsOnly}`;
  }

  // US handling (default)
  // 10-digit local number → prepend +1
  if (digitsOnly.length === US_LOCAL_LENGTH) {
    return `+1${digitsOnly}`;
  }

  // Already starts with 1 and has 11 digits — assume US with country code
  if (
    digitsOnly.startsWith("1") &&
    digitsOnly.length === US_LOCAL_LENGTH + 1
  ) {
    return `+${digitsOnly}`;
  }

  // Generic fallback: if enough digits, prepend +
  if (digitsOnly.length >= MIN_DIGITS) {
    return `+${digitsOnly}`;
  }

  return null;
}
