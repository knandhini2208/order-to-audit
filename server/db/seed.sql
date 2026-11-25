-- ITEMS (quantities in base units: g, ml, pcs, packet)
INSERT INTO items (code, name, item_type, base_unit, hsn_code, gst_rate_bp, selling_price_paise) VALUES
  ('FLOUR',    'Flour',                     'RAW',       'g',      NULL,       0,   NULL),
  ('OIL',      'Cooking oil',               'RAW',       'ml',     NULL,       0,   NULL),
  ('SPICE',    'Salt and spice mix',        'RAW',       'g',      NULL,       0,   NULL),
  ('POUCH200', '200 g pouch',               'PACKAGING', 'pcs',    NULL,       0,   NULL),
  ('CARTON20', 'Carton (holds 20 packets)', 'PACKAGING', 'pcs',    NULL,       0,   NULL),
  ('MUR200',   'Murukku 200 g',             'FG',        'packet', '21069099', 500, 5000);

-- BOM for Murukku 200 g: 1 batch = 200 packets, 3% tolerance
INSERT INTO boms (fg_item_id, batch_yield, tolerance_bp)
SELECT id, 200, 300 FROM items WHERE code = 'MUR200';

INSERT INTO bom_items (bom_id, item_id, qty_per_batch)
SELECT (SELECT id FROM boms LIMIT 1), i.id, v.qty
FROM (VALUES
  ('FLOUR',    40000),   -- 40 kg
  ('OIL',      10000),   -- 10 L
  ('SPICE',     1200),   -- 1.2 kg
  ('POUCH200',   200),
  ('CARTON20',    10)
) AS v(code, qty)
JOIN items i ON i.code = v.code;

-- OPENING STOCK as ledger rows (qty in base units, value in paise)
INSERT INTO stock_ledger (item_id, movement_type, qty_delta, value_delta_paise, source_type, note)
SELECT i.id, 'OPENING', v.qty, v.val, 'opening', 'Benchmark opening stock'
FROM (VALUES
  ('FLOUR',   100000, 420000),   -- 100 kg @ Rs 42
  ('OIL',      30000, 420000),   -- 30 L   @ Rs 140
  ('SPICE',     5000, 100000),   -- 5 kg   @ Rs 200
  ('POUCH200',   500, 125000),   -- 500    @ Rs 2.50
  ('CARTON20',    30,  45000),   -- 30     @ Rs 15
  ('MUR200',      50,      0)    -- 50 packets, valued at 0 (see note below)
) AS v(code, qty, val)
JOIN items i ON i.code = v.code;