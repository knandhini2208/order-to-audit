import { useEffect, useState } from 'react';
import { api, setToken } from './api.js';
import AdminOrders from './Admin.jsx';
import ProductionScreen from './Production.jsx';

// Display only: paise string to rupees text
const rs = (p) => {
  const n = Number(p);
  return `₹${Math.floor(n / 100)}.${String(n % 100).padStart(2, '0')}`;
};

function Login({ onLogin }) {
  const [username, setUsername] = useState('salesman_a');
  const [password, setPassword] = useState('Demo@123');   // demo logins only
  const [error, setError] = useState('');

  async function submit(e) {
    e.preventDefault();
    try {
      const r = await api('/login', { method: 'POST', body: { username, password } });
      setToken(r.token);
      onLogin(r.user);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="card">
      <h1>Order-to-Audit</h1>
      <p className="muted">Sign in to continue</p>
      <form onSubmit={submit}>
        <label>Username</label>
        <input value={username} onChange={(e) => setUsername(e.target.value)} autoCapitalize="none" />
        <label>Password</label>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        <button type="submit">Sign in</button>
        {error && <div className="err">{error}</div>}
      </form>
    </div>
  );
}

function SalesmanOrders() {
  const [customers, setCustomers] = useState([]);
  const [products, setProducts] = useState([]);
  const [orders, setOrders] = useState([]);
  const [customerId, setCustomerId] = useState('');
  const [qty, setQty] = useState({});
  const [msg, setMsg] = useState({ text: '', ok: true });
  const [busy, setBusy] = useState(false);

  const loadOrders = () => api('/orders').then(setOrders);

  useEffect(() => {
    api('/customers').then(setCustomers);
    api('/products').then(setProducts);
    loadOrders();
  }, []);

  const count = (p) => parseInt(qty[p.code], 10) || 0;
  const lines = products.filter((p) => count(p) > 0).map((p) => ({ itemCode: p.code, qty: count(p) }));
  const total = products.reduce((s, p) => s + count(p) * Number(p.selling_price_paise), 0);

  async function submit() {
    setMsg({ text: '', ok: true });
    setBusy(true);
    try {
      const r = await api('/orders', {
        method: 'POST',
        body: { customerId: Number(customerId), lines },
      });
      setMsg({ text: `Order #${r.orderId} submitted`, ok: true });
      setQty({});
      await loadOrders();
    } catch (err) {
      setMsg({ text: err.message, ok: false });
    }
    setBusy(false);
  }

  return (
    <>
      <div className="card">
        <h2>New order</h2>
        <label>Customer</label>
        <select value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
          <option value="">Choose customer…</option>
          {customers.map((c) => (
            <option key={c.id} value={c.id}>{c.name} ({c.customer_type.toLowerCase()})</option>
          ))}
        </select>

        <label>Products</label>
        {products.map((p) => (
          <div className="row" key={p.code}>
            <div>
              <div>{p.name}</div>
              <div className="muted">{rs(p.selling_price_paise)} per packet</div>
            </div>
            <input
              className="qty" type="number" inputMode="numeric" min="0" step="1" placeholder="0"
              value={qty[p.code] ?? ''}
              onChange={(e) => setQty({ ...qty, [p.code]: e.target.value })}
            />
          </div>
        ))}

        <div className="row"><strong>Total before tax</strong><strong>{rs(total)}</strong></div>
        <button disabled={busy || !customerId || lines.length === 0} onClick={submit}>
          Submit order
        </button>
        {msg.text && <div className={msg.ok ? 'ok' : 'err'}>{msg.text}</div>}
      </div>

      <div className="card">
        <h2>My orders</h2>
        {orders.length === 0 && <div className="muted">No orders yet</div>}
        {orders.map((o) => (
          <div className="row" key={o.id}>
            <div>
              <div>#{o.id} · {o.customer}</div>
              <div className="muted">{o.packets} packets</div>
            </div>
            <span className={`badge ${o.status}`}>{o.status}</span>
          </div>
        ))}
      </div>
    </>
  );
}

export default function App() {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    api('/me').then(setUser).catch(() => setToken(null)).finally(() => setReady(true));
  }, []);

  function logout() {
    setToken(null);
    setUser(null);
  }

  if (!ready) return null;
  if (!user) return <div className="app"><Login onLogin={setUser} /></div>;

  return (
    <div className={user.role === 'SALESMAN' ? 'app' : 'app wide'}>
      <div className="top">
        <div>
          <strong>{user.name}</strong>
          <div className="muted">{user.role}</div>
        </div>
        <button className="link" onClick={logout}>Sign out</button>
      </div>
            {user.role === 'SALESMAN' ? <SalesmanOrders />
        : user.role === 'ADMIN' ? <AdminOrders />
        : user.role === 'PRODUCTION' ? <ProductionScreen />
        : <div className="card">The {user.role.toLowerCase()} screens are built in a later step.</div>}
    </div>
  );
}