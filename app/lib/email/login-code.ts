import { formatDateTime, formatTime } from "../format";

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif";

export interface LoginCodeEmailArgs {
  code: string;
  email: string;
  requestedAt: string;
  expiresAt: string;
  validMinutes: number;
  appOrigin: string;
  country?: string | null;
  userAgent?: string | null;
  replyTo: string;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function countryName(code: string | null | undefined): string | null {
  if (!code || !/^[A-Z]{2}$/.test(code) || code === "XX" || code === "T1") return null;
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

export function describeDevice(ua: string | null | undefined): string | null {
  if (!ua) return null;
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /Firefox\//.test(ua)
      ? "Firefox"
      : /Chrome\/|CriOS\//.test(ua)
        ? "Chrome"
        : /Safari\//.test(ua)
          ? "Safari"
          : null;
  const os = /iPhone|iPad|iPod/.test(ua)
    ? "iOS"
    : /Android/.test(ua)
      ? "Android"
      : /Windows/.test(ua)
        ? "Windows"
        : /Mac OS X|Macintosh/.test(ua)
          ? "macOS"
          : /Linux/.test(ua)
            ? "Linux"
            : null;
  if (browser && os) return `${browser} on ${os}`;
  return browser ?? os;
}

export function loginCodeEmail(args: LoginCodeEmailArgs) {
  const subject = `${args.code} is your ORBIT sign-in code`;
  const origin = args.appOrigin.replace(/\/$/, "");
  const location = countryName(args.country);
  const device = describeDevice(args.userAgent);
  const details = [
    ["Account", args.email],
    ["Requested", `${formatDateTime(args.requestedAt)} (Europe/Amsterdam)`],
    ...(device ? [["Device", device]] : []),
    ...(location ? [["Approximate location", location]] : []),
  ];

  const html = `<!doctype html>
<html lang="en">
<body style="margin:0;background:#f1f5f9;font-family:${FONT};">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f1f5f9;padding:40px 12px;">
    <tr><td align="center">
      <table role="presentation" width="560" cellspacing="0" cellpadding="0" style="max-width:560px;width:100%;background:#fff;border:1px solid #e2e8f0;border-top:4px solid #034ea2;">
        <tr><td style="padding:28px 40px;border-bottom:1px solid #e2e8f0;">
          <div style="font-size:20px;font-weight:700;letter-spacing:5px;color:#034ea2;">ORBIT</div>
        </td></tr>
        <tr><td style="padding:36px 40px 20px;">
          <p style="margin:0 0 10px;font-size:12px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#034ea2;">Sign-in code</p>
          <h1 style="margin:0 0 16px;font-size:24px;color:#0f172a;">Sign in to ORBIT</h1>
          <p style="margin:0 0 24px;font-size:15px;line-height:24px;color:#475569;">Use the code below on the ORBIT sign-in page. It is valid for ${args.validMinutes} minutes and for one use.</p>
          <div style="margin:0 0 24px;padding:22px;background:#f8fafc;border:1px solid #cbd5e1;text-align:center;font-family:'SFMono-Regular',Menlo,monospace;font-size:34px;font-weight:700;letter-spacing:10px;color:#0f172a;">${escapeHtml(args.code)}</div>
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
            ${details.map(([label, value]) => `<tr><td style="padding:8px 0;border-top:1px solid #e2e8f0;font-size:13px;color:#64748b;width:42%;">${escapeHtml(label)}</td><td style="padding:8px 0;border-top:1px solid #e2e8f0;font-size:13px;font-weight:600;color:#0f172a;">${escapeHtml(value)}</td></tr>`).join("")}
          </table>
        </td></tr>
        <tr><td style="padding:20px 40px;border-top:1px solid #e2e8f0;font-size:12px;line-height:18px;color:#64748b;">
          This code expires at ${escapeHtml(formatTime(args.expiresAt))}. If you did not request it, ignore this email.
          <br><a href="${escapeHtml(origin)}/admin" style="color:#034ea2;">Open ORBIT</a>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
  const text = `Your ORBIT sign-in code is ${args.code}. It expires at ${formatTime(args.expiresAt)} and is valid for one use.\n\nOpen: ${origin}/admin\n\nIf you did not request this code, ignore this email.`;
  return { subject, html, text };
}
