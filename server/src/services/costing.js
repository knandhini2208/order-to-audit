import { divRound } from '../lib/numbers.js';
import { getRunReport } from './production.js';

// Cost per packet and margin for one production run.
// Method: weighted-average material cost + labour + overheads, all divided by GOOD packets.
export async function getRunCosting(client, runId) {
  const r = await getRunReport(client, runId);
  const { rows: [item] } = await client.query(
    'SELECT selling_price_paise FROM items WHERE code = $1', [r.product]);
  const price = BigInt(item.selling_price_paise);
  const totalCost = r.materialCostPaise + r.labourPaise + r.overheadPaise;
  const costPerPacket = r.costPerPacketPaise;
  const margin = price - costPerPacket;
  return {
    product: r.product,
    goodPackets: BigInt(r.yield.actual),
    materialCostPaise: r.materialCostPaise,
    labourPaise: r.labourPaise,
    overheadPaise: r.overheadPaise,
    totalCostPaise: totalCost,
    costPerPacketPaise: costPerPacket,
    sellingPricePaise: price,
    marginPaise: margin,
    marginBp: divRound(margin * 10000n, price),   // 3772 = 37.72%
  };
}