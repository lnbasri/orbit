CREATE TABLE admin_role_assignments (
  admin_email TEXT NOT NULL REFERENCES admins(email) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (
    role IN ('MEMBERSHIP', 'FINANCE', 'COMMUNICATIONS', 'DOCUMENT_PREPARER', 'APPROVER', 'PRIVACY')
  ),
  assigned_by TEXT NOT NULL,
  assigned_at TEXT NOT NULL,
  PRIMARY KEY (admin_email, role)
);

CREATE TABLE admin_capability_grants (
  admin_email TEXT NOT NULL REFERENCES admins(email) ON DELETE CASCADE,
  capability TEXT NOT NULL CHECK (
    capability IN (
      'members.export',
      'members.import',
      'communications.export',
      'documents.download',
      'privacy.export'
    )
  ),
  assigned_by TEXT NOT NULL,
  assigned_at TEXT NOT NULL,
  PRIMARY KEY (admin_email, capability)
);

CREATE TABLE admin_departments (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE admin_department_memberships (
  department_id TEXT NOT NULL REFERENCES admin_departments(id) ON DELETE CASCADE,
  admin_email TEXT NOT NULL REFERENCES admins(email) ON DELETE CASCADE,
  assigned_by TEXT NOT NULL,
  assigned_at TEXT NOT NULL,
  PRIMARY KEY (department_id, admin_email)
);
