CREATE TABLE company (
  id         INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),   -- exactly one row
  name       TEXT NOT NULL,
  gstin      TEXT NOT NULL,
  state_code TEXT NOT NULL,                              -- GST state code, TN = '33'
  address    TEXT
);

CREATE TABLE users (
  id            SERIAL PRIMARY KEY,
  username      TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  full_name     TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('SALESMAN','ADMIN','PRODUCTION','ACCOUNTANT','OWNER'))
);

CREATE TABLE customers (
  id            SERIAL PRIMARY KEY,
  name          TEXT NOT NULL,
  customer_type TEXT NOT NULL CHECK (customer_type IN ('RETAILER','DISTRIBUTOR')),
  gstin         TEXT,
  state_code    TEXT NOT NULL,                           -- place of supply: TN = '33', KA = '29'
  address       TEXT
);

CREATE TABLE orders (
  id          SERIAL PRIMARY KEY,
  customer_id INT NOT NULL REFERENCES customers(id),
  salesman_id INT REFERENCES users(id),
  status      TEXT NOT NULL DEFAULT 'SUBMITTED'
              CHECK (status IN ('SUBMITTED','APPROVED','REJECTED','INVOICED','DISPATCHED')),
  note        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE order_items (
  id         SERIAL PRIMARY KEY,
  order_id   INT NOT NULL REFERENCES orders(id),
  item_id    INT NOT NULL REFERENCES items(id),
  qty        BIGINT NOT NULL CHECK (qty > 0),            -- packets
  rate_paise BIGINT NOT NULL CHECK (rate_paise >= 0)     -- paise per packet, before tax
);

-- Gapless invoice numbers per financial year
CREATE TABLE invoice_counters (
  fy       TEXT PRIMARY KEY,                             -- '2026-27'
  last_seq INT NOT NULL
);

CREATE TABLE invoices (
  id              SERIAL PRIMARY KEY,
  invoice_no      TEXT UNIQUE NOT NULL,                  -- '2026-27/0001'
  order_id        INT REFERENCES orders(id),
  customer_id     INT NOT NULL REFERENCES customers(id),
  invoice_date    DATE NOT NULL DEFAULT CURRENT_DATE,
  place_of_supply TEXT NOT NULL,
  taxable_paise   BIGINT NOT NULL,
  cgst_paise      BIGINT NOT NULL DEFAULT 0,
  sgst_paise      BIGINT NOT NULL DEFAULT 0,
  igst_paise      BIGINT NOT NULL DEFAULT 0,
  total_paise     BIGINT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'POSTED' CHECK (status IN ('POSTED','CANCELLED'))
);

CREATE TABLE invoice_items (
  id            SERIAL PRIMARY KEY,
  invoice_id    INT NOT NULL REFERENCES invoices(id),
  item_id       INT NOT NULL REFERENCES items(id),
  hsn_code      TEXT,
  qty           BIGINT NOT NULL,
  rate_paise    BIGINT NOT NULL,
  gst_rate_bp   INT NOT NULL,
  taxable_paise BIGINT NOT NULL,
  cgst_paise    BIGINT NOT NULL DEFAULT 0,
  sgst_paise    BIGINT NOT NULL DEFAULT 0,
  igst_paise    BIGINT NOT NULL DEFAULT 0
);

CREATE TABLE dispatches (
  id            SERIAL PRIMARY KEY,
  invoice_id    INT NOT NULL REFERENCES invoices(id),
  dispatched_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE payments (
  id           SERIAL PRIMARY KEY,
  customer_id  INT NOT NULL REFERENCES customers(id),
  invoice_id   INT REFERENCES invoices(id),
  amount_paise BIGINT NOT NULL CHECK (amount_paise > 0),
  paid_on      DATE NOT NULL DEFAULT CURRENT_DATE,
  mode         TEXT
);

-- Who changed what and when (invoices and production runs)
CREATE TABLE audit_log (
  id         BIGSERIAL PRIMARY KEY,
  user_id    INT REFERENCES users(id),
  entity     TEXT NOT NULL,
  entity_id  BIGINT NOT NULL,
  action     TEXT NOT NULL,
  before     JSONB,
  after      JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);