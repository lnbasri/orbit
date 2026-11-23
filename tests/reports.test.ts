import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { getDashboardReports } from "../app/lib/reports.server";
import { resetDb, startDb } from "./helpers";

let db: D1Database;
let dispose: () => Promise<void>;

beforeAll(async () => {
  ({ db, dispose } = await startDb());
});
afterAll(async () => dispose?.());
beforeEach(async () => resetDb(db));

const now = new Date("2026-11-23T12:00:00.000Z");
const timestamp = now.toISOString();

async function addMember(
  id: string,
  status: "active" | "inactive" | "moved" | "deceased",
  dateOfBirth: string | null,
  archived = false,
) {
  await db
    .prepare(
      `INSERT INTO members
        (id, full_name, gender, status, date_of_birth, created_at, updated_at, archived_at)
       VALUES (?, ?, 'female', ?, ?, ?, ?, ?)`,
    )
    .bind(id, id, status, dateOfBirth, timestamp, timestamp, archived ? timestamp : null)
    .run();
}

async function addHousehold(id: string, status: "active" | "inactive") {
  await db
    .prepare(
      "INSERT INTO households (id, name, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    )
    .bind(id, id, status, timestamp, timestamp)
    .run();
}

async function addGroup(id: string) {
  await db
    .prepare("INSERT INTO groups (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)")
    .bind(id, id, timestamp, timestamp)
    .run();
}

describe("dashboard reports", () => {
  it("reports member status and age counts without archived or deceased ages", async () => {
    await addMember("teen", "active", "2009-11-24");
    await addMember("adult", "inactive", "2008-11-23");
    await addMember("moved", "moved", "1980-11-23");
    await addMember("deceased", "deceased", "1950-01-01");
    await addMember("unknown-dob", "active", null);
    await addMember("archived", "active", "1990-01-01", true);

    const report = await getDashboardReports(db, now);

    expect(report.memberStatuses).toEqual([
      { label: "Active", count: 2 },
      { label: "Inactive", count: 1 },
      { label: "Moved", count: 1 },
      { label: "Deceased", count: 1 },
      { label: "Archived", count: 1 },
    ]);
    expect(report.ageGroups).toEqual([
      { label: "Under 18", count: 1 },
      { label: "18-29", count: 1 },
      { label: "30-44", count: 0 },
      { label: "45-59", count: 1 },
      { label: "60-74", count: 0 },
      { label: "75+", count: 0 },
      { label: "Unknown", count: 1 },
    ]);
  });

  it("reports household sizes and current group assignments", async () => {
    await addMember("first", "active", "1990-01-01");
    await addMember("second", "active", "1995-01-01");
    await addMember("archived", "active", "1990-01-01", true);
    await addHousehold("household-with-two", "active");
    await addHousehold("empty-household", "active");
    await addHousehold("inactive-household", "inactive");
    await addGroup("Members");
    await addGroup("Archived only");
    await addGroup("Empty");

    await db.batch([
      db
        .prepare("INSERT INTO member_households (member_id, household_id, role, assigned_by, valid_from) VALUES (?, ?, 'child', 'test', ?)")
        .bind("first", "household-with-two", timestamp),
      db
        .prepare("INSERT INTO member_households (member_id, household_id, role, assigned_by, valid_from) VALUES (?, ?, 'child', 'test', ?)")
        .bind("second", "household-with-two", timestamp),
      db
        .prepare("INSERT INTO member_group_memberships (member_id, group_id, role, assigned_by, valid_from) VALUES (?, ?, 'member', 'test', ?)")
        .bind("first", "Members", timestamp),
      db
        .prepare("INSERT INTO member_group_memberships (member_id, group_id, role, assigned_by, valid_from) VALUES (?, ?, 'member', 'test', ?)")
        .bind("second", "Members", timestamp),
      db
        .prepare("INSERT INTO member_group_memberships (member_id, group_id, role, assigned_by, valid_from) VALUES (?, ?, 'member', 'test', ?)")
        .bind("archived", "Archived only", timestamp),
    ]);

    const report = await getDashboardReports(db, now);

    expect(report.householdStatuses).toEqual([
      { label: "Active", count: 2 },
      { label: "Inactive", count: 1 },
    ]);
    expect(report.householdSizes).toEqual([
      { label: "0 members", count: 2 },
      { label: "1 member", count: 0 },
      { label: "2 members", count: 1 },
      { label: "3-4 members", count: 0 },
      { label: "5+ members", count: 0 },
    ]);
    expect(report.groupMemberships).toEqual([
      { id: "Members", name: "Members", member_count: 2 },
      { id: "Archived only", name: "Archived only", member_count: 0 },
      { id: "Empty", name: "Empty", member_count: 0 },
    ]);
  });
});
