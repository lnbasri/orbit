export const DEFAULT_CURRENCY_CODE = "EUR";
export const MAX_AMOUNT_MINOR_UNITS = 1_000_000_000_000;

export interface CurrencyInfo {
  code: string;
  exponent: number;
}

export function getCurrencyInfo(value: string): CurrencyInfo | null {
  const code = value.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) return null;
  try {
    const exponent = new Intl.NumberFormat("en", {
      style: "currency",
      currency: code,
    }).resolvedOptions().maximumFractionDigits;
    if (typeof exponent !== "number" || exponent < 0 || exponent > 3) return null;
    return { code, exponent };
  } catch {
    return null;
  }
}

export function parseMoneyToMinorUnits(value: string, exponent: number): number | null {
  const match = value.trim().match(/^(\d+)(?:\.(\d+))?$/);
  if (!match) return null;
  const fraction = match[2] ?? "";
  if (fraction.length > exponent) return null;
  try {
    const scale = 10n ** BigInt(exponent);
    const minorUnits =
      BigInt(match[1]) * scale +
      BigInt((fraction + "0".repeat(exponent)).slice(0, exponent) || "0");
    if (minorUnits <= 0n || minorUnits > BigInt(MAX_AMOUNT_MINOR_UNITS)) return null;
    return Number(minorUnits);
  } catch {
    return null;
  }
}

export function formatMinorUnits(
  amount: number,
  currencyCode: string,
  exponent: number,
): string {
  return new Intl.NumberFormat("en", {
    style: "currency",
    currency: currencyCode,
    minimumFractionDigits: exponent,
    maximumFractionDigits: exponent,
  }).format(amount / 10 ** exponent);
}

export function formatMinorUnitsInput(amount: number, exponent: number): string {
  const value = BigInt(amount);
  const scale = 10n ** BigInt(exponent);
  const whole = value / scale;
  if (!exponent) return String(whole);
  const fraction = String(value % scale).padStart(exponent, "0");
  return `${whole}.${fraction}`;
}

export function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
