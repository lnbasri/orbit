import { z } from "zod";

export const MIN_BIRTH_YEAR = 1900;

/** Keep digits and a leading +. 00… becomes +…; Dutch 06… becomes +316…. */
export function normalizeWhatsapp(raw: string): string {
  let v = raw.trim().replace(/[\s\-().]/g, "");
  if (v.startsWith("00")) v = "+" + v.slice(2);
  else if (/^06\d{8}$/.test(v)) v = "+31" + v.slice(1);
  return v;
}

const participantSchema = (currentYear: number) =>
  z.object({
    name: z.string().trim().min(1, "Nama peserta wajib diisi.").max(120, "Nama terlalu panjang."),
    gender: z.enum(["male", "female"], { error: "Jenis kelamin wajib dipilih." }),
    birthYear: z.coerce
      .number({ error: "Tahun lahir tidak valid." })
      .int("Tahun lahir tidak valid.")
      .min(MIN_BIRTH_YEAR, "Tahun lahir tidak valid.")
      .max(currentYear, "Tahun lahir tidak valid."),
  });

export function registrationSchema(maxFamily: number, currentYear: number) {
  return z.object({
    registrantName: z.string().trim().min(1, "Nama pendaftar wajib diisi.").max(120),
    membership: z.enum(["Ya", "Tidak"], { error: "Pilih status keanggotaan." }),
    email: z.string().trim().toLowerCase().pipe(z.email("Format email tidak valid.")),
    whatsapp: z
      .string()
      .transform(normalizeWhatsapp)
      .pipe(z.string().regex(/^\+?\d{8,15}$/, "Nomor WhatsApp tidak valid.")),
    participants: z
      .array(participantSchema(currentYear))
      .min(1, "Minimal 1 peserta.")
      .max(maxFamily, `Maksimal ${maxFamily} peserta.`),
    consent: z.literal(true, { error: "Persetujuan privasi wajib dicentang." }),
    marketingOptIn: z.boolean(),
    idempotencyKey: z.string().uuid().optional(),
  });
}

export type RegistrationInput = z.infer<ReturnType<typeof registrationSchema>>;

/** Turn the posted form into the shape the schema expects. */
export function formToRegistrationDraft(form: FormData) {
  const count = Math.max(0, Math.min(20, Number(form.get("participantCount") ?? 0) || 0));
  const participants = Array.from({ length: count }, (_, i) => ({
    name: String(form.get(`p${i}_name`) ?? ""),
    gender: String(form.get(`p${i}_gender`) ?? ""),
    birthYear: String(form.get(`p${i}_birthYear`) ?? ""),
  }));
  const key = String(form.get("idempotencyKey") ?? "");
  return {
    registrantName: String(form.get("registrantName") ?? ""),
    membership: String(form.get("membership") ?? ""),
    email: String(form.get("email") ?? ""),
    whatsapp: String(form.get("whatsapp") ?? ""),
    participants,
    consent: form.get("consent") === "on",
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
