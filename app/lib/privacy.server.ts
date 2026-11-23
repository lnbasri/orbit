import { strToU8, zipSync } from "fflate";

import { auditStatement } from "./db.server";
import {
  PRIVACY_REQUEST_STATUSES,
  PRIVACY_REQUEST_TYPES,
  type PrivacyRequestStatus,
  type PrivacyRequestRow,
  type PrivacyRequestType,
  type VerificationStatus,
} from "./privacy-constants";

function isIsoDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function isRequestType(value: string): value is PrivacyRequestType {
  return PRIVACY_REQUEST_TYPES.includes(value as PrivacyRequestType);
}

function isRequestStatus(value: string): value is PrivacyRequestStatus {
  return PRIVACY_REQUEST_STATUSES.includes(value as PrivacyRequestStatus);
}

function normalizeOptionalDate(value: string) {
  const date = value.trim();
  return date || null;
}

export async function listPrivacyRequests(db: D1Database) {
  const { results } = await db.prepare(
    `SELECT r.*, m.full_name AS member_name
     FROM privacy_requests r
     LEFT JOIN members m ON m.id = r.member_id
     ORDER BY CASE WHEN r.status IN ('completed', 'declined') THEN 1 ELSE 0 END,
              COALESCE(r.due_on, r.received_on), r.created_at DESC`,
  ).all<PrivacyRequestRow>();
  return results;
}

