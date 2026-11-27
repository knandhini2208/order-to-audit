import { useEffect, useState } from 'react';
import { api } from './api.js';

// Quantities are stored in base units (g, ml, pcs, packet); the screen shows kg, l, pcs
const UNIT = {
  g: { code: 'kg', f: 1000 },
  ml: { code: 'l', f: 1000 },
  pcs: { code: 'pcs', f: 1 },
  packet: { code: 'packet', f: 1 },
};
const show = (qty, baseUnit) => `${Number(qty) / UNIT[baseUnit].f} ${UNIT[baseUnit].code}`;
const toInput = (qty, baseUnit) => String(Number(qty) / UNIT[baseUnit].f);
const rs = (p) => {
  const n = Number(p);
  return `₹${Math.floor(n / 100)}.${String(n % 100).padStart(2, '0')}`;
};

export default function ProductionScreen() {
  const [bom, setBom] = useState(null);
  const [stock, setStock] = useState([]);
  const [batches, setBatches] = useState('1');
  const [used, setUsed] = useState({});
  const [damaged, setDamaged] = useState({});
  const [good, setGood] = useState(null);
  const [labour, setLabour] = useState('');
  const [overhead, setOverhead] = useState('');
  const [result, setResult] = useState(null);
  const [msg, setMsg] = useState({ text: '', ok: true });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api('/bom/MUR200').then(setBom).catch((e) => setMsg({ text: e.message, ok: false }));
    api('/stock').then(setStock).catch(() => {});
  }, []);

  if (!bom) return <div className="card">{msg.text || 'Loading…'}</div>;

  const n = Math.max(parseInt(batches, 10) || 1, 1);
  const expected = Number(bom.batchYield) * n;
  const plannedInput = (it) => toInput(Number(it.qty_per_batch) * n, it.base_unit);
  const goodValue = good ?? String(expected);
  const byCode = Object.fromEntries(bom.items.map((it) => [it.code, it]));

  async function submit() {
    setMsg({ text: '', ok: true });
    const goodOutput = Number(goodValue);
    if (!Number.isInteger(goodOutput) || goodOutput < 0) {
      setMsg({ text: 'Good packets must be a whole number', ok: false });
      return;
    }
    setBusy(true);
    try {
      const lines = bom.items.map((it) => {
        const u = used[it.code] ?? plannedInput(it);
        return {
          itemCode: it.code,
          qty: u === '' ? '0' : String(u),
          unit: UNIT[it.base_unit].code,
          wasted: damaged[it.code] ? String(damaged[it.code]) : undefined,
        };
      });
      const r = await api('/production-runs', {
        method: 'POST',
        body: { productCode: bom.product, batches: n, goodOutput, lines,
                labour: labour || '0', overhead: overhead || '0' },
      });
      setResult(r.report);
      setMsg({ text: `Production run #${r.runId} saved. Stock updated.`, ok: true });
      setUsed({}); setDamaged({}); setGood(null); setLabour(''); setOverhead('');
      api('/stock').then(setStock);
    } catch (err) {
      setMsg({ text: err.message, ok: false });
    }
    setBusy(false);
  }

  return (
    <>
      {msg.text && <div className={`card ${msg.ok ? 'ok' : 'err'}`}>{msg.text}</div>}

      <div className="card">
        <h2>Log production run: {bom.name}</h2>
        <div className="two">
          <div>
            <label>Batches</label>
            <input type="number" min="1" step="1" value={batches}
              onChange={(e) => setBatches(e.target.value)} />
          </div>
          <div>
            <label>Good packets produced</label>
            <input type="number" min="0" step="1" value={goodValue}
              onChange={(e) => setGood(e.target.value)} />
          </div>
        </div>
        <div className="muted">Expected output from the recipe: {expected} packets</div>

        <label>Materials (pre-filled from the recipe, change to what was really used)</label>
        {bom.items.map((it) => (
          <div className="line" key={it.code}>
            <div>
              {it.name}{' '}
              <span className="muted">· standard {show(Number(it.qty_per_batch) * n, it.base_unit)}</span>
            </div>
            <div className="two">
              <div>
                <label>Used ({UNIT[it.base_unit].code})</label>
                <input type="number" min="0" step="any"
                  value={used[it.code] ?? plannedInput(it)}
                  onChange={(e) => setUsed({ ...used, [it.code]: e.target.value })} />
              </div>
              <div>
                <label>Damaged / wasted (same unit)</label>
                <input type="number" min="0" step="any" placeholder="0"
                  value={damaged[it.code] ?? ''}
                  onChange={(e) => setDamaged({ ...damaged, [it.code]: e.target.value })} />
              </div>
            </div>
          </div>
        ))}

        <div className="two">
          <div>
            <label>Labour (₹)</label>
            <input type="number" min="0" step="0.01" placeholder="0" value={labour}
              onChange={(e) => setLabour(e.target.value)} />
          </div>
          <div>
            <label>Gas / power (₹)</label>
            <input type="number" min="0" step="0.01" placeholder="0" value={overhead}
              onChange={(e) => setOverhead(e.target.value)} />
          </div>
        </div>
        <button disabled={busy} onClick={submit}>Save production run</button>
      </div>

      {result && (
        <div className="card">
          <h2>Run result: planned vs actual</h2>
          <div className="row">
            <div>Yield: {result.yield.actual} of {result.yield.expected} packets</div>
            <span className={result.yield.flagged ? 'flag' : 'fine'}>
              {result.yield.variancePct}{result.yield.flagged ? ' · FLAGGED' : ''}
            </span>
          </div>
          {result.consumption.map((r) => (
            <div className="row" key={r.item}>
              <div>
                {byCode[r.item].name}
                <div className="muted">
                  planned {show(r.planned, byCode[r.item].base_unit)} · actual {show(r.actual, byCode[r.item].base_unit)}
                </div>
              </div>
              <span className={r.flagged ? 'flag' : 'fine'}>
                {r.variancePct}{r.flagged ? ' · FLAGGED' : ''}
              </span>
            </div>
          ))}
          <div className="row"><div>Material cost</div><strong>{rs(result.materialCostPaise)}</strong></div>
          <div className="row">
            <div>Cost per packet (materials + labour + overheads)</div>
            <strong>{rs(result.costPerPacketPaise)}</strong>
          </div>
        </div>
      )}

      <div className="card">
        <h2>Stock now</h2>
        {stock.map((s) => (
          <div className="row" key={s.code}>
            <div>{s.name}<div className="muted">{s.item_type.toLowerCase()}</div></div>
            <strong>{show(s.qty, s.base_unit)}</strong>
          </div>
        ))}
      </div>
    </>
  );
}