import { valueOfIssue } from '../lib/numbers.js';

export class InsufficientStockError extends Error {}

export async function getBalance(client, itemId) {
  const { rows } = await client.query(
    `SELECT COALESCE(SUM(qty_delta), 0) AS qty,
            COALESCE(SUM(value_delta_paise), 0) AS value
     FROM stock_ledger WHERE item_id = $1`,
    [itemId]
  );
  return { qty: BigInt(rows[0].qty), value: BigInt(rows[0].value) };
}

// The ONLY way stock changes. Appends one ledger row.
export async function postStockMovement(client, m) {
  const {
    itemId, movementType, qtyDelta, valueDeltaPaise = 0n,
    sourceType, sourceId = null, note = null,
  } = m;

  // Lock the item row so two requests cannot spend the same stock at once.
  await client.query('SELECT id FROM items WHERE id = $1 FOR UPDATE', [itemId]);

  if (qtyDelta < 0n) {
    const bal = await getBalance(client, itemId);
    if (bal.qty + qtyDelta < 0n) {
      throw new InsufficientStockError(
        `Item ${itemId}: have ${bal.qty}, need ${-qtyDelta} (base units)`
      );
    }
  }

  const { rows } = await client.query(
    `INSERT INTO stock_ledger
       (item_id, movement_type, qty_delta, value_delta_paise, source_type, source_id, note)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [itemId, movementType, qtyDelta.toString(), valueDeltaPaise.toString(),
     sourceType, sourceId, note]
  );
  return rows[0].id;
}

// Issues stock out, valued at the current weighted-average cost.
// Returns the value (paise) taken out.
export async function issueAtAverageCost(client, m) {
  const { itemId, qty, movementType = 'PRODUCTION_ISSUE', sourceType, sourceId, note } = m;
  await client.query('SELECT id FROM items WHERE id = $1 FOR UPDATE', [itemId]);
  const bal = await getBalance(client, itemId);
  if (qty > bal.qty) {
    throw new InsufficientStockError(`Item ${itemId}: have ${bal.qty}, need ${qty}`);
  }
  const value = valueOfIssue(bal.value, bal.qty, qty);
  await postStockMovement(client, {
    itemId, movementType, qtyDelta: -qty, valueDeltaPaise: -value,
    sourceType, sourceId, note,
  });
  return value;
}