export async function createPrivacyRequest(
  db: D1Database,
  actor: string,
  memberId: string,
  input: { requestType: string; receivedOn: string; dueOn: string; internalNotes: string },
  now = new Date(),
) {
  const requestType = input.requestType.trim();
  const receivedOn = input.receivedOn.trim();
  const dueOn = normalizeOptionalDate(input.dueOn);
  const internalNotes = input.internalNotes.trim();
  if (!isRequestType(requestType)) {
    return { ok: false as const, message: "Choose a valid request type." };
  }
  if (!isIsoDate(receivedOn)) {
    return { ok: false as const, message: "Enter a valid received date." };
  }
  if (dueOn && !isIsoDate(dueOn)) {
    return { ok: false as const, message: "Enter a valid target response date." };
  }
  if (dueOn && dueOn < receivedOn) {
    return { ok: false as const, message: "The target response date cannot be before the received date." };
  }
  if (internalNotes.length > 2000) {
    return { ok: false as const, message: "Internal notes must be 2000 characters or fewer." };
  }
  const member = await db.prepare("SELECT id FROM members WHERE id = ?")
    .bind(memberId).first<{ id: string }>();
  if (!member) return { ok: false as const, message: "Member not found." };

  const nowIso = now.toISOString();
  const id = crypto.randomUUID();
  await db.batch([
    db.prepare(
      `INSERT INTO privacy_requests
       (id, member_id, request_type, received_on, due_on, internal_notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(id, memberId, requestType, receivedOn, dueOn, internalNotes, nowIso, nowIso),
    auditStatement(
      db,
      actor,
      "privacy.request.create",
      id,
      { requestType, receivedOn, dueOn },
      nowIso,
    ),
  ]);
  return { ok: true as const, id, message: "Privacy request recorded." };
}

export async function updatePrivacyRequest(
  db: D1Database,
  actor: string,
  id: string,
  input: {
    status: string;
    verificationStatus: string;
    dueOn: string;
    internalNotes: string;
  },
  now = new Date(),
) {
  const status = input.status.trim();
  const verificationStatus = input.verificationStatus.trim();
  const dueOn = normalizeOptionalDate(input.dueOn);
  const internalNotes = input.internalNotes.trim();
  if (!isRequestStatus(status)) {
    return { ok: false as const, message: "Choose a valid request status." };
  }
  if (verificationStatus !== "pending" && verificationStatus !== "verified") {
    return { ok: false as const, message: "Choose a valid verification status." };
  }
  if (dueOn && !isIsoDate(dueOn)) {
    return { ok: false as const, message: "Enter a valid target response date." };
  }
  if (internalNotes.length > 2000) {
    return { ok: false as const, message: "Internal notes must be 2000 characters or fewer." };
  }

  const existing = await db.prepare(
    `SELECT received_on, internal_notes FROM privacy_requests WHERE id = ?`,
  ).bind(id).first<{ received_on: string; internal_notes: string }>();
  if (!existing) return { ok: false as const, message: "Privacy request not found." };
  if (dueOn && dueOn < existing.received_on) {
    return { ok: false as const, message: "The target response date cannot be before the received date." };
  }

  const nowIso = now.toISOString();
  const closedAt = status === "completed" || status === "declined" ? nowIso : null;
  const result = await db.batch([
    db.prepare(
      `UPDATE privacy_requests
       SET status = ?, verification_status = ?, due_on = ?, closed_at = ?,
           internal_notes = ?, updated_at = ?
       WHERE id = ?`,
    ).bind(status, verificationStatus, dueOn, closedAt, internalNotes, nowIso, id),
    auditStatement(
      db,
      actor,
      "privacy.request.update",
      id,
      {
        status,
        verificationStatus,
        dueOn,
        notesChanged: existing.internal_notes !== internalNotes,
      },
      nowIso,
    ),
  ]);
  if ((result[0]?.meta.changes ?? 0) !== 1) {
    return { ok: false as const, message: "Privacy request not found." };
  }
  return { ok: true as const, message: "Privacy request updated." };
}

function safeFileName(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || "document";
}

export async function buildPrivacyExport(
  db: D1Database,
  documents: R2Bucket,
  requestId: string,
  now = new Date(),
) {
  const request = await db.prepare(
    `SELECT id, member_id, request_type, status, verification_status, received_on,
            due_on, closed_at, created_at, updated_at
     FROM privacy_requests WHERE id = ?`,
  ).bind(requestId).first<Record<string, unknown>>();
  if (!request) throw new Error("Privacy request not found.");
  if (request.request_type !== "access" && request.request_type !== "portability") {
    throw new Error("A data export can only be prepared for an access or portability request.");
  }
  if (request.verification_status !== "verified") {
    throw new Error("Verify the requester's identity before preparing a data export.");
  }
  if (request.status === "declined") {
    throw new Error("A data export cannot be prepared for a declined request.");
  }
  if (typeof request.member_id !== "string") {
    throw new Error("This request is not linked to a member record.");
  }

  const member = await db.prepare("SELECT * FROM members WHERE id = ?")
    .bind(request.member_id).first<Record<string, unknown>>();
  if (!member) throw new Error("The member record linked to this request was not found.");

  const [historyResult, householdResult, groupResult, relationshipResult, auditResult] = await Promise.all([
    db.prepare(
      "SELECT changed_at, changes_json FROM member_history WHERE member_id = ? ORDER BY changed_at, id",
    ).bind(request.member_id).all<{ changed_at: string; changes_json: string }>(),
    db.prepare(
      `SELECT h.id, h.name, h.address, h.postal_code, h.city, h.country, h.status, h.status_note,
              h.created_at, h.updated_at, mh.role, mh.valid_from, mh.valid_until
       FROM member_households mh JOIN households h ON h.id = mh.household_id
       WHERE mh.member_id = ? ORDER BY mh.valid_from`,
    ).bind(request.member_id).all<Record<string, unknown>>(),
    db.prepare(
      `SELECT g.id, g.name, g.description, g.created_at, g.updated_at,
              mg.role, mg.valid_from, mg.valid_until
       FROM member_group_memberships mg JOIN groups g ON g.id = mg.group_id
       WHERE mg.member_id = ? ORDER BY mg.valid_from`,
    ).bind(request.member_id).all<Record<string, unknown>>(),
    db.prepare(
      `SELECT 'outgoing' AS direction, relationship, valid_from, valid_until
       FROM member_relationships WHERE member_id = ?
       UNION ALL
       SELECT 'incoming' AS direction, relationship, valid_from, valid_until
       FROM member_relationships WHERE related_member_id = ?
       ORDER BY valid_from`,
    ).bind(request.member_id, request.member_id).all<Record<string, unknown>>(),
    db.prepare(
      "SELECT at, action, detail FROM audit_log WHERE target = ? ORDER BY at, id",
    ).bind(request.member_id).all<Record<string, unknown>>(),
  ]);

  const history = historyResult.results.map((entry) => ({
    changed_at: entry.changed_at,
    changes: JSON.parse(entry.changes_json) as unknown,
  }));
  const householdIds = [...new Set(
    householdResult.results.map((household) => String(household.id)),
  )];
  const [directContributions, householdContributions, documentResult] = await Promise.all([
    db.prepare(
      `SELECT id, record_type, title, reference, amount_minor, currency_code, minor_unit_exponent,
              due_on, notes, created_at, updated_at, voided_at, void_reason
       FROM contributions WHERE member_id = ? ORDER BY created_at`,
    ).bind(request.member_id).all<Record<string, unknown>>(),
    householdIds.length
      ? db.prepare(
          `SELECT id, record_type, title, reference, amount_minor, currency_code, minor_unit_exponent,
                  due_on, notes, created_at, updated_at, voided_at, void_reason
           FROM contributions
           WHERE household_id IN (SELECT household_id FROM member_households WHERE member_id = ?)
           ORDER BY created_at`,
        ).bind(request.member_id).all<Record<string, unknown>>()
      : Promise.resolve({ results: [] as Record<string, unknown>[] }),
    db.prepare(
      `SELECT id, household_id, title, rendered_text, storage_key, status, created_at, approved_at,
              approval_request_id
       FROM generated_documents
       WHERE member_id = ? OR household_id IN (
         SELECT household_id FROM member_households WHERE member_id = ?
       )
       ORDER BY created_at`,
    ).bind(request.member_id, request.member_id).all<Record<string, unknown>>(),
  ]);

  const payments = await db.prepare(
    `SELECT contribution_id, amount_minor, paid_on, method, reference, notes,
            created_at, voided_at, void_reason
     FROM contribution_payments WHERE contribution_id IN (
       SELECT id FROM contributions
       WHERE member_id = ? OR household_id IN (
         SELECT household_id FROM member_households WHERE member_id = ?
       )
     )
     ORDER BY paid_on, created_at`,
  ).bind(request.member_id, request.member_id).all<Record<string, unknown>>();

  const documentRows = documentResult.results;
  const approvalRequests = await db.prepare(
    `SELECT id, status, created_at, updated_at, decision_at
     FROM approval_requests
     WHERE resource_type = 'document' AND resource_id IN (
       SELECT id FROM generated_documents
       WHERE member_id = ? OR household_id IN (
         SELECT household_id FROM member_households WHERE member_id = ?
       )
     )`,
  ).bind(request.member_id, request.member_id).all<Record<string, unknown>>();
  const approvalComments = await db.prepare(
    `SELECT request_id, body, created_at FROM approval_comments
     WHERE request_id IN (
       SELECT approval_request_id FROM generated_documents
       WHERE member_id = ? OR household_id IN (
         SELECT household_id FROM member_households WHERE member_id = ?
       )
     )
     ORDER BY created_at`,
  ).bind(request.member_id, request.member_id).all<Record<string, unknown>>();

  const emails = new Set<string>();
  if (typeof member.email === "string" && member.email) emails.add(member.email.toLowerCase());
  for (const entry of historyResult.results) {
    const changes = JSON.parse(entry.changes_json) as {
      email?: { from?: unknown; to?: unknown };
    };
    for (const value of [changes.email?.from, changes.email?.to]) {
      if (typeof value === "string" && value) emails.add(value.toLowerCase());
    }
  }
  const emailList = [...emails];
  const memberEmails = `SELECT lower(email) FROM members WHERE id = ?
    UNION SELECT lower(json_extract(changes_json, '$.email.from'))
      FROM member_history WHERE member_id = ?
    UNION SELECT lower(json_extract(changes_json, '$.email.to'))
      FROM member_history WHERE member_id = ?`;
  const [communicationLogs, sendQueue, unsubscribes, unsubscribeTokens, outbox, sharedEmails] = await Promise.all([
    db.prepare(
      `SELECT communication_name, status, sent_at, opened_at, clicked_at, created_at
       FROM communication_logs WHERE lower(recipient_email) IN (${memberEmails})
       ORDER BY created_at`,
    ).bind(request.member_id, request.member_id, request.member_id).all<Record<string, unknown>>(),
    db.prepare(
      `SELECT q.recipient_email, q.status, q.attempts, q.max_attempts, q.sent_at,
              q.failed_at, q.created_at, q.processed_at, q.delivered_at, q.bounced_at,
              q.purpose, q.communication_id, q.recipient_data_json,
              c.name AS communication_name, c.type AS communication_type,
              c.status AS communication_status
       FROM send_queue q LEFT JOIN communications c ON c.id = q.communication_id
       WHERE lower(q.recipient_email) IN (${memberEmails})
       ORDER BY q.created_at`,
    ).bind(request.member_id, request.member_id, request.member_id).all<Record<string, unknown>>(),
    db.prepare(
      `SELECT email, unsubscribe_at, created_at FROM unsubscribes
       WHERE lower(email) IN (${memberEmails}) ORDER BY created_at`,
    ).bind(request.member_id, request.member_id, request.member_id).all<Record<string, unknown>>(),
    db.prepare(
      `SELECT created_at, used_at FROM unsubscribe_tokens
       WHERE lower(email) IN (${memberEmails}) ORDER BY created_at`,
    ).bind(request.member_id, request.member_id, request.member_id).all<Record<string, unknown>>(),
    db.prepare(
      `SELECT created_at, kind, subject, html, attachments_json FROM dev_outbox
       WHERE lower(to_address) IN (${memberEmails}) ORDER BY created_at`,
    ).bind(request.member_id, request.member_id, request.member_id).all<Record<string, unknown>>(),
    db.prepare(
      `SELECT lower(other.email) AS email FROM members other
       WHERE other.email IS NOT NULL AND lower(other.email) IN (${memberEmails})
       GROUP BY lower(other.email) HAVING COUNT(*) > 1`,
    ).bind(request.member_id, request.member_id, request.member_id).all<{ email: string }>(),
  ]);

  const archiveFiles: Record<string, Uint8Array> = {};
  const exportedDocuments: Record<string, unknown>[] = [];
  for (const row of documentRows) {
    const storageKey = String(row.storage_key);
    const object = await documents.get(storageKey);
    if (!object) throw new Error(`Generated document ${String(row.id)} is missing from document storage.`);
    const fileName = `${safeFileName(String(row.title))}-${String(row.id)}.pdf`;
    archiveFiles[`documents/${fileName}`] = new Uint8Array(await object.arrayBuffer());
    const { storage_key: _storageKey, ...metadata } = row;
    exportedDocuments.push({ ...metadata, file: `documents/${fileName}` });
  }

  const dataPackage = {
    formatVersion: 1,
    generatedAt: now.toISOString(),
    scope: "Prepared for administrator review before responding to the requester.",
    reviewWarnings: [
      "Review household-linked contributions, documents, shared email addresses, message content, free-text notes, and approval comments for information about other people before disclosure.",
      "This package includes records currently linked to this member; it does not determine legal exceptions, retention duties, or the final scope of a response.",
      "Internal privacy-request notes are excluded from this package and should be assessed separately before responding.",
    ],
    request,
    subject: member,
    memberHistory: history,
    householdMemberships: householdResult.results,
    groupMemberships: groupResult.results,
    relationships: relationshipResult.results,
    contributions: {
      directlyLinked: directContributions.results,
      sharedHousehold: householdContributions.results,
      payments: payments.results,
    },
    documents: exportedDocuments,
    documentApprovals: approvalRequests.results,
    documentApprovalComments: approvalComments.results,
    communication: {
      emailAddresses: emailList,
      sharedEmailAddresses: sharedEmails.results.map((row) => row.email),
      logs: communicationLogs.results,
      queuedMessages: sendQueue.results,
      unsubscribes: unsubscribes.results,
      unsubscribeTokenHistory: unsubscribeTokens.results,
      developmentOutbox: outbox.results,
    },
    auditHistory: auditResult.results,
  };
  archiveFiles["data.json"] = strToU8(JSON.stringify(dataPackage, null, 2));
  archiveFiles["README.txt"] = strToU8(
    "ORBIT personal-data export prepared for administrator review.\n" +
      "Review the warnings in data.json before providing this archive to a requester.\n",
  );
  return zipSync(archiveFiles, { level: 6 });
}
