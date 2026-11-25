import { toScaledInt, divRound } from '../lib/numbers.js';
import { postStockMovement, issueAtAverageCost } from './stock.js';

async function toBase(client, item, qty, unit) {
  const { rows: [u] } = await client.query(
    'SELECT base_unit, to_base FROM units WHERE code = $1', [unit]);
  if (!u) throw new Error(`Unknown unit: ${unit}`);
  if (u.base_unit !== item.base_unit) {
    throw new Error(`${unit} cannot be used for ${item.code} (base unit ${item.base_unit})`);
  }
  return toScaledInt(qty, BigInt(u.to_base));
}

// lines: [{ itemCode, qty, unit, wasted? }]  (wasted is in the same unit, e.g. damaged pouches)
export async function recordProductionRun(client, {
  productCode, batches = 1, runDate = null, lines, goodOutput, labour = '0', overhead = '0',
}) {
  const { rows: [bom] } = await client.query(
    `SELECT b.id, b.batch_yield, i.id AS fg_item_id
     FROM boms b JOIN items i ON i.id = b.fg_item_id WHERE i.code = $1`, [productCode]);
  if (!bom) throw new Error(`No BOM for ${productCode}`);

  const batchCount = BigInt(batches);
  const expectedOutput = BigInt(bom.batch_yield) * batchCount;
  const actualGood = BigInt(goodOutput);

  const { rows: bomItems } = await client.query(
    `SELECT bi.item_id, bi.qty_per_batch, i.code, i.base_unit
     FROM bom_items bi JOIN items i ON i.id = bi.item_id WHERE bi.bom_id = $1`, [bom.id]);

  const known = new Set(bomItems.map((b) => b.code));
  for (const l of lines) {
    if (!known.has(l.itemCode)) throw new Error(`${l.itemCode} is not in the BOM for ${productCode}`);
  }

  const { rows: [run] } = await client.query(
    `INSERT INTO production_runs
       (bom_id, run_date, expected_output, actual_good_output, labour_paise, overhead_paise)
     VALUES ($1, COALESCE($2, CURRENT_DATE), $3, $4, $5, $6) RETURNING id`,
    [bom.id, runDate, expectedOutput.toString(), actualGood.toString(),
     toScaledInt(labour, 100).toString(), toScaledInt(overhead, 100).toString()]);

  let materialCost = 0n;
  for (const b of bomItems) {
    const planned = BigInt(b.qty_per_batch) * batchCount;
    const line = lines.find((l) => l.itemCode === b.code);
    const used = line ? await toBase(client, b, line.qty, line.unit) : 0n;
    const wasted = line?.wasted ? await toBase(client, b, line.wasted, line.unit) : 0n;

    let value = 0n;
    if (used > 0n) {
      value += await issueAtAverageCost(client, {
        itemId: b.item_id, qty: used, movementType: 'PRODUCTION_ISSUE',
        sourceType: 'production_run', sourceId: run.id,
      });
    }
    if (wasted > 0n) {
      value += await issueAtAverageCost(client, {
        itemId: b.item_id, qty: wasted, movementType: 'PRODUCTION_WASTE',
        sourceType: 'production_run', sourceId: run.id, note: 'Damaged / scrapped',
      });
    }

    await client.query(
      `INSERT INTO run_consumption (run_id, item_id, planned_qty, actual_qty, value_paise)
       VALUES ($1, $2, $3, $4, $5)`,
      [run.id, b.item_id, planned.toString(), (used + wasted).toString(), value.toString()]);
    materialCost += value;
  }

  if (actualGood > 0n) {
    await postStockMovement(client, {
      itemId: bom.fg_item_id, movementType: 'PRODUCTION_OUTPUT',
      qtyDelta: actualGood, valueDeltaPaise: materialCost,
      sourceType: 'production_run', sourceId: run.id,
    });
  }
  return { runId: run.id, expectedOutput, actualGood, materialCostPaise: materialCost };
}

// Add labour / gas / power to a run after the fact (benchmark step 8)
export async function addRunOverheads(client, runId, { labour = '0', overhead = '0' }) {
  await client.query(
    `UPDATE production_runs
     SET labour_paise = labour_paise + $2, overhead_paise = overhead_paise + $3
     WHERE id = $1`,
    [runId, toScaledInt(labour, 100).toString(), toScaledInt(overhead, 100).toString()]);
}

export async function getRunReport(client, runId) {
  const { rows: [run] } = await client.query(
    `SELECT r.*, b.tolerance_bp, i.code AS product
     FROM production_runs r
     JOIN boms b ON b.id = r.bom_id
     JOIN items i ON i.id = b.fg_item_id WHERE r.id = $1`, [runId]);
  const { rows: cons } = await client.query(
    `SELECT i.code, rc.planned_qty, rc.actual_qty, rc.value_paise
     FROM run_consumption rc JOIN items i ON i.id = rc.item_id
     WHERE rc.run_id = $1 ORDER BY i.id`, [runId]);

  const tol = BigInt(run.tolerance_bp);
  const variance = (planned, actual) => {
    const p = BigInt(planned);
    const bp = divRound((BigInt(actual) - p) * 10000n, p);
    return {
      variancePct: (Number(bp) / 100).toFixed(2) + '%',
      flagged: (bp < 0n ? -bp : bp) > tol,    // strictly beyond tolerance
    };
  };

  const consumption = cons.map((c) => ({
    item: c.code, planned: c.planned_qty, actual: c.actual_qty,
    ...variance(c.planned_qty, c.actual_qty),
  }));
  const material = cons.reduce((s, c) => s + BigInt(c.value_paise), 0n);
  const totalCost = material + BigInt(run.labour_paise) + BigInt(run.overhead_paise);
  const good = BigInt(run.actual_good_output);

  return {
    product: run.product,
    consumption,
    yield: { expected: run.expected_output, actual: run.actual_good_output,
             ...variance(run.expected_output, run.actual_good_output) },
    materialCostPaise: material,
    labourPaise: BigInt(run.labour_paise),
    overheadPaise: BigInt(run.overhead_paise),
    costPerPacketPaise: good > 0n ? divRound(totalCost, good) : null,
  };
}