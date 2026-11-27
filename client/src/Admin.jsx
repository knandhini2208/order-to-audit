import { useEffect, useState } from 'react';
import { api } from './api.js';

const rs = (p) => {
  const n = Number(p);
  return `₹${Math.floor(n / 100)}.${String(n % 100).padStart(2, '0')}`;
};

export default function AdminOrders() {
  const [orders, setOrders] = useState([]);
  const [checks, setChecks] = useState({});
  const [out, setOut] = useState([]);
  const [pay, setPay] = useState({});
  const [msg, setMsg] = useState({ text: '', ok: true });

  async function load() {
    const list = await api('/orders');
    setOrders(list);
    setOut(await api('/outstanding'));
    const c = {};
    await Promise.all(
      list.filter((o) => o.status === 'SUBMITTED').map(async (o) => {
        c[o.id] = await api(`/orders/${o.id}/stock-check`);
      })
    );
    setChecks(c);
  }
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, []);  async function act(label, path, body) {
    setMsg({ text: '', ok: true });
    try {
      const r = await api(path, { method: 'POST', body });
      setMsg({ text: label + (r.invoiceNo ? ` (${r.invoiceNo})` : ''), ok: true });
    } catch (err) {
      setMsg({ text: err.message, ok: false });
    }
    await load();
  }

  return (
    <>
      {msg.text && <div className={`card ${msg.ok ? 'ok' : 'err'}`}>{msg.text}</div>}

      <div className="card">
        <h2>Orders</h2>
        {orders.length === 0 && <div className="muted">No orders yet</div>}
        {orders.map((o) => {
          const check = checks[o.id] || [];
          const short = check.some((r) => Number(r.shortage) > 0);
          const due = o.invoice_id ? Number(o.total_paise) - Number(o.paid_paise) : 0;
          return (
            <div className="order" key={o.id}>
              <div className="row">
                <div>
                  <div>#{o.id} · {o.customer}</div>
                  <div className="muted">
                    {o.salesman} · {o.packets} packets{o.invoice_no ? ` · ${o.invoice_no}` : ''}
                  </div>
                </div>
                <span className={`badge ${o.status}`}>{o.status}</span>
              </div>

              {o.status === 'SUBMITTED' && (
                <>
                  {check.map((r) => (
                    <div key={r.item} className={Number(r.shortage) > 0 ? 'err' : 'ok'}>
                      {r.item}: need {r.required}, have {r.available}
                      {Number(r.shortage) > 0 ? ` — short by ${r.shortage}` : ' — stock OK'}
                    </div>
                  ))}
                  <div className="btns">
                    <button disabled={short}
                      onClick={() => act(`Order #${o.id} approved`, `/orders/${o.id}/approve`)}>
                      Approve
                    </button>
                    <button className="danger"
                      onClick={() => act(`Order #${o.id} rejected`, `/orders/${o.id}/reject`)}>
                      Reject
                    </button>
                  </div>
                </>
              )}

              {o.status === 'APPROVED' && (
                <div className="btns">
                  <button onClick={() => act(`Invoice created for order #${o.id}`, `/orders/${o.id}/invoice`)}>
                    Create GST invoice
                  </button>
                </div>
              )}

              {o.status === 'INVOICED' && (
                <div className="btns">
                  <button onClick={() => act(`Invoice ${o.invoice_no} dispatched`, `/invoices/${o.invoice_id}/dispatch`)}>
                    Record dispatch
                  </button>
                </div>
              )}

              {o.invoice_id && (
                <div className="muted" style={{ marginTop: 8 }}>
                  Invoice {rs(o.total_paise)} · paid {rs(o.paid_paise)} · due {rs(due)}
                </div>
              )}

              {o.invoice_id && due > 0 && (
                <div className="btns">
                  <input type="number" min="0" step="0.01" placeholder="Amount received (₹)"
                    value={pay[o.invoice_id] ?? ''}
                    onChange={(e) => setPay({ ...pay, [o.invoice_id]: e.target.value })} />
                  <button disabled={!pay[o.invoice_id]}
                    onClick={async () => {
                      await act('Payment recorded', `/invoices/${o.invoice_id}/payments`,
                                { amount: pay[o.invoice_id], mode: 'UPI' });
                      setPay({ ...pay, [o.invoice_id]: '' });
                    }}>
                    Record payment
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="card">
        <h2>Customer outstanding</h2>
        {out.map((c) => (
          <div className="row" key={c.id}>
            <div>
              {c.name}
              <div className="muted">Billed {rs(c.billed_paise)} · Paid {rs(c.paid_paise)}</div>
            </div>
            <strong>{rs(Number(c.billed_paise) - Number(c.paid_paise))}</strong>
          </div>
        ))}
      </div>
    </>
  );
}