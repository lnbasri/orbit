// Login code email for the scanning team (check-in app). Bilingual: Indonesian first, Dutch below.
// Same visual language as the other emails: table layout, inline styles, no remote CSS or fonts.
import { formatDateTime, formatTime } from "../format";
import { describeDevice } from "./login-code";
import { escapeHtml } from "./templates";

const BRAND = "#034EA2";
const BRAND_DARK = "#023771";
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif";
const MONO = "'SFMono-Regular',Menlo,Consolas,'Liberation Mono','Courier New',monospace";

export interface ScannerLoginEmailArgs {
  code: string;
  email: string;
  requestedAt: string;
  expiresAt: string;
  validMinutes: number;
  appOrigin: string;
  userAgent?: string | null;
}

export function scannerLoginCodeEmail(args: ScannerLoginEmailArgs) {
  const { code, email, validMinutes, appOrigin } = args;
  const until = formatTime(args.expiresAt);
  const requested = formatDateTime(args.requestedAt);
  const device = describeDevice(args.userAgent);
  const origin = appOrigin.replace(/\/$/, "");
  const subject = `${code} – kode masuk / inlogcode PPME Check-in`;

  const p = (text: string, extra = "") =>
    `<p style="margin:0 0 12px 0;font-family:${FONT};font-size:15px;line-height:24px;color:#334155;${extra}">${text}</p>`;
  const small = (text: string) =>
    `<p style="margin:0 0 6px 0;font-family:${FONT};font-size:13px;line-height:20px;color:#64748B;">${text}</p>`;

  const html = `<!DOCTYPE html>
<html lang="id" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${escapeHtml(subject)}</title>
<style>
  body { margin:0; padding:0; -webkit-text-size-adjust:100%; }
  table { border-collapse:collapse; }
  img { border:0; outline:none; text-decoration:none; }
  @media only screen and (max-width:620px) {
    .container { width:100% !important; }
    .px { padding-left:24px !important; padding-right:24px !important; }
    .code { font-size:34px !important; letter-spacing:8px !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background-color:#F1F5F9;">
<div style="display:none;font-size:1px;line-height:1px;max-height:0;opacity:0;overflow:hidden;">Kode berlaku ${validMinutes} menit / Code geldig ${validMinutes} minuten. ${"&#8199;&#65279;&#847; ".repeat(30)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F1F5F9;">
  <tr>
    <td align="center" style="padding:40px 12px;">
      <table role="presentation" class="container" width="560" cellpadding="0" cellspacing="0" border="0" style="width:560px;max-width:560px;background-color:#FFFFFF;border:1px solid #E2E8F0;border-top:4px solid ${BRAND};">
        <tr>
          <td class="px" style="padding:28px 40px 24px 40px;border-bottom:1px solid #E2E8F0;">
            <img src="${escapeHtml(origin)}/logo-ppme.png" width="77" height="40" alt="PPME Den Haag" style="display:block;height:40px;width:auto;">
          </td>
        </tr>
        <tr>
          <td class="px" style="padding:32px 40px 8px 40px;">
            <p style="margin:0 0 10px 0;font-family:${FONT};font-size:11px;line-height:16px;font-weight:700;letter-spacing:1.6px;text-transform:uppercase;color:${BRAND};">PPME Check-in</p>
            <h1 style="margin:0 0 4px 0;font-family:${FONT};font-size:22px;line-height:30px;font-weight:700;color:#0F172A;">Masuk ke aplikasi check-in</h1>
            <p style="margin:0 0 20px 0;font-family:${FONT};font-size:15px;line-height:24px;color:#64748B;">Inloggen op de check-in app</p>
            ${p("Masukkan kode ini di halaman masuk yang sedang Anda buka.<br><span style=\"color:#64748B;\">Voer deze code in op de inlogpagina die u nu open heeft.</span>")}
          </td>
        </tr>
        <tr>
          <td class="px" style="padding:8px 40px 0 40px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F0F5FC;border:1px solid #C7D8F0;">
              <tr>
                <td align="center" style="padding:24px 16px 20px 16px;">
                  <p style="margin:0 0 8px 0;font-family:${FONT};font-size:12px;line-height:16px;font-weight:600;color:#475569;">Kode masuk / Inlogcode</p>
                  <p class="code" style="margin:0;padding-left:12px;font-family:${MONO};font-size:40px;line-height:48px;font-weight:700;letter-spacing:12px;color:${BRAND_DARK};">${escapeHtml(code)}</p>
                </td>
              </tr>
              <tr>
                <td align="center" style="padding:12px 16px;border-top:1px solid #C7D8F0;background-color:#E6EEFA;font-family:${FONT};font-size:13px;line-height:20px;color:#334155;">
                  Berlaku <strong style="color:#0F172A;">${validMinutes} menit</strong> (sampai ${escapeHtml(until)}) &middot; Geldig <strong style="color:#0F172A;">${validMinutes} minuten</strong> (tot ${escapeHtml(until)}), Europe/Amsterdam
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td class="px" style="padding:24px 40px 32px 40px;">
            ${small(`Akun / Account: <strong style="color:#0F172A;">${escapeHtml(email)}</strong>`)}
            ${small(`${escapeHtml(requested)}${device ? ` &middot; ${escapeHtml(device)}` : ""}`)}
            ${small("Jangan bagikan kode ini kepada siapa pun. Bukan Anda yang meminta? Abaikan email ini.")}
            ${small("Deel deze code met niemand. Niet door u aangevraagd? Negeer dit bericht.")}
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;

  const text = [
    `Kode masuk / Inlogcode PPME Check-in: ${code}`,
    ``,
    `Berlaku ${validMinutes} menit (sampai ${until}, Europe/Amsterdam). Jangan bagikan kode ini.`,
    `Geldig ${validMinutes} minuten (tot ${until}, Europe/Amsterdam). Deel deze code met niemand.`,
    ``,
    `Akun / Account: ${email}`,
  ].join("\n");

  return { subject, html, text };
}
