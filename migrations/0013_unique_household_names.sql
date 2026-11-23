WITH ranked_households AS (
  SELECT
    h.id,
    h.name,
    ROW_NUMBER() OVER (
      PARTITION BY lower(trim(h.name))
      ORDER BY h.created_at, h.id
    ) AS duplicate_rank,
    trim(COALESCE(m.first_name, '') || ' ' || COALESCE(m.family_name, '')) AS head_name
  FROM households h
  LEFT JOIN members m ON m.id = h.head_member_id
),
duplicate_households AS (
  SELECT
    id,
    name,
    head_name,
    COUNT(*) OVER (PARTITION BY lower(trim(head_name))) AS matching_head_names
  FROM ranked_households
  WHERE duplicate_rank > 1
),
resolved_names AS (
  SELECT
    duplicate_households.id,
    CASE
      WHEN head_name <> ''
        AND matching_head_names = 1
        AND NOT EXISTS (
          SELECT 1
          FROM households existing
          WHERE existing.id <> duplicate_households.id
            AND lower(trim(existing.name)) = lower(trim(duplicate_households.head_name))
        )
        THEN head_name
      WHEN head_name <> ''
        THEN head_name || ' (' || id || ')'
      ELSE trim(name) || ' (household ' || id || ')'
    END AS name
  FROM duplicate_households
)
UPDATE households
SET name = (SELECT resolved_names.name FROM resolved_names WHERE resolved_names.id = households.id)
WHERE id IN (SELECT id FROM resolved_names);

CREATE UNIQUE INDEX uq_households_name_normalized
  ON households(lower(trim(name)));
