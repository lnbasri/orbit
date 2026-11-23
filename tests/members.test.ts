import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { strFromU8, unzipSync } from "fflate";

import {
  addMemberRelationship,
  communicationRecipientsToCsv,
  endMemberRelationship,
  exportMembers,
  getHouseholdDetail,
  getMemberProfile,
  importMembersCsv,
  listMembers,
  membersToCsv,
  membersToXlsx,
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
  it("creates a household head and related members together", async () => {
    const head = {
      ...memberInput("Noor Hasan"),
      firstName: "Noor",
      familyName: "Hasan",
      address: "Main Street 1",
      postalCode: "1234 AB",
      city: "The Hague",
      country: "NL",
      email: "noor@example.org",
      phone: "+31 6 12345678",
    };
    const created = await saveMember(
      db,
      "admin@example.org",
      head,
      undefined,
      "",
      [],
      new Date("2026-11-20T10:00:00.000Z"),
      {},
      "head",
      {
        name: "Hasan",
        email: head.email,
        phone: head.phone,
        address: head.address,
        postalCode: head.postalCode,
        city: head.city,
        country: head.country,
        additionalMembers: [
          { role: "partner", member: {
            ...memberInput("Sam Hasan"),
            firstName: "Sam",
            familyName: "Hasan",
            address: head.address,
            postalCode: head.postalCode,
            city: head.city,
            country: head.country,
          } },
          { role: "child", member: {
            ...memberInput("Mina Hasan"),
            firstName: "Mina",
            familyName: "Hasan",
            address: "Different Street 2",
          } },
        ],
      },
    );

    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const household = await db.prepare(`
      SELECT h.name, h.head_member_id, h.email, h.phone, h.address, h.postal_code, h.city, h.country
      FROM households h
      JOIN member_households mh ON mh.household_id = h.id
      WHERE mh.member_id = ? AND mh.role = 'head' AND mh.valid_until IS NULL
    `).bind(created.id).first();
    expect(household).toEqual({
      name: "Hasan",
      head_member_id: created.id,
      email: "noor@example.org",
      phone: "+31 6 12345678",
      address: "Main Street 1",
      postal_code: "1234 AB",
      city: "The Hague",
      country: "NL",
    });

    const members = await db.prepare(`
      SELECT m.full_name, m.address, mh.role
      FROM members m
      JOIN member_households mh ON mh.member_id = m.id
      WHERE mh.valid_until IS NULL
      ORDER BY m.full_name
    `).all<{ full_name: string; address: string | null; role: string }>();
    expect(members.results).toEqual([
      { full_name: "Mina Hasan", address: "Different Street 2", role: "child" },
      { full_name: "Noor Hasan", address: "Main Street 1", role: "head" },
      { full_name: "Sam Hasan", address: "Main Street 1", role: "partner" },
    ]);
  });

  it("rejects multiple partners in a new household without writing records", async () => {
    const created = await saveMember(
      db,
      "admin@example.org",
      memberInput("Noor Hasan"),
      undefined,
      "",
      [],
      new Date("2026-11-20T10:00:00.000Z"),
      {},
      "head",
      {
        name: "Hasan",
        address: "",
        postalCode: "",
        city: "",
        country: "",
        additionalMembers: [
          { role: "partner", member: memberInput("Sam Hasan") },
          { role: "partner", member: memberInput("Mina Hasan") },
        ],
      },
    );

    expect(created).toMatchObject({
      ok: false,
      message: "A household can have only one partner.",
    });
    expect(await db.prepare("SELECT COUNT(*) AS count FROM members").first()).toEqual({ count: 0 });
    expect(await db.prepare("SELECT COUNT(*) AS count FROM households").first()).toEqual({ count: 0 });
  });

  it("limits a new household to eight additional members", async () => {
    const created = await saveMember(
      db,
      "admin@example.org",
      memberInput("Noor Hasan"),
      undefined,
      "",
      [],
      new Date("2026-11-20T10:00:00.000Z"),
      {},
      "head",
      {
        name: "Hasan",
        address: "",
        postalCode: "",
        city: "",
        country: "",
        additionalMembers: Array.from({ length: 9 }, (_, index) => ({
          role: "child",
          member: memberInput(`Child ${index + 1}`),
        })),
      },
    );

    expect(created).toMatchObject({
      ok: false,
      message: "A household can include up to 8 additional members at a time.",
    });
    expect(await db.prepare("SELECT COUNT(*) AS count FROM members").first()).toEqual({ count: 0 });
    expect(await db.prepare("SELECT COUNT(*) AS count FROM households").first()).toEqual({ count: 0 });
  });

  it("requires a contact method to record communication consent for an additional member", async () => {
    const member = memberInput("Sam Hasan");
    const created = await saveMember(
      db,
      "admin@example.org",
      memberInput("Noor Hasan"),
      undefined,
      "",
      [],
      new Date("2026-11-20T10:00:00.000Z"),
      {},
      "head",
      {
        name: "Hasan",
        address: "",
        postalCode: "",
        city: "",
        country: "",
        additionalMembers: [
          { role: "child", member: { ...member, communicationConsent: true } },
        ],
      },
    );

    expect(created).toMatchObject({
      ok: false,
      message: "Household member 1: communication consent requires an email address or phone number.",
    });
    expect(await db.prepare("SELECT COUNT(*) AS count FROM members").first()).toEqual({ count: 0 });
    expect(await db.prepare("SELECT COUNT(*) AS count FROM households").first()).toEqual({ count: 0 });
  });

  it("enforces unique household names when creating and editing households", async () => {
    const household = await saveHousehold(db, "admin@example.org", {
      name: "Hasan",
      email: "noor@example.org",
      phone: "+31 6 12345678",
      address: "",
      postalCode: "",
      city: "",
      country: "",
      status: "active",
      statusNote: "",
    });
    expect(household.ok).toBe(true);
    if (!household.ok) return;

    expect(await saveHousehold(db, "admin@example.org", {
      name: "  hasan ",
      address: "",
      postalCode: "",
      city: "",
      country: "",
      status: "active",
      statusNote: "",
    })).toMatchObject({
      ok: false,
      message: "A household with that name already exists. Choose another unique name.",
    });
    expect(await saveHousehold(db, "admin@example.org", {
      name: "HASAN",
      email: "family@example.org",
      phone: "+31 6 87654321",
      address: "",
      postalCode: "",
      city: "",
      country: "",
      status: "active",
      statusNote: "",
    }, household.id)).toMatchObject({ ok: true, id: household.id });
    expect(await db.prepare("SELECT email, phone FROM households WHERE id = ?")
      .bind(household.id)
      .first()).toEqual({
        email: "family@example.org",
        phone: "+31 6 87654321",
      });

    await expect(db.prepare(`
      INSERT INTO households (id, name, status, created_at, updated_at)
      VALUES ('duplicate-household', ' hasan ', 'active', '2026-11-20', '2026-11-20')
    `).run()).rejects.toThrow();
  });

  it("rejects a duplicate household name during new member creation", async () => {
    await saveHousehold(db, "admin@example.org", {
      name: "Hasan",
      address: "",
      postalCode: "",
      city: "",
      country: "",
      status: "active",
      statusNote: "",
    });

    const created = await saveMember(
      db,
      "admin@example.org",
      { ...memberInput("Noor Hasan"), firstName: "Noor", familyName: "Hasan" },
      undefined,
      "",
      [],
      new Date("2026-11-20T10:00:00.000Z"),
      {},
      "head",
      {
        name: "hasan",
        address: "",
        postalCode: "",
        city: "",
        country: "",
        additionalMembers: [],
      },
    );
    expect(created).toMatchObject({
      ok: false,
      message: 'A household with that name already exists. Try "Noor Hasan" if it is not already in use, or choose another unique name.',
    });
    expect(await db.prepare("SELECT COUNT(*) AS count FROM members").first()).toEqual({ count: 0 });
    expect(await db.prepare("SELECT COUNT(*) AS count FROM households").first()).toEqual({ count: 1 });
  });

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

  it("keeps complete consent history beyond the recent profile history limit", async () => {
    const initial = await saveMember(
      db,
      "admin@example.org",
      memberInput("Consent History Member"),
      undefined,
      "",
      [],
      new Date("2026-11-20T10:00:00.000Z"),
    );
    expect(initial.ok).toBe(true);
    if (!initial.ok) return;

    await saveMember(
      db,
      "admin@example.org",
      { ...memberInput("Consent History Member"), communicationConsent: true },
      initial.id,
      "",
      [],
      new Date("2026-11-21T10:00:00.000Z"),
    );

    await db.batch(
      Array.from({ length: 55 }, (_, index) =>
        db
          .prepare(
            "INSERT INTO member_history (member_id, changed_at, changed_by, changes_json) VALUES (?, ?, ?, ?)",
          )
          .bind(
            initial.id,
            new Date(Date.UTC(2026, 10, 22, 0, index)).toISOString(),
            "admin@example.org",
            JSON.stringify({ notes: { from: null, to: `Update ${index}` } }),
          ),
      ),
    );

    const profile = await getMemberProfile(db, initial.id);
    expect(profile.history).toHaveLength(50);
    expect(profile.consentHistory).toHaveLength(2);
    expect(profile.consentHistory.map((entry) => [entry.consent_from, entry.consent_to])).toEqual([
      [0, 1],
      [null, 0],
    ]);
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

    expect(await saveMember(
      db,
      "admin@example.org",
      memberInput("Second Head"),
      undefined,
      household.id,
      [],
      new Date("2026-11-20T11:30:00.000Z"),
      {},
      "head",
    )).toMatchObject({ ok: false, message: "This household already has one head." });

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

  it("keeps the household head pointer aligned when a head changes households", async () => {
    const firstHousehold = await saveHousehold(
      db,
      "admin@example.org",
      { name: "First household", address: "", postalCode: "", city: "", country: "", status: "active", statusNote: "" },
    );
    const secondHousehold = await saveHousehold(
      db,
      "admin@example.org",
      { name: "Second household", address: "", postalCode: "", city: "", country: "", status: "active", statusNote: "" },
    );
    expect(firstHousehold.ok && secondHousehold.ok).toBe(true);
    if (!firstHousehold.ok || !secondHousehold.ok) return;

    const head = await saveMember(
      db,
      "admin@example.org",
      memberInput("Moving Head"),
      undefined,
      firstHousehold.id,
      [],
      new Date("2026-11-20T10:00:00.000Z"),
      {},
      "head",
    );
    expect(head.ok).toBe(true);
    if (!head.ok) return;

    const moved = await saveMember(
      db,
      "admin@example.org",
      memberInput("Moving Head"),
      head.id,
      secondHousehold.id,
      [],
      new Date("2026-11-21T10:00:00.000Z"),
      {},
      "head",
    );
    expect(moved.ok).toBe(true);
    expect(await db.prepare("SELECT head_member_id FROM households WHERE id = ?").bind(firstHousehold.id).first())
      .toEqual({ head_member_id: null });
    expect(await db.prepare("SELECT head_member_id FROM households WHERE id = ?").bind(secondHousehold.id).first())
      .toEqual({ head_member_id: head.id });
  });

  it("atomically allows only one concurrent partner assignment", async () => {
    const household = await saveHousehold(
      db,
      "admin@example.org",
      { name: "Concurrent household", address: "", postalCode: "", city: "", country: "", status: "active", statusNote: "" },
    );
    expect(household.ok).toBe(true);
    if (!household.ok) return;

    const head = await saveMember(
      db,
      "admin@example.org",
      memberInput("Concurrent Head"),
      undefined,
      household.id,
      [],
      new Date("2026-11-20T10:00:00.000Z"),
      {},
      "head",
    );
    expect(head.ok).toBe(true);
    if (!head.ok) return;

    const attempts = await Promise.all([
      saveMember(
        db, "admin@example.org", memberInput("Partner One"), undefined, household.id, [],
        new Date("2026-11-21T10:00:00.000Z"), {}, "partner",
      ),
      saveMember(
        db, "admin@example.org", memberInput("Partner Two"), undefined, household.id, [],
        new Date("2026-11-21T10:00:00.000Z"), {}, "partner",
      ),
    ]);

    expect(attempts.filter((attempt) => attempt.ok)).toHaveLength(1);
    expect(attempts.filter((attempt) => !attempt.ok)).toHaveLength(1);
    expect(await db
      .prepare("SELECT COUNT(*) AS count FROM member_households WHERE household_id = ? AND role = 'partner' AND valid_until IS NULL")
      .bind(household.id)
      .first()).toEqual({ count: 1 });
    expect(await db
      .prepare("SELECT COUNT(*) AS count FROM members WHERE full_name IN (?, ?)")
      .bind("Partner One", "Partner Two")
      .first()).toEqual({ count: 1 });
  });

  it("enforces head-pointer consistency for direct database writes", async () => {
    const household = await saveHousehold(
      db,
      "admin@example.org",
      { name: "Database rules household", address: "", postalCode: "", city: "", country: "", status: "active", statusNote: "" },
    );
    expect(household.ok).toBe(true);
    if (!household.ok) return;

    const member = await saveMember(db, "admin@example.org", memberInput("Database Head"));
    expect(member.ok).toBe(true);
    if (!member.ok) return;

    await db
      .prepare("INSERT INTO member_households (member_id, household_id, role, assigned_by, valid_from) VALUES (?, ?, 'head', ?, ?)")
      .bind(member.id, household.id, "admin@example.org", "2026-11-20T10:00:00.000Z")
      .run();
    expect(await db.prepare("SELECT head_member_id FROM households WHERE id = ?").bind(household.id).first())
      .toEqual({ head_member_id: member.id });

    await expect(
      db.prepare("UPDATE households SET head_member_id = NULL WHERE id = ?").bind(household.id).run(),
    ).rejects.toThrow("household head must match a current head assignment");
  });

  it("rejects invalid roles and direct assignments to inactive households", async () => {
    const activeHousehold = await saveHousehold(
      db,
      "admin@example.org",
      { name: "Role validation household", address: "", postalCode: "", city: "", country: "", status: "active", statusNote: "" },
    );
    const inactiveHousehold = await saveHousehold(
      db,
      "admin@example.org",
      { name: "Inactive household", address: "", postalCode: "", city: "", country: "", status: "inactive", statusNote: "" },
    );
    expect(activeHousehold.ok && inactiveHousehold.ok).toBe(true);
    if (!activeHousehold.ok || !inactiveHousehold.ok) return;

    expect(await saveMember(
      db,
      "admin@example.org",
      memberInput("Invalid Role Member"),
      undefined,
      activeHousehold.id,
      [],
      new Date("2026-11-20T10:00:00.000Z"),
      {},
      "member",
    )).toMatchObject({ ok: false, message: "Select a valid household role." });

    const member = await saveMember(db, "admin@example.org", memberInput("Inactive Assignment"));
    expect(member.ok).toBe(true);
    if (!member.ok) return;
    await expect(
      db
        .prepare("INSERT INTO member_households (member_id, household_id, role, assigned_by, valid_from) VALUES (?, ?, 'child', ?, ?)")
        .bind(member.id, inactiveHousehold.id, "admin@example.org", "2026-11-20T10:00:00.000Z")
        .run(),
    ).rejects.toThrow("current member assignments require an active household");
  });

  it("returns household detail with current and former members", async () => {
    const household = await saveHousehold(
      db,
      "admin@example.org",
      { name: "Detail household", address: "Detail Street", postalCode: "1234 AB", city: "The Hague", country: "NL", status: "active", statusNote: "" },
    );
    expect(household.ok).toBe(true);
    if (!household.ok) return;

    const head = await saveMember(
      db,
      "admin@example.org",
      memberInput("Detail Head"),
      undefined,
      household.id,
      [],
      new Date("2026-11-20T10:00:00.000Z"),
      {},
      "head",
    );
    expect(head.ok).toBe(true);
    if (!head.ok) return;

    await saveMember(
      db,
      "admin@example.org",
      memberInput("Detail Head"),
      head.id,
      "",
      [],
      new Date("2026-11-21T10:00:00.000Z"),
      {},
      "member",
    );

    const detail = await getHouseholdDetail(db, household.id);
    expect(detail?.household.name).toBe("Detail household");
    expect(detail?.formerMembers).toHaveLength(1);
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

describe("CSV import/export", () => {
  const baseInput = (fullName: string) => ({
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

  it("membersToCsv renders header and rows with proper escaping", async () => {
    await saveMember(
      db,
      "admin@example.org",
      {
        ...baseInput("Ada Lovelace"),
        email: "ada@example.org",
        notes: 'She said, "hello"',
        statusNote: "=1+1",
        communicationConsent: true,
      },
    );

    const members = await exportMembers(db, { q: "", status: "" });
    const csv = membersToCsv(members);

    expect(csv).toContain("ID,Full Name,Preferred Name,First Name,Middle Name,Family Name");
    expect(csv).toContain("Consent Updated At");
    expect(csv).toContain("Archived At");
    expect(csv).toContain("Ada Lovelace");
    expect(csv).toContain("ada@example.org");
    // Quotes in notes should be escaped
    expect(csv).toContain('"She said, ""hello"""');
    expect(csv).toContain("'=1+1");
  });

  it("creates an Excel workbook with member values stored as text", async () => {
    await saveMember(db, "admin@example.org", {
      ...baseInput("Ada Lovelace"),
      notes: "=1+1",
    });

    const members = await exportMembers(db, { q: "", status: "" });
    const files = unzipSync(membersToXlsx(members));
    const worksheet = strFromU8(files["xl/worksheets/sheet1.xml"]);

    expect(worksheet).toContain('<c r="A1" t="inlineStr">');
    expect(worksheet).toContain("Archived At");
    expect(worksheet).toContain("=1+1");
    expect(worksheet).not.toContain("<f>");
  });

  it("keeps the communication recipient export limited to contact fields", () => {
    const csv = communicationRecipientsToCsv([
      {
        ...baseInput("Ada Lovelace"),
        id: "member-1",
        full_name: "Ada Lovelace",
        preferred_name: null,
        first_name: "Ada",
        middle_name: null,
        family_name: "Lovelace",
        date_of_birth: "1815-12-10",
        gender: "female",
        address: "1 Analytical Engine Way",
        postal_code: null,
        city: null,
        country: null,
        preferred_language: null,
        communication_consent: 1,
        communication_consent_updated_at: null,
        email: "ada@example.org",
        phone: null,
        status: "active",
        status_note: null,
        joined_on: null,
        notes: "Private note",
        created_at: "2024-01-01",
        updated_at: "2024-01-01",
        archived_at: null,
      },
    ]);

    expect(csv).toContain("Full Name,Preferred Name,Email,Phone,Status");
    expect(csv).toContain("ada@example.org");
    expect(csv).not.toContain("Date of Birth");
    expect(csv).not.toContain("Private note");
  });

  it("exportMembers returns members matching filters", async () => {
    await saveMember(db, "admin@example.org", { ...baseInput("Active Member"), status: "active" });
    await saveMember(db, "admin@example.org", { ...baseInput("Inactive Member"), status: "inactive" });

    const active = await exportMembers(db, { q: "", status: "active" });
    expect(active.length).toBe(1);
    expect(active[0].full_name).toBe("Active Member");

    const all = await exportMembers(db, { q: "", status: "" });
    expect(all.length).toBe(2);
  });

  it("importMembersCsv imports valid rows and reports invalid ones", async () => {
    const csv = `Full Name,First Name,Family Name,Email,Gender,Status,Communication Consent
Grace Hopper,Grace,Hopper,grace@example.org,female,active,TRUE
,Bad,Email,not-an-email,male,active,TRUE
Alan Turing,Alan,Turing,alan@example.org,male,active,TRUE`;

    const result = await importMembersCsv(db, "admin@example.org", csv);

    expect(result.ok).toBe(true);
    expect(result.imported).toBe(2);
    expect(result.errors).toBe(1);
    expect(result.errorRows).toHaveLength(1);
    expect(result.errorRows[0].row).toBe(2);

    const count = (await listMembers(db, { q: "", status: "", page: 1 })).count;
    expect(count).toBe(2);
  });

  it("importMembersCsv reports duplicate people but allows a shared family email", async () => {
    await saveMember(db, "admin@example.org", {
      ...baseInput("Existing Member"),
      email: "existing@example.org",
    });
    const csv = `Full Name,Email
New Member,new@example.org
Existing Member,EXISTING@example.org
New Member,new@example.org
Another Member,new@example.org`;

    const result = await importMembersCsv(db, "admin@example.org", csv);

    expect(result.imported).toBe(2);
    expect(result.errors).toBe(2);
    expect(result.errorRows.map(({ message }) => message)).toEqual([
      "A member with this name and email already exists.",
      "A member with this name and email is repeated in this file.",
    ]);
    expect((await listMembers(db, { q: "", status: "", page: 1 })).count).toBe(3);
  });

  it("importMembersCsv handles empty CSV", async () => {
    const result = await importMembersCsv(db, "admin@example.org", "Full Name,Email\n");
    expect(result.ok).toBe(true);
    expect(result.imported).toBe(0);
    expect(result.message).toBe("No rows found in CSV.");
  });

  it("importMembersCsv constructs full name from first + family when missing", async () => {
    const csv = `First Name,Family Name,Email
Linus,Torvalds,linus@example.org`;

    const result = await importMembersCsv(db, "admin@example.org", csv);
    expect(result.ok).toBe(true);
    expect(result.imported).toBe(1);

    const member = await db
      .prepare("SELECT full_name FROM members WHERE email = ?")
      .bind("linus@example.org")
      .first<{ full_name: string }>();
    expect(member?.full_name).toBe("Linus Torvalds");
  });

  it("importMembersCsv records audit entries for imported members", async () => {
    const csv = `Full Name,Email
Ada Lovelace,ada@example.org`;

    await importMembersCsv(db, "admin@example.org", csv);

    const member = await db.prepare("SELECT id FROM members WHERE email = ?").bind("ada@example.org").first<{ id: string }>();
    const audit = await db
      .prepare("SELECT action, target, actor FROM audit_log WHERE action = 'member.import'")
      .first<{ action: string; target: string; actor: string }>();
    expect(audit?.action).toBe("member.import");
    expect(audit?.target).toBe(member?.id);
    expect(audit?.actor).toBe("admin@example.org");
  });
});
