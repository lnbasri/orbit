import { normalizeEmail } from "./admins.server";
import { auditStatement } from "./db.server";

export type ApprovalResource = "document" | "communication";
export type ApprovalDecision = "approved" | "rejected";

export interface ApprovalInput {
  id: string;
  resourceType: ApprovalResource;
  resourceId: string;
  requestedBy: string;
  assignedTo: string;
  now: string;
}

export type ApprovalResult =
  | { ok: true; message: string }
  | { ok: false; message: string };

export async function validateApprover(
  db: D1Database,
  requestedBy: string,
  assignedTo: string,
): Promise<string | null> {
  const requester = normalizeEmail(requestedBy);
  const assignee = normalizeEmail(assignedTo);
  if (!assignee || assignee === requester) {
    return "Choose a different administrator to review this item.";
  }
  const row = await db
    .prepare("SELECT 1 FROM admins WHERE email = ? AND active = 1")
    .bind(assignee)
    .first();
  return row ? null : "The selected approver is not an active administrator.";
}

export function approvalRequestStatement(db: D1Database, input: ApprovalInput) {
  return db.prepare(
    `INSERT INTO approval_requests
       (id, resource_type, resource_id, requested_by, assigned_to, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)`,
  ).bind(
    input.id,
    input.resourceType,
    input.resourceId,
    normalizeEmail(input.requestedBy),
    normalizeEmail(input.assignedTo),
    input.now,
    input.now,
  );
}

export function approvalNotificationStatement(
  db: D1Database,
  requestId: string,
  recipient: string,
  message: string,
  href: string,
  now: string,
) {
  return db.prepare(
    `INSERT INTO admin_notifications (recipient, request_id, message, href, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).bind(normalizeEmail(recipient), requestId, message, href, now);
}

export async function decideApproval(
  db: D1Database,
  requestId: string,
  actorRaw: string,
  decision: ApprovalDecision,
  commentRaw = "",
  now = new Date(),
): Promise<ApprovalResult> {
  const actor = normalizeEmail(actorRaw);
  const comment = commentRaw.trim();
  if (decision === "rejected" && !comment) {
    return { ok: false, message: "Add a reason when rejecting an item." };
  }
  if (comment.length > 2000) {
    return { ok: false, message: "Comments must be 2,000 characters or fewer." };
  }

  const request = await db
    .prepare(
      `SELECT id, resource_type, resource_id, requested_by, assigned_to
       FROM approval_requests WHERE id = ? AND status = 'pending'`,
    )
    .bind(requestId)
    .first<{
      id: string;
      resource_type: ApprovalResource;
      resource_id: string;
      requested_by: string;
      assigned_to: string;
    }>();
  if (!request) return { ok: false, message: "This item is no longer awaiting approval." };
  if (request.assigned_to !== actor) {
    return { ok: false, message: "Only the assigned approver can review this item." };
  }
  if (request.requested_by === actor) {
    return { ok: false, message: "You cannot approve your own request." };
  }
  const admin = await db
    .prepare("SELECT 1 FROM admins WHERE email = ? AND active = 1")
    .bind(actor)
    .first();
  if (!admin) return { ok: false, message: "An active administrator account is required." };

  const timestamp = now.toISOString();
  const href = request.resource_type === "document" ? "/admin/documents" : "/admin/communications";
  const statements = [
    db.prepare(
      `UPDATE approval_requests
       SET status = ?, decision_by = ?, decision_at = ?, updated_at = ?
       WHERE id = ? AND status = 'pending' AND assigned_to = ? AND requested_by <> ?`,
    ).bind(decision, actor, timestamp, timestamp, requestId, actor, actor),
    ...(comment
      ? [
          db.prepare(
            `INSERT INTO approval_comments (request_id, author, body, created_at)
             SELECT ?, ?, ?, ? WHERE EXISTS (
               SELECT 1 FROM approval_requests
               WHERE id = ? AND status = ? AND decision_by = ? AND decision_at = ?
             )`,
          ).bind(requestId, actor, comment, timestamp, requestId, decision, actor, timestamp),
        ]
      : []),
    db.prepare(
      `INSERT INTO admin_notifications (recipient, request_id, message, href, created_at)
       SELECT requested_by, id, ?, ?, ? FROM approval_requests
       WHERE id = ? AND status = ? AND decision_by = ? AND decision_at = ?`,
    ).bind(
      decision === "approved" ? "An approval request was approved." : "An approval request was rejected.",
      href,
      timestamp,
      requestId,
      decision,
      actor,
      timestamp,
    ),
    db.prepare(
      `INSERT INTO audit_log (at, actor, action, target, detail)
       SELECT ?, ?, ?, ?, ? WHERE EXISTS (
         SELECT 1 FROM approval_requests
         WHERE id = ? AND status = ? AND decision_by = ? AND decision_at = ?
       )`,
    ).bind(
      timestamp,
      actor,
      `approval.${decision}`,
      requestId,
      JSON.stringify({ resourceType: request.resource_type, resourceId: request.resource_id }),
      requestId,
      decision,
      actor,
      timestamp,
    ),
  ];
  await db.batch(statements);
  const completed = await db.prepare(
    `SELECT 1 FROM approval_requests
     WHERE id = ? AND status = ? AND decision_by = ? AND decision_at = ?`,
  ).bind(requestId, decision, actor, timestamp).first();
  if (!completed) {
    return { ok: false, message: "Another administrator has already reviewed this item." };
  }
  return {
    ok: true,
    message: decision === "approved" ? "Item approved." : "Item rejected.",
  };
}

export async function markNotificationsRead(db: D1Database, actorRaw: string, now = new Date()) {
  await db
    .prepare("UPDATE admin_notifications SET read_at = ? WHERE recipient = ? AND read_at IS NULL")
    .bind(now.toISOString(), normalizeEmail(actorRaw))
    .run();
}

export async function createApprovalReminders(db: D1Database, now = new Date()) {
  const timestamp = now.toISOString();
  const overdueBefore = new Date(now.getTime() - 24 * 60 * 60_000).toISOString();
  const { results } = await db.prepare(
    `SELECT a.id, a.assigned_to, a.resource_type
     FROM approval_requests a
     JOIN admins admin ON admin.email = a.assigned_to AND admin.active = 1
     WHERE a.status = 'pending' AND a.created_at <= ?
       AND (a.last_reminded_at IS NULL OR a.last_reminded_at <= ?)
     ORDER BY a.created_at LIMIT 100`,
  ).bind(overdueBefore, overdueBefore).all<{
    id: string;
    assigned_to: string;
    resource_type: ApprovalResource;
  }>();
  for (const request of results) {
    const message = `Reminder: ${request.resource_type} approval is still pending.`;
    await db.batch([
      db.prepare(
        `UPDATE approval_requests SET last_reminded_at = ?
         WHERE id = ? AND status = 'pending'
           AND (last_reminded_at IS NULL OR last_reminded_at <= ?)`,
      ).bind(timestamp, request.id, overdueBefore),
      db.prepare(
        `INSERT INTO admin_notifications (recipient, request_id, message, href, created_at)
         SELECT assigned_to, id, ?, '/admin/approvals', ? FROM approval_requests
         WHERE id = ? AND status = 'pending' AND last_reminded_at = ?
           AND NOT EXISTS (
             SELECT 1 FROM admin_notifications n
             WHERE n.request_id = ? AND n.recipient = ? AND n.message = ? AND n.created_at = ?
           )`,
      ).bind(message, timestamp, request.id, timestamp, request.id, request.assigned_to, message, timestamp),
    ]);
  }
  return results.length;
}
