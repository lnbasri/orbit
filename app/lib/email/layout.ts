// Shared look for the registration emails (confirmation, payment instructions, reminder, expired): the same card
// layout as the login-code email. Table layout + inline styles so it renders the same in Gmail, Outlook, Apple Mail
// and mobile clients. No web fonts or remote CSS (privacy rule); the only remote asset is our own logo.
//
// MOBILE FIRST: the inline styles ARE the phone layout (edge-to-edge card, 20px side padding, stacked label/value rows),
// so it still looks right when a client drops the style block (Gmail does for non-Gmail accounts). The media query
// only ADDS the roomier desktop look. See .claude/skills/email-templates/SKILL.md.

export const BRAND = "#034EA2";
export const BRAND_DARK = "#023771";
export const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif";
export const MONO = "'SFMono-Regular',Menlo,Consolas,'Liberation Mono','Courier New',monospace";

export function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === '"' ? "&quot;" : "&#39;",
  );
}

// ---- content building blocks (all return HTML strings; `html` arguments are trusted, plain text must be escaped) ----

/** Body paragraph. */
export const para = (html: string, margin = "0 0 14px 0") =>
  `<p style="margin:${margin};font-family:${FONT};font-size:15px;line-height:24px;color:#334155;">${html}</p>`;

/** Small uppercase section label. */
export const sectionLabel = (text: string) =>
  `<p style="margin:32px 0 6px 0;font-family:${FONT};font-size:11px;line-height:16px;font-weight:700;letter-spacing:1.6px;text-transform:uppercase;color:#64748B;">${escapeHtml(text)}</p>`;

/** Section heading. */
export const heading = (text: string) =>
  `<h2 style="margin:28px 0 8px 0;font-family:${FONT};font-size:17px;line-height:24px;font-weight:700;color:#0F172A;">${escapeHtml(text)}</h2>`;

/** Bulleted list; items are trusted HTML. */
export const bullets = (items: string[]) =>
  `<ul style="margin:0 0 14px 0;padding:0 0 0 20px;font-family:${FONT};font-size:14px;line-height:22px;color:#334155;">${items
    .map((i) => `<li style="margin:0 0 6px 0;">${i}</li>`)
    .join("")}</ul>`;

/**
 * Label above value, rows separated by thin lines (values are escaped). Stacked on purpose, in ONE cell per row:
 * a two-column table wastes a third of a phone screen and needs a media query to stack.
 */
/** A detail value is plain text (escaped) or `{ html }` for pre-escaped markup such as a link. */
export type DetailValue = string | { html: string };
export const detailTable = (rows: [string, DetailValue][]) =>
  `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rows
    .map(([label, value], i) => {
      const border = i === rows.length - 1 ? "" : "border-bottom:1px solid #E2E8F0;";
      return (
        `<tr><td style="padding:10px 0;${border}font-family:${FONT};">` +
        `<span style="display:block;font-size:12px;line-height:18px;color:#64748B;">${escapeHtml(label)}</span>` +
        `<span style="display:block;font-size:14px;line-height:22px;color:#0F172A;font-weight:600;">${typeof value === "string" ? escapeHtml(value) : value.html}</span>` +
        `</td></tr>`
      );
    })
    .join("")}</table>`;

/** Callout with a coloured left bar (like the security notice in the login-code email). */
export const callout = (inner: string, accent = BRAND, bg = "#F0F5FC", color = "#1E3A5F") =>
  `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:18px 0;background-color:${bg};border-left:3px solid ${accent};">` +
  `<tr><td style="padding:14px 16px;font-family:${FONT};font-size:13px;line-height:21px;color:${color};">${inner}</td></tr></table>`;

/** Bulletproof button link (table cell carries the background so Outlook renders it too). */
export const buttonLink = (label: string, href: string) =>
  `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:6px 0 16px 0;">` +
  `<tr><td align="center" bgcolor="${BRAND}" style="background-color:${BRAND};">` +
  `<a href="${escapeHtml(href)}" target="_blank" style="display:inline-block;padding:13px 26px;font-family:${FONT};font-size:15px;line-height:20px;font-weight:700;color:#FFFFFF;text-decoration:none;background-color:${BRAND};border:1px solid ${BRAND_DARK};">${escapeHtml(label)}</a>` +
  `</td></tr></table>`;

/** Big monospaced code panel with a footer strip (the payment code, like the PIN in the login-code email). */
export const codePanel = (label: string, code: string, footerHtml: string) =>
  `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:18px 0;background-color:#F0F5FC;border:1px solid #C7D8F0;">` +
  `<tr><td align="center" style="padding:20px 12px 16px 12px;">` +
  `<p style="margin:0 0 8px 0;font-family:${FONT};font-size:12px;line-height:16px;font-weight:600;color:#475569;">${escapeHtml(label)}</p>` +
  `<p class="code" style="margin:0;font-family:${MONO};font-size:24px;line-height:34px;font-weight:700;letter-spacing:2px;color:${BRAND_DARK};">${escapeHtml(code)}</p>` +
  `</td></tr>` +
  `<tr><td align="center" style="padding:12px 16px;border-top:1px solid #C7D8F0;background-color:#E6EEFA;font-family:${FONT};font-size:13px;line-height:20px;color:#334155;">${footerHtml}</td></tr>` +
  `</table>`;

