-- UNITS: every quantity is stored as an integer in the BASE unit (g, ml, pcs, packet)
CREATE TABLE units (
  code      TEXT PRIMARY KEY,
  base_unit TEXT NOT NULL REFERENCES units(code),
  to_base   BIGINT NOT NULL CHECK (to_base > 0)   -- how many base units in 1 of this unit
);

INSERT INTO units (code, base_unit, to_base) VALUES
  ('g','g',1), ('kg','g',1000),
  ('ml','ml',1), ('l','ml',1000),
  ('pcs','pcs',1),
  ('packet','packet',1), ('carton','packet',20);

-- ITEMS: raw materials, packaging and finished goods
CREATE TABLE items (
  id                    SERIAL PRIMARY KEY,
  code                  TEXT UNIQUE NOT NULL,
  name                  TEXT NOT NULL,
  item_type             TEXT NOT NULL CHECK (item_type IN ('RAW','PACKAGING','FG')),
  base_unit             TEXT NOT NULL REFERENCES units(code),
  hsn_code              TEXT,
  gst_rate_bp           INT NOT NULL DEFAULT 0,        -- basis points: 500 = 5%
  selling_price_paise   BIGINT                         -- FG only; integer paise, never floats
);

CREATE TABLE suppliers (
  id    SERIAL PRIMARY KEY,
  name  TEXT NOT NULL,
  gstin TEXT
);

-- STOCK LEDGER: the single source of truth. Balances are always SUM(), never overwritten.
CREATE TABLE stock_ledger (
  id                BIGSERIAL PRIMARY KEY,
  item_id           INT NOT NULL REFERENCES items(id),
  movement_type     TEXT NOT NULL CHECK (movement_type IN
                      ('OPENING','PURCHASE','PRODUCTION_ISSUE','PRODUCTION_WASTE',
                       'PRODUCTION_OUTPUT','DISPATCH','SALES_RETURN','ADJUSTMENT')),
  qty_delta         BIGINT NOT NULL CHECK (qty_delta <> 0),  -- base units; + in, - out
  value_delta_paise BIGINT NOT NULL DEFAULT 0,               -- value of this movement
  source_type       TEXT NOT NULL,   -- 'purchase', 'production_run', 'invoice', 'adjustment', 'opening'
  source_id         BIGINT,
  note              TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_ledger_item ON stock_ledger(item_id);

-- Ledger is append-only: corrections are new reversing rows
CREATE FUNCTION forbid_ledger_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'stock_ledger is append-only; post a reversing entry instead';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER stock_ledger_append_only
  BEFORE UPDATE OR DELETE ON stock_ledger
  FOR EACH ROW EXECUTE FUNCTION forbid_ledger_change();

CREATE VIEW stock_balance AS
  SELECT item_id,
         SUM(qty_delta)         AS qty,
         SUM(value_delta_paise) AS value_paise
  FROM stock_ledger GROUP BY item_id;

-- BOM: standard quantities per batch
CREATE TABLE boms (
  id            SERIAL PRIMARY KEY,
  fg_item_id    INT NOT NULL REFERENCES items(id),
  batch_yield   BIGINT NOT NULL CHECK (batch_yield > 0),   -- packets per batch
  tolerance_bp  INT NOT NULL DEFAULT 300                   -- 300 = 3% variance tolerance
);

CREATE TABLE bom_items (
  bom_id         INT NOT NULL REFERENCES boms(id),
  item_id        INT NOT NULL REFERENCES items(id),
  qty_per_batch  BIGINT NOT NULL CHECK (qty_per_batch > 0),  -- base units
  PRIMARY KEY (bom_id, item_id)
);

-- PURCHASES
CREATE TABLE purchases (
  id            SERIAL PRIMARY KEY,
  supplier_id   INT REFERENCES suppliers(id),
  bill_no       TEXT,
  purchase_date DATE NOT NULL DEFAULT CURRENT_DATE
);

CREATE TABLE purchase_items (
  id           SERIAL PRIMARY KEY,
  purchase_id  INT NOT NULL REFERENCES purchases(id),
  item_id      INT NOT NULL REFERENCES items(id),
  qty          BIGINT NOT NULL CHECK (qty > 0),        -- base units
  amount_paise BIGINT NOT NULL CHECK (amount_paise >= 0)
);

-- PRODUCTION RUNS
CREATE TABLE production_runs (
  id                 SERIAL PRIMARY KEY,
  bom_id             INT NOT NULL REFERENCES boms(id),
  run_date           DATE NOT NULL DEFAULT CURRENT_DATE,
  expected_output    BIGINT NOT NULL,
  actual_good_output BIGINT NOT NULL,
  labour_paise       BIGINT NOT NULL DEFAULT 0,
  overhead_paise     BIGINT NOT NULL DEFAULT 0       -- gas, power, other
);

CREATE TABLE run_consumption (
  run_id        INT NOT NULL REFERENCES production_runs(id),
  item_id       INT NOT NULL REFERENCES items(id),
  planned_qty   BIGINT NOT NULL,
  actual_qty    BIGINT NOT NULL,      -- includes damaged/wasted
  value_paise   BIGINT NOT NULL,      -- valued at weighted-average at issue time
  PRIMARY KEY (run_id, item_id)
);