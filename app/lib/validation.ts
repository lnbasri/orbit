import { z } from "zod";
import { AGE_GROUPS } from "./format";

export const REGISTRANT_MUST_BE_ADULT = "Pendaftar (peserta 1) harus berusia dewasa (18 tahun ke atas).";

/** Keep digits and a leading +. 00… becomes +…; Dutch 06… becomes +316…. */
export function normalizeWhatsapp(raw: string): string {
  let v = raw.trim().replace(/[\s\-().]/g, "");
  if (v.startsWith("00")) v = "+" + v.slice(2);
  else if (/^06\d{8}$/.test(v)) v = "+31" + v.slice(1);
  return v;
}

const participantSchema = () =>
  z.object({
    name: z.string().trim().min(1, "Nama peserta wajib diisi.").max(120, "Nama terlalu panjang."),
    gender: z.enum(["laki-laki", "perempuan"], { error: "Jenis kelamin wajib dipilih." }),
    ageGroup: z.enum(AGE_GROUPS, { error: "Kelompok usia wajib dipilih." }),
  });

export function registrationSchema(maxFamily: number) {
  return z.object({
    registrantName: z.string().trim().min(1, "Nama pendaftar wajib diisi.").max(120, "Nama terlalu panjang."),
    membership: z.enum(["Ya", "Tidak"], { error: "Pilih status keanggotaan." }),
    email: z.string().trim().toLowerCase().pipe(z.email("Format email tidak valid.")),
    whatsapp: z
      .string()
      .transform(normalizeWhatsapp)
      .pipe(z.string().regex(/^\+?\d{8,15}$/, "Nomor WhatsApp tidak valid.")),
    participants: z
      .array(participantSchema())
      .min(1, "Minimal 1 peserta.")
      .max(maxFamily, `Maksimal ${maxFamily} peserta.`),
    consent: z.literal(true, { error: "Persetujuan privasi wajib dicentang." }),
    mediaConsent: z.literal(true, { error: "Pemberitahuan dokumentasi dan siaran langsung wajib dicentang." }),
    marketingOptIn: z.boolean(),
    idempotencyKey: z.string().uuid().optional(),
  }).refine((v) => v.participants[0]?.ageGroup === "dewasa", {
    path: ["participants", 0, "ageGroup"],
    error: REGISTRANT_MUST_BE_ADULT,
  });
}

export type RegistrationInput = z.infer<ReturnType<typeof registrationSchema>>;

/** Turn the posted form into the shape the schema expects. */
export function formToRegistrationDraft(form: FormData) {
  const count = Math.max(0, Math.min(20, Number(form.get("participantCount") ?? 0) || 0));
  const participants = Array.from({ length: count }, (_, i) => ({
    name: String(form.get(`p${i}_name`) ?? ""),
    gender: String(form.get(`p${i}_gender`) ?? ""),
    ageGroup: String(form.get(`p${i}_ageGroup`) ?? ""),
  }));
  const key = String(form.get("idempotencyKey") ?? "");
  return {
    registrantName: String(form.get("registrantName") ?? ""),
    membership: String(form.get("membership") ?? ""),
    email: String(form.get("email") ?? ""),
    whatsapp: String(form.get("whatsapp") ?? ""),
    participants,
    consent: form.get("consent") === "on",
    mediaConsent: form.get("mediaConsent") === "on",
    marketingOptIn: form.get("marketingOptIn") === "on",
    idempotencyKey: key || undefined,
  };
}

export type FieldErrors = Record<string, string>;

/** Flatten zod issues to { "participants.0.name": "..." }. */
export function toFieldErrors(error: z.ZodError): FieldErrors {
  const out: FieldErrors = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_form";
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}

/**
 * Front-end validation for the public form: the same schema the server uses (so both always agree), with
 * friendlier Indonesian messages for empty and malformed fields. The server stays authoritative.
 */
export function validateRegistrationDraft(
  draft: ReturnType<typeof formToRegistrationDraft>,
  maxFamily: number,
): FieldErrors {
  const parsed = registrationSchema(maxFamily).safeParse(draft);
  if (parsed.success) return {};
  const errors = toFieldErrors(parsed.error);

  if (errors.email)
    errors.email = draft.email.trim() ? "Format email tidak valid. Contoh: nama@email.com." : "Alamat email wajib diisi.";
  if (errors.whatsapp)
    errors.whatsapp = draft.whatsapp.trim()
      ? "Nomor WhatsApp tidak valid. Gunakan 8–15 angka, contoh: +31 6 1234 5678."
      : "Nomor WhatsApp wajib diisi.";
  return errors;
}

/** Self-service edit ("Pendaftaran saya"): the same field rules as registration, plus the existing participant id. */
export function selfEditSchema(maxFamily: number) {
  return z.object({
    registrantName: z.string().trim().min(1, "Nama pendaftar wajib diisi.").max(120),
    whatsapp: z
      .string()
      .transform(normalizeWhatsapp)
      .pipe(z.string().regex(/^\+?\d{8,15}$/, "Nomor WhatsApp tidak valid.")),
    participants: z
      .array(participantSchema().extend({ id: z.string().max(64).optional() }))
      .min(1, "Minimal 1 peserta.")
      .max(maxFamily, `Maksimal ${maxFamily} peserta.`),
  }).refine((v) => v.participants[0]?.ageGroup === "dewasa", {
    path: ["participants", 0, "ageGroup"],
    error: REGISTRANT_MUST_BE_ADULT,
  });
}

export type SelfEditInput = z.infer<ReturnType<typeof selfEditSchema>>;

export function formToSelfEditDraft(form: FormData) {
  const count = Math.max(0, Math.min(20, Number(form.get("participantCount") ?? 0) || 0));
  return {
    registrantName: String(form.get("registrantName") ?? ""),
    whatsapp: String(form.get("whatsapp") ?? ""),
    participants: Array.from({ length: count }, (_, i) => {
      const id = String(form.get(`p${i}_id`) ?? "");
      return {
        ...(id ? { id } : {}),
        name: String(form.get(`p${i}_name`) ?? ""),
        gender: String(form.get(`p${i}_gender`) ?? ""),
        ageGroup: String(form.get(`p${i}_ageGroup`) ?? ""),
      };
    }),
  };
}
