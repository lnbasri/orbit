import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { getPlatformProxy } from "wrangler";

import type { OrbitEmailConfig } from "../app/lib/config.server";

export async function startDb() {
  const proxy = await getPlatformProxy<{ DB: D1Database; DOCUMENTS: R2Bucket }>({ configPath: "wrangler.jsonc", persist: false });
  const db = proxy.env.DB;
  const dir = join(process.cwd(), "migrations");
  for (const file of readdirSync(dir).filter((file) => file.endsWith(".sql")).sort()) {
    const sql = readFileSync(join(dir, file), "utf8")
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n");
    const statements = sql
      .replace(/CREATE TRIGGER[\s\S]*?END;/gi, (trigger) =>
        `${trigger.slice(0, -1).replace(/;/g, "\u0000")};`,
      )
      .split(/;\s*(?:\n|$)/)
      .map((item) => item.replace(/\u0000/g, ";").trim())
      .filter(Boolean);
    for (const statement of statements) {
      await db.prepare(statement).run();
    }
  }
  return { db, documents: proxy.env.DOCUMENTS, dispose: () => proxy.dispose() };
}

export async function resetDb(db: D1Database) {
  await db.batch([
    db.prepare("DELETE FROM member_history"),
    db.prepare("DELETE FROM member_relationships"),
    db.prepare("DELETE FROM member_group_memberships"),
    db.prepare("DELETE FROM member_households"),
    db.prepare("UPDATE households SET head_member_id = NULL"),
    db.prepare("DELETE FROM generated_documents"),
    db.prepare("DELETE FROM contribution_payments"),
    db.prepare("DELETE FROM contributions"),
    db.prepare("DELETE FROM send_queue"),
    db.prepare("DELETE FROM approval_comments"),
    db.prepare("DELETE FROM admin_notifications"),
    db.prepare("DELETE FROM approval_requests"),
    db.prepare("DELETE FROM members"),
    db.prepare("DELETE FROM groups"),
    db.prepare("DELETE FROM households"),
    db.prepare("DELETE FROM dev_outbox"),
    db.prepare("DELETE FROM admin_sessions"),
    db.prepare("DELETE FROM admin_login_codes"),
    db.prepare("DELETE FROM audit_log"),
    db.prepare("DELETE FROM admins"),
    db.prepare("DELETE FROM unsubscribe_tokens"),
    db.prepare("DELETE FROM communication_logs"),
    db.prepare("DELETE FROM communications"),
    db.prepare("DELETE FROM email_templates WHERE is_system = 0"),
    db.prepare("DELETE FROM document_templates WHERE created_by <> 'system'"),
    db.prepare("DELETE FROM unsubscribes"),
  ]);
}

export const emailCfg: OrbitEmailConfig = {
  mode: "log",
  from: "ORBIT <test@example.org>",
  replyTo: "test@example.org",
};

export const T0 = new Date("2026-11-20T10:00:00.000Z");
