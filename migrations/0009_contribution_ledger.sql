CREATE TABLE contributions (
  id TEXT PRIMARY KEY,
  member_id TEXT REFERENCES members(id),
  household_id TEXT REFERENCES households(id),
  record_type TEXT NOT NULL DEFAULT 'contribution'
    CHECK (record_type IN ('contribution', 'invoice')),
  title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 120),
  reference TEXT,
  amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
  currency_code TEXT NOT NULL DEFAULT 'EUR'
    CHECK (length(currency_code) = 3 AND currency_code GLOB '[A-Z][A-Z][A-Z]'),
  minor_unit_exponent INTEGER NOT NULL DEFAULT 2
    CHECK (minor_unit_exponent BETWEEN 0 AND 3),
  due_on TEXT,
  notes TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  voided_at TEXT,
  voided_by TEXT,
  void_reason TEXT,
  CHECK (
    (member_id IS NOT NULL AND household_id IS NULL) OR
    (member_id IS NULL AND household_id IS NOT NULL)
  )
);
CREATE INDEX idx_contributions_due ON contributions(due_on, voided_at);
CREATE INDEX idx_contributions_member ON contributions(member_id, created_at DESC);
CREATE INDEX idx_contributions_household ON contributions(household_id, created_at DESC);

CREATE TABLE contribution_payments (
  id TEXT PRIMARY KEY,
  contribution_id TEXT NOT NULL REFERENCES contributions(id),
  amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
  paid_on TEXT NOT NULL,
  method TEXT NOT NULL CHECK (method IN ('bank_transfer', 'cash', 'card', 'other')),
  reference TEXT,
  notes TEXT,
  recorded_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  voided_at TEXT,
  voided_by TEXT,
  void_reason TEXT
);
CREATE INDEX idx_contribution_payments_record ON contribution_payments(contribution_id, paid_on);

CREATE TRIGGER contribution_payment_guard
BEFORE INSERT ON contribution_payments
WHEN EXISTS (
  SELECT 1 FROM contributions
  WHERE id = NEW.contribution_id AND voided_at IS NOT NULL
)
BEGIN
  SELECT RAISE(ABORT, 'Contribution is voided');
END;

CREATE TRIGGER contribution_payment_overpayment_guard
BEFORE INSERT ON contribution_payments
WHEN NEW.amount_minor + COALESCE((
  SELECT SUM(amount_minor) FROM contribution_payments
  WHERE contribution_id = NEW.contribution_id AND voided_at IS NULL
), 0) > (
  SELECT amount_minor FROM contributions WHERE id = NEW.contribution_id
)
BEGIN
  SELECT RAISE(ABORT, 'Payment exceeds outstanding balance');
END;

