const MEMBER_STATUSES = ["active", "inactive", "moved", "deceased"] as const;
const HOUSEHOLD_STATUSES = ["active", "inactive"] as const;
const AGE_GROUPS = ["Under 18", "18-29", "30-44", "45-59", "60-74", "75+", "Unknown"] as const;
const HOUSEHOLD_SIZE_GROUPS = ["0", "1", "2", "3-4", "5+"] as const;

export async function getDashboardReports(db: D1Database, asOf = new Date()) {
  const asOfDate = asOf.toISOString().slice(0, 10);
  const [memberStatuses, archivedMembers, ageGroups, householdStatuses, householdSizes, groupMemberships] =
    await Promise.all([
      db
        .prepare("SELECT status, COUNT(*) AS count FROM members WHERE archived_at IS NULL GROUP BY status")
        .all<{ status: (typeof MEMBER_STATUSES)[number]; count: number }>(),
      db
        .prepare("SELECT COUNT(*) AS count FROM members WHERE archived_at IS NOT NULL")
        .first<{ count: number }>(),
      db
        .prepare(
          `WITH member_ages AS (
             SELECT CASE
               WHEN date_of_birth IS NULL OR date_of_birth = '' OR julianday(date_of_birth) IS NULL
                 OR date_of_birth > ? THEN NULL
               ELSE CAST(strftime('%Y', ?) AS INTEGER)
                 - CAST(strftime('%Y', date_of_birth) AS INTEGER)
                 - (strftime('%m-%d', ?) < strftime('%m-%d', date_of_birth))
             END AS age
             FROM members
             WHERE archived_at IS NULL AND status <> 'deceased'
           )
           SELECT CASE
             WHEN age IS NULL THEN 'Unknown'
             WHEN age < 18 THEN 'Under 18'
             WHEN age < 30 THEN '18-29'
             WHEN age < 45 THEN '30-44'
             WHEN age < 60 THEN '45-59'
             WHEN age < 75 THEN '60-74'
             ELSE '75+'
           END AS label, COUNT(*) AS count
           FROM member_ages
           GROUP BY label`,
        )
        .bind(asOfDate, asOfDate, asOfDate)
        .all<{ label: (typeof AGE_GROUPS)[number]; count: number }>(),
      db
        .prepare("SELECT status, COUNT(*) AS count FROM households GROUP BY status")
        .all<{ status: (typeof HOUSEHOLD_STATUSES)[number]; count: number }>(),
      db
        .prepare(
          `WITH household_sizes AS (
             SELECT h.id, COUNT(m.id) AS member_count
             FROM households h
             LEFT JOIN member_households mh
               ON mh.household_id = h.id AND mh.valid_until IS NULL
             LEFT JOIN members m
               ON m.id = mh.member_id AND m.archived_at IS NULL
             GROUP BY h.id
           )
           SELECT CASE
             WHEN member_count = 0 THEN '0'
             WHEN member_count = 1 THEN '1'
             WHEN member_count = 2 THEN '2'
             WHEN member_count < 5 THEN '3-4'
             ELSE '5+'
           END AS label, COUNT(*) AS count
           FROM household_sizes
           GROUP BY label`,
        )
        .all<{ label: (typeof HOUSEHOLD_SIZE_GROUPS)[number]; count: number }>(),
      db
        .prepare(
          `SELECT g.id, g.name, COUNT(m.id) AS member_count
           FROM groups g
           LEFT JOIN member_group_memberships mg
             ON mg.group_id = g.id AND mg.valid_until IS NULL
           LEFT JOIN members m
             ON m.id = mg.member_id AND m.archived_at IS NULL
           GROUP BY g.id
           ORDER BY member_count DESC, g.name COLLATE NOCASE
           LIMIT 10`,
        )
        .all<{ id: string; name: string; member_count: number }>(),
    ]);

  const memberStatusCounts = new Map(memberStatuses.results.map((row) => [row.status, row.count]));
  const ageGroupCounts = new Map(ageGroups.results.map((row) => [row.label, row.count]));
  const householdStatusCounts = new Map(householdStatuses.results.map((row) => [row.status, row.count]));
  const householdSizeCounts = new Map(householdSizes.results.map((row) => [row.label, row.count]));

  return {
    memberStatuses: [
      ...MEMBER_STATUSES.map((status) => ({
        label: status[0].toUpperCase() + status.slice(1),
        count: memberStatusCounts.get(status) ?? 0,
      })),
      { label: "Archived", count: archivedMembers?.count ?? 0 },
    ],
    ageGroups: AGE_GROUPS.map((label) => ({ label, count: ageGroupCounts.get(label) ?? 0 })),
    householdStatuses: HOUSEHOLD_STATUSES.map((status) => ({
      label: status[0].toUpperCase() + status.slice(1),
      count: householdStatusCounts.get(status) ?? 0,
    })),
    householdSizes: HOUSEHOLD_SIZE_GROUPS.map((label) => ({
      label: label === "0" ? "0 members" : `${label} ${label === "1" ? "member" : "members"}`,
      count: householdSizeCounts.get(label) ?? 0,
    })),
    groupMemberships: groupMemberships.results,
  };
}
