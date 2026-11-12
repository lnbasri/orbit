// CSV for Excel: UTF-8 with BOM (so Indonesian names render correctly), CRLF line endings,
// RFC 4180 quoting, and a guard against spreadsheet formula injection.

function cell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let s = String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\r\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: Record<string, unknown>[], columns?: string[]): string {
  const cols = columns ?? (rows[0] ? Object.keys(rows[0]) : []);
  const lines = [cols.map(cell).join(","), ...rows.map((r) => cols.map((c) => cell(r[c])).join(","))];
  return "﻿" + lines.join("\r\n") + "\r\n";
}
