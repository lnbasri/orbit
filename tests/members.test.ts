import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  addMemberRelationship,
  endMemberRelationship,
  listMembers,
  previewHouseholdLifecycle,
  processHouseholdLifecycle,
  saveGroup,
  saveHousehold,
  saveMember,
  setMemberArchived,
} from "../app/lib/members.server";
import { resetDb, startDb } from "./helpers";

let db: D1Database;
let dispose: () => Promise<void>;

beforeAll(async () => {
  ({ db, dispose } = await startDb());
});
afterAll(async () => dispose?.());
beforeEach(async () => {
  await resetDb(db);
});

const memberInput = (fullName: string) => ({
  fullName,
  preferredName: "",
  firstName: fullName.split(" ")[0] ?? "",
  middleName: "",
  familyName: fullName.split(" ").slice(1).join(" ") || "Member",
  dateOfBirth: "",
  gender: "male" as const,
  address: "",
  postalCode: "",
  city: "",
  country: "",
  preferredLanguage: "",
  communicationConsent: false,
  email: "",
  phone: "",
  status: "active" as const,
  statusNote: "",
  joinedOn: "",
  notes: "",
});

describe("member records", () => {
  it("creates members, records an initial history entry, and rejects invalid email", async () => {
    const created = await saveMember(db, "admin@example.org", {
      ...memberInput("  Noor Hasan  "),
      firstName: "Noor",
      middleName: "A.",
      familyName: "Hasan",
      dateOfBirth: "1990-05-14",
      gender: "female",
      address: "Main Street 1",
      postalCode: "1234 AB",
      city: "The Hague",
      country: "NL",
      preferredLanguage: "English",
      communicationConsent: true,
      email: "NOOR@example.org",
    });
    expect(created).toMatchObject({ ok: true, message: "Member added." });
    if (!created.ok) return;

    expect(await db.prepare(`
      SELECT full_name, first_name, middle_name, family_name, date_of_birth,
             gender, address, postal_code, city, country, preferred_language,
             communication_consent, email
      FROM members WHERE id = ?
    `).bind(created.id).first()).toEqual({
      full_name: "Noor A. Hasan",
      first_name: "Noor",
      middle_name: "A.",
      family_name: "Hasan",
      date_of_birth: "1990-05-14",
      gender: "female",
      address: "Main Street 1",
      postal_code: "1234 AB",
      city: "The Hague",
      country: "NL",
      preferred_language: "English",
      communication_consent: 1,
      email: "noor@example.org",
    });
    const history = await db
      .prepare("SELECT changed_by, changes_json FROM member_history WHERE member_id = ?")
      .bind(created.id)
      .first<{ changed_by: string; changes_json: string }>();
    expect(history?.changed_by).toBe("admin@example.org");
    expect(JSON.parse(history!.changes_json)).toMatchObject({ full_name: { from: null, to: "Noor A. Hasan" } });

    expect(await saveMember(db, "admin@example.org", { ...memberInput("Invalid"), email: "not-an-email" })).toMatchObject({
      ok: false,
      message: "Enter a valid email address.",
    });
    expect((await listMembers(db, { q: "", status: "", page: 1 })).count).toBe(1);
  });

  it("keeps member field history and dated household/group assignments when they change", async () => {
    const household = await saveHousehold(
      db,
      "admin@example.org",
      { name: "Hasan household", address: "Main Street 1", postalCode: "1234 AB", city: "Den Haag", country: "NL", status: "active", statusNote: "" },
    );
    const group = await saveGroup(db, "admin@example.org", { name: "Board", description: "Board members" });
    expect(household.ok && group.ok).toBe(true);
    if (!household.ok || !group.ok) return;

    const created = await saveMember(
      db,
      "admin@example.org",
      { ...memberInput("Noor Hasan"), email: "noor@example.org" },
      undefined,
      household.id,
      [group.id],
      new Date("2026-11-20T10:00:00.000Z"),
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    await saveMember(
      db,
      "admin@example.org",
      { ...memberInput("Noor Hasan"), email: "noor@example.org" },
      created.id,
      household.id,
      [group.id],
      new Date("2026-11-20T22:00:00.000Z"),
      { [group.id]: "Chair" },
    );
    await saveMember(
      db,
      "admin@example.org",
      { ...memberInput("Noor Hasan"), email: "noor.new@example.org", status: "inactive", statusNote: "Temporarily inactive" },
      created.id,
      "",
      [],
      new Date("2026-11-21T10:00:00.000Z"),
    );

    const histories = await db
      .prepare("SELECT changed_at, changes_json FROM member_history WHERE member_id = ? ORDER BY id")
      .bind(created.id)
      .all<{ changed_at: string; changes_json: string }>();
    expect(histories.results).toHaveLength(2);
    expect(JSON.parse(histories.results[1].changes_json)).toMatchObject({
      email: { from: "noor@example.org", to: "noor.new@example.org" },
      status: { from: "active", to: "inactive" },
      status_note: { from: null, to: "Temporarily inactive" },
    });
    expect(await db.prepare("SELECT valid_until FROM member_households WHERE member_id = ?").bind(created.id).first()).toEqual({
      valid_until: "2026-11-21T10:00:00.000Z",
    });
    const groupHistory = await db
      .prepare("SELECT role, valid_until, assigned_by, ended_by FROM member_group_memberships WHERE member_id = ? ORDER BY id")
      .bind(created.id)
      .all<{ role: string; valid_until: string; assigned_by: string; ended_by: string }>();
    expect(groupHistory.results).toEqual([
      { role: "member", valid_until: "2026-11-20T22:00:00.000Z", assigned_by: "admin@example.org", ended_by: "admin@example.org" },
      { role: "Chair", valid_until: "2026-11-21T10:00:00.000Z", assigned_by: "admin@example.org", ended_by: "admin@example.org" },
    ]);
  });

  it("validates birth dates and records communication consent and archive timestamps", async () => {
    const future = new Date();
    future.setUTCFullYear(future.getUTCFullYear() + 1);
    const futureDate = future.toISOString().slice(0, 10);
    expect(await saveMember(db, "admin@example.org", {
      ...memberInput("Future Person"),
      dateOfBirth: futureDate,
    })).toMatchObject({ ok: false, message: "Date of birth cannot be in the future." });

    const initial = await saveMember(db, "admin@example.org", {
      ...memberInput("Consent Person"),
      dateOfBirth: "1990-05-14",
      communicationConsent: true,
    }, undefined, "", [], new Date("2026-11-20T10:00:00.000Z"));
    expect(initial.ok).toBe(true);
    if (!initial.ok) return;

    const consent = await db
      .prepare("SELECT communication_consent, communication_consent_updated_at FROM members WHERE id = ?")
      .bind(initial.id)
      .first<{ communication_consent: number; communication_consent_updated_at: string }>();
    expect(consent).toEqual({
      communication_consent: 1,
      communication_consent_updated_at: "2026-11-20T10:00:00.000Z",
    });

    await saveMember(db, "admin@example.org", {
      ...memberInput("Consent Person"),
      dateOfBirth: "1990-05-14",
      communicationConsent: false,
    }, initial.id, "", [], new Date("2026-11-21T10:00:00.000Z"));
    expect(await db
      .prepare("SELECT communication_consent, communication_consent_updated_at FROM members WHERE id = ?")
      .bind(initial.id)
      .first()).toEqual({
        communication_consent: 0,
        communication_consent_updated_at: "2026-11-21T10:00:00.000Z",
      });

    expect(await setMemberArchived(db, "admin@example.org", initial.id, true, new Date("2026-11-21T11:00:00.000Z"))).toMatchObject({ ok: true });
    expect(await db.prepare("SELECT archived_at FROM members WHERE id = ?").bind(initial.id).first()).toEqual({
      archived_at: "2026-11-21T11:00:00.000Z",
    });
    expect(await setMemberArchived(db, "admin@example.org", initial.id, false, new Date("2026-11-21T12:00:00.000Z"))).toMatchObject({ ok: true });
  });

  it("allows only one partner and permits multiple children in a household", async () => {
    const household = await saveHousehold(
      db,
      "admin@example.org",
      { name: "Cardinality household", address: "Main Street", postalCode: "1234 AB", city: "The Hague", country: "NL", status: "active", statusNote: "" },
    );
    expect(household.ok).toBe(true);
    if (!household.ok) return;

    const head = await saveMember(
      db,
      "admin@example.org",
      memberInput("First Head"),
      undefined,
      household.id,
      [],
      new Date("2026-11-20T10:00:00.000Z"),
      {},
      "head",
    );
    const partner = await saveMember(
      db,
      "admin@example.org",
      memberInput("First Partner"),
      undefined,
      household.id,
      [],
      new Date("2026-11-20T10:00:00.000Z"),
      {},
      "partner",
    );
    expect(head.ok && partner.ok).toBe(true);
    if (!head.ok || !partner.ok) return;

    expect(await saveMember(
      db,
      "admin@example.org",
      memberInput("Second Partner"),
      undefined,
      household.id,
      [],
      new Date("2026-11-20T11:00:00.000Z"),
      {},
      "partner",
    )).toMatchObject({ ok: false, message: "This household already has one partner." });

    const firstChild = await saveMember(
      db,
      "admin@example.org",
      memberInput("First Child"),
      undefined,
      household.id,
      [],
      new Date("2026-11-20T12:00:00.000Z"),
      {},
      "child",
    );
    const secondChild = await saveMember(
      db,
      "admin@example.org",
      memberInput("Second Child"),
      undefined,
      household.id,
      [],
      new Date("2026-11-20T12:00:00.000Z"),
      {},
      "child",
    );
    expect(firstChild.ok && secondChild.ok).toBe(true);
  });

  it("previews and processes household head replacement", async () => {
    const household = await saveHousehold(
      db,
      "admin@example.org",
      { name: "Lifecycle household", address: "Main Street", postalCode: "1234 AB", city: "The Hague", country: "NL", status: "active", statusNote: "" },
    );
    expect(household.ok).toBe(true);
    if (!household.ok) return;

    const head = await saveMember(
      db,
      "admin@example.org",
      { ...memberInput("Deceased Head"), dateOfBirth: "1960-01-01" },
      undefined,
      household.id,
      [],
      new Date("2026-11-20T10:00:00.000Z"),
      {},
      "head",
    );
    const partner = await saveMember(
      db,
      "admin@example.org",
      { ...memberInput("Active Partner"), dateOfBirth: "1962-02-02" },
      undefined,
      household.id,
      [],
      new Date("2026-11-20T10:00:00.000Z"),
      {},
      "partner",
    );
    expect(head.ok && partner.ok).toBe(true);
    if (!head.ok || !partner.ok) return;

    await saveMember(
      db,
      "admin@example.org",
      { ...memberInput("Deceased Head"), dateOfBirth: "1960-01-01", status: "deceased", statusNote: "Deceased" },
      head.id,
      household.id,
      [],
      new Date("2026-11-21T10:00:00.000Z"),
      {},
      "head",
    );

    const preview = await previewHouseholdLifecycle(
      db,
      household.id,
      new Date("2026-11-21T10:00:00.000Z"),
    );
    expect(preview).toMatchObject({
      action: "PROMOTE_PARTNER",
      currentHeadId: head.id,
      replacementMemberId: partner.id,
    });

    const processed = await processHouseholdLifecycle(
      db,
      "admin@example.org",
      household.id,
      new Date("2026-11-21T10:00:00.000Z"),
    );
    expect(processed.ok).toBe(true);

    expect(await db.prepare("SELECT head_member_id FROM households WHERE id = ?").bind(household.id).first()).toEqual({
      head_member_id: partner.id,
    });
    expect(await db
      .prepare("SELECT role FROM member_households WHERE household_id = ? AND member_id = ? AND valid_until IS NULL")
      .bind(household.id, partner.id)
      .first()).toEqual({ role: "head" });
  });

  it("records directed member relationships and ends them without deleting history", async () => {
    const first = await saveMember(db, "admin@example.org", memberInput("Aisha"));
    const second = await saveMember(db, "admin@example.org", memberInput("Samir"));
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;

    expect(await addMemberRelationship(db, "admin@example.org", first.id, first.id, "sibling")).toMatchObject({ ok: false });
    const added = await addMemberRelationship(db, "admin@example.org", first.id, second.id, "sibling");
    expect(added.ok).toBe(true);
    const relation = await db
      .prepare("SELECT id FROM member_relationships WHERE member_id = ? AND related_member_id = ? AND valid_until IS NULL")
      .bind(first.id, second.id)
      .first<{ id: string }>();
    expect(relation).not.toBeNull();

    expect(await endMemberRelationship(db, "admin@example.org", first.id, relation!.id)).toMatchObject({ ok: true });
    expect(await db.prepare("SELECT valid_until FROM member_relationships WHERE id = ?").bind(relation!.id).first()).toMatchObject({
      valid_until: expect.any(String),
    });
  });
});
