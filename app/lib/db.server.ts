// Small audit helpers shared by ORBIT server modules.

export async function audit(
  db: D1Database,
  actor: string,
  action: string,
  target: string | null,
  detail?: unknown,
  nowIso = new Date().toISOString(),
) {
  await auditStatement(db, actor, action, target, detail, nowIso).run();
}

export function auditStatement(
  db: D1Database,
  actor: string,
  action: string,
  target: string | null,
  detail: unknown,
  nowIso: string,
) {
  return db
    .prepare("INSERT INTO audit_log (at, actor, action, target, detail) VALUES (?, ?, ?, ?, ?)")
    .bind(nowIso, actor, action, target, detail === undefined ? null : JSON.stringify(detail));
}