export interface ShellArgs {
  subject: string;
  /** Small caption at the top right of the header. */
  label: string;
  eyebrow: string;
  title: string;
  preheader: string;
  /** Trusted HTML, starts after the salam. */
  body: string;
  /** Absolute origin for the logo (e.g. https://event.ppmedenhaag.nl); without it the logo is replaced by text. */
  origin?: string;
  contact: string;
}

/** The full HTML document: logo header, eyebrow + title, salam, body, sign-off and footer. */
export function emailShell(a: ShellArgs): string {
  const origin = a.origin?.replace(/\/$/, "");
  const logo = origin
    ? `<img src="${escapeHtml(origin)}/logo-ppme.png" width="77" height="40" alt="PPME Den Haag" style="display:block;height:40px;width:auto;">`
    : `<span style="font-family:${FONT};font-size:16px;line-height:24px;font-weight:700;color:${BRAND_DARK};">PPME Den Haag</span>`;
  return `<!DOCTYPE html>
<html lang="id" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="format-detection" content="telephone=no,date=no,address=no,email=no">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${escapeHtml(a.subject)}</title>
<style>
  body { margin:0; padding:0; -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%; }
  table { border-collapse:collapse; mso-table-lspace:0; mso-table-rspace:0; }
  img { border:0; outline:none; text-decoration:none; -ms-interpolation-mode:bicubic; }
  a { color:${BRAND}; }
  /* Desktop extras only; the inline styles already give a complete phone layout. */
  @media only screen and (min-width:621px) {
    .outer { padding:40px 12px !important; }
    .container { border-left:1px solid #E2E8F0 !important; border-right:1px solid #E2E8F0 !important; border-bottom:1px solid #E2E8F0 !important; }
    .px { padding-left:40px !important; padding-right:40px !important; }
    .code { font-size:30px !important; letter-spacing:4px !important; }
    .qr { padding:18px 20px !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background-color:#F1F5F9;">
<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">${escapeHtml(a.preheader)}${"&#8199;&#65279;&#847; ".repeat(40)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F1F5F9;">
  <tr>
    <td align="center" class="outer" style="padding:0;">
      <table role="presentation" class="container" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background-color:#FFFFFF;border-top:4px solid ${BRAND};">
        <tr>
          <td class="px" style="padding:22px 20px 18px 20px;border-bottom:1px solid #E2E8F0;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="vertical-align:middle;">${logo}</td>
                <td align="right" style="vertical-align:middle;font-family:${FONT};font-size:11px;line-height:16px;font-weight:700;letter-spacing:1.6px;text-transform:uppercase;color:#64748B;">${escapeHtml(a.label)}</td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td class="px" style="padding:28px 20px 8px 20px;">
            <p style="margin:0 0 10px 0;font-family:${FONT};font-size:11px;line-height:16px;font-weight:700;letter-spacing:1.6px;text-transform:uppercase;color:${BRAND};">${escapeHtml(a.eyebrow)}</p>
            <h1 style="margin:0 0 20px 0;font-family:${FONT};font-size:24px;line-height:32px;font-weight:700;color:#0F172A;">${escapeHtml(a.title)}</h1>
            ${para("Assalamu’alaikum warahmatullahi wabarakatuh,", "0 0 12px 0")}
            ${a.body}
          </td>
        </tr>
        <tr>
          <td class="px" style="padding:20px 20px 28px 20px;">
            ${para("Wassalamu’alaikum warahmatullahi wabarakatuh,", "0 0 4px 0")}
            <p style="margin:0;font-family:${FONT};font-size:15px;line-height:24px;font-weight:700;color:#0F172A;">Panitia Kajian PPME Den Haag</p>
          </td>
        </tr>
      </table>
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;">
        <tr>
          <td class="px" style="padding:20px 20px 0 20px;font-family:${FONT};font-size:12px;line-height:19px;color:#64748B;text-align:center;">
            Pertanyaan? Hubungi <a href="mailto:${escapeHtml(a.contact)}" style="color:#475569;text-decoration:underline;">${escapeHtml(a.contact)}</a>.
          </td>
        </tr>
        <tr>
          <td class="px" style="padding:12px 20px 24px 20px;font-family:${FONT};font-size:12px;line-height:19px;color:#94A3B8;text-align:center;">
            PPME Den Haag &middot; <a href="https://www.ppmedenhaag.nl/" style="color:#94A3B8;text-decoration:none;">ppmedenhaag.nl</a>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}
