export const EMAIL_TEMPLATE_INPUT_FIELDS = [
  { key: "title", label: "Title", type: "text", maxLength: 160 },
  { key: "content", label: "Message", type: "textarea", maxLength: 10000 },
  { key: "contribution_amount", label: "Contribution amount", type: "text", maxLength: 80 },
  { key: "contribution_date", label: "Contribution date", type: "date", maxLength: 10 },
  { key: "invoice_number", label: "Invoice number", type: "text", maxLength: 80 },
  { key: "due_date", label: "Due date", type: "date", maxLength: 10 },
] as const;

export type EmailTemplateInputField = (typeof EMAIL_TEMPLATE_INPUT_FIELDS)[number]["key"];

export interface EmailTemplateContent {
  subject: string;
  html: string;
  text: string | null;
}

export function isEmailTemplateInputField(value: unknown): value is EmailTemplateInputField {
  return EMAIL_TEMPLATE_INPUT_FIELDS.some((field) => field.key === value);
}

export function inferEmailTemplateInputFields(
  template: EmailTemplateContent,
): EmailTemplateInputField[] {
  const content = `${template.subject}\n${template.html}\n${template.text ?? ""}`;
  return EMAIL_TEMPLATE_INPUT_FIELDS
    .filter(({ key }) => content.includes(`{{${key}}}`) || content.includes(`{{{${key}}}}`))
    .map(({ key }) => key);
}

export function resolveEmailTemplateInputFields(
  inputFieldsJson: string | null,
  template: EmailTemplateContent,
): EmailTemplateInputField[] {
  if (inputFieldsJson === null) return inferEmailTemplateInputFields(template);

  const parsed: unknown = JSON.parse(inputFieldsJson);
  if (!Array.isArray(parsed) || !parsed.every(isEmailTemplateInputField)) {
    throw new Error("Stored email template input fields are invalid.");
  }
  return EMAIL_TEMPLATE_INPUT_FIELDS
    .filter(({ key }) => parsed.includes(key))
    .map(({ key }) => key);
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function renderEmailTemplate(
  template: EmailTemplateContent,
  fields: Record<string, string>,
) {
  const replace = (value: string, html = false) =>
    value.replace(/\{\{\{(\w+)\}\}\}|\{\{(\w+)\}\}/g, (match, rawKey, escapedKey) => {
      const key = rawKey ?? escapedKey;
      if (fields[key] === undefined) return match;
      return html && !rawKey ? escapeHtml(fields[key]) : fields[key];
    });
  return {
    subject: replace(template.subject),
    html: replace(template.html, true),
    text: replace(template.text ?? ""),
  };
}
