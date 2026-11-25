import { toScaledInt, divRound } from '../lib/numbers.js';
import { postStockMovement } from './stock.js';

// lines: [{ itemCode, qty: "60", unit: "kg", rate: "45" }]  (rate = Rs per that unit)
export async function recordPurchase(client, { supplierId = null, billNo = null, purchaseDate = null, lines }) {
  const { rows: [purchase] } = await client.query(
    `INSERT INTO purchases (supplier_id, bill_no, purchase_date)
     VALUES ($1, $2, COALESCE($3, CURRENT_DATE)) RETURNING id`,
    [supplierId, billNo, purchaseDate]
  );

  for (const line of lines) {
    const { rows: [item] } = await client.query(
      'SELECT id, base_unit FROM items WHERE code = $1', [line.itemCode]);
    if (!item) throw new Error(`Unknown item: ${line.itemCode}`);

    const { rows: [unit] } = await client.query(
      'SELECT base_unit, to_base FROM units WHERE code = $1', [line.unit]);
    if (!unit) throw new Error(`Unknown unit: ${line.unit}`);
    if (unit.base_unit !== item.base_unit) {
      throw new Error(`${line.unit} cannot be used for ${line.itemCode} (base unit ${item.base_unit})`);
    }

    const toBase = BigInt(unit.to_base);
    const qty = toScaledInt(line.qty, toBase);              // base units
    const ratePaise = toScaledInt(line.rate, 100);          // paise per purchase unit
    const amount = divRound(qty * ratePaise, toBase);       // paise

    await client.query(
      `INSERT INTO purchase_items (purchase_id, item_id, qty, amount_paise)
       VALUES ($1, $2, $3, $4)`,
      [purchase.id, item.id, qty.toString(), amount.toString()]
    );

    await postStockMovement(client, {
      itemId: item.id, movementType: 'PURCHASE',
      qtyDelta: qty, valueDeltaPaise: amount,
      sourceType: 'purchase', sourceId: purchase.id,
    });
  }
  return purchase.id;
}