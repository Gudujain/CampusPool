import { useEffect, useState, useCallback } from 'react';
import { api, socket, PLACES, errMsg } from './api';

const fmt = (d) => new Date(d).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const names = Object.keys(PLACES);
const POLICY = 'Leaving or cancelling within 2 hours of departure counts as a late cancel, and not turning up counts as a no-show. Three strike points pauses booking for 7 days (a no-show counts double).';

function Auth({ onAuth }) {
  const [mode, setMode] = useState('login');
  const [f, setF] = useState({ name: '', email: '', phone: '', password: '', otp: '' });
  const [err, setErr] = useState(''); const [info, setInfo] = useState('');
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const submit = async (e) => {
    e.preventDefault(); setErr(''); setInfo('');
    try {
      if (mode === 'register') { await api.post('/auth/register', f); setMode('verify'); setInfo('We emailed you a 6-digit code.'); return; }
      const { data } = await api.post(mode === 'verify' ? '/auth/verify-otp' : '/auth/login', f);
      localStorage.setItem('token', data.token); localStorage.setItem('user', JSON.stringify(data.user)); onAuth(data.user);
    } catch (x) {
      if (x.response?.data?.needsVerification) { setMode('verify'); setInfo(x.response.data.message); } else setErr(errMsg(x));
    }
  };
  const resend = async () => { try { await api.post('/auth/resend-otp', { email: f.email }); setInfo('New code sent.'); } catch (x) { setErr(errMsg(x)); } };
  return (
    <main className="auth">
      <h1>CampusPool</h1>
      <p className="lede">Share the cab home. Split the fare. Verified college emails only.</p>
      <form onSubmit={submit} className="card">
        {mode === 'register' && <>
          <input placeholder="Full name" value={f.name} onChange={set('name')} required />
          <input placeholder="Phone (shown only to people in your ride)" value={f.phone} onChange={set('phone')} required />
        </>}
        <input type="email" placeholder="College email" value={f.email} onChange={set('email')} required />
        {mode !== 'verify' && <input type="password" placeholder="Password (8+ characters)" value={f.password} onChange={set('password')} required />}
        {mode === 'verify' && <input inputMode="numeric" maxLength={6} placeholder="6-digit code" value={f.otp} onChange={set('otp')} required />}
        {info && <p className="hint">{info}</p>}
        {err && <p className="err">{err}</p>}
        <button className="primary">{{ login: 'Log in', register: 'Send verification code', verify: 'Verify and continue' }[mode]}</button>
        {mode === 'verify' && <button type="button" className="link" onClick={resend}>Resend code</button>}
        {mode !== 'verify' && <button type="button" className="link" onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>
          {mode === 'login' ? 'New here? Create an account' : 'Have an account? Log in'}</button>}
      </form>
    </main>
  );
}

function OfferForm({ onDone }) {
  const [f, setF] = useState({ from: names[0], to: names[2], departure: '', seats: 3, totalCost: 600 });
  const [err, setErr] = useState('');
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const submit = async (e) => {
    e.preventDefault(); setErr('');
    try {
      await api.post('/rides', {
        origin: { label: f.from, location: { coordinates: PLACES[f.from] } },
        destination: { label: f.to, location: { coordinates: PLACES[f.to] } },
        departure: new Date(f.departure).toISOString(), seats: +f.seats, totalCost: +f.totalCost,
      });
      onDone();
    } catch (x) { setErr(errMsg(x)); }
  };
  const Sel = ({ k }) => <select value={f[k]} onChange={set(k)}>{names.map((n) => <option key={n}>{n}</option>)}</select>;
  return (
    <form onSubmit={submit} className="card grid">
      <h2>Offer a ride</h2>
      <label>From <Sel k="from" /></label>
      <label>To <Sel k="to" /></label>
      <label>Leaving at <input type="datetime-local" value={f.departure} onChange={set('departure')} required /></label>
      <label>Seats for others <input type="number" min="1" max="6" value={f.seats} onChange={set('seats')} /></label>
      <label>Total fare (₹) <input type="number" min="0" value={f.totalCost} onChange={set('totalCost')} /></label>
      <p className="hint">Everyone in the car pays an equal share, including you. After the ride, mark who showed up so reputations stay accurate.</p>
      {err && <p className="err">{err}</p>}
      <button className="primary">Post ride</button>
    </form>
  );
}

const Person = ({ p, role, onRemove }) => (
  <li className="person">
    <div>
      <b>{p.name}</b> <span className="role">{role}</span> {p.verified && <span className="ok">college email verified</span>}
      <div className="muted">
        {p.ridesCompleted} rides done · {p.rating ? `${p.rating}★ from ${p.ratingCount}` : 'no ratings yet'} · {p.noShows} no-shows · {p.lateCancels} late cancels
        {p.phone && <> · <a href={`tel:${p.phone}`}>{p.phone}</a></>}
      </div>
    </div>
    {onRemove && <button className="small" onClick={onRemove}>Remove</button>}
  </li>
);

function RideCard({ ride, act }) {
  const [absent, setAbsent] = useState([]);
  const member = ride.isDriver || ride.isPassenger;
  const left = new Date(ride.departure) > new Date();
  const join = () => { if (window.confirm(`Join this ride?\n\n${POLICY}`)) act('join', ride.id); };
  return (
    <article className="ride">
      <div className="top">
        <div>
          <h3>{ride.origin} → {ride.destination}</h3>
          <p>{fmt(ride.departure)} · {ride.seatsLeft} of {ride.seats} seats free{ride.completed && ' · completed'}</p>
        </div>
        <div className="side">
          <strong>₹{ride.perHead}</strong><span className="muted">per person</span>
          {ride.isDriver && left && <button onClick={() => act('delete', ride.id)}>Cancel ride</button>}
          {ride.isPassenger && left && <button onClick={() => act('leave', ride.id)}>Leave</button>}
          {!member && <button className="primary" disabled={!ride.seatsLeft} onClick={join}>{ride.seatsLeft ? 'Join' : 'Full'}</button>}
        </div>
      </div>
      <ul className="people">
        <Person p={ride.driver} role="driver" />
        {ride.passengers.map((p) => <Person key={p.id} p={p} role={p.status === 'no_show' ? 'no-show' : 'booked'}
          onRemove={ride.isDriver && left ? () => act('remove', ride.id, { userId: p.id }) : null} />)}
        {!ride.passengers.length && <li className="muted">No one has booked yet.</li>}
      </ul>
      {!member && <p className="hint">Phone numbers are shared only after you join.</p>}
      {ride.canComplete && (
        <div className="panel">
          <b>Ride finished? Tick anyone who did NOT show up.</b>
          {ride.passengers.map((p) => (
            <label key={p.id} className="row"><input type="checkbox" checked={absent.includes(p.id)}
              onChange={(e) => setAbsent(e.target.checked ? [...absent, p.id] : absent.filter((x) => x !== p.id))} /> {p.name}</label>
          ))}
          <button className="primary" onClick={() => act('complete', ride.id, { noShows: absent })}>Confirm attendance</button>
        </div>
      )}
      {ride.rateable.length > 0 && (
        <div className="panel">
          <b>Rate your co-riders</b>
          {ride.rateable.map((o) => (
            <div key={o.id} className="row">{o.name}
              {[1, 2, 3, 4, 5].map((s) => <button key={s} className="small" onClick={() => act('rate', ride.id, { to: o.id, stars: s })}>{s}★</button>)}
            </div>
          ))}
        </div>
      )}
    </article>
  );
}

export default function App() {
  const [user, setUser] = useState(() => JSON.parse(localStorage.getItem('user') || 'null'));
  const [tab, setTab] = useState('find');
  const [rides, setRides] = useState([]);
  const [q, setQ] = useState({ from: names[0], dest: '', time: '', radius: 5 });
  const [msg, setMsg] = useState('');

  const logout = () => { localStorage.clear(); setUser(null); };
  const load = useCallback(async () => {
    try {
      const params = tab === 'mine' ? null : { dest: q.dest || undefined, radius: q.radius, time: q.time ? new Date(q.time).toISOString() : undefined, lng: PLACES[q.from][0], lat: PLACES[q.from][1] };
      const { data } = await api.get(tab === 'mine' ? '/rides/mine' : '/rides', { params });
      setRides(data);
    } catch (x) { if (x.response?.status === 401) logout(); else setMsg(errMsg(x)); }
  }, [tab, q]);

  useEffect(() => { if (user && tab !== 'offer') load(); }, [user, tab, load]);

  // authenticated socket: the server only says "something changed", we re-fetch our own filtered view
  useEffect(() => {
    if (!user) return;
    socket.connect();
    socket.on('rides:changed', load);
    return () => { socket.off('rides:changed', load); socket.disconnect(); };
  }, [user, load]);

  const act = async (type, id, body) => {
    setMsg('');
    try {
      const url = `/rides/${id}`;
      let res;
      if (type === 'delete') res = await api.delete(url);
      else if (type === 'remove') res = await api.delete(`${url}/passengers/${body.userId}`);
      else res = await api.post(`${url}/${type}`, body);
      if (res.data?.lateCancel) setMsg('You left within 2 hours of departure, so a late-cancel strike was recorded.');
      load();
    } catch (x) { setMsg(errMsg(x)); }
  };

  if (!user) return <Auth onAuth={setUser} />;
  return (
    <div className="shell">
      <header>
        <h1>CampusPool</h1>
        <nav>
          {[['find', 'Find a ride'], ['offer', 'Offer a ride'], ['mine', 'My rides']].map(([k, l]) =>
            <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}
          <button className="link" onClick={logout}>Log out ({user.name.split(' ')[0]})</button>
        </nav>
      </header>
      {msg && <p className="err">{msg}</p>}
      {tab === 'offer' && <OfferForm onDone={() => setTab('mine')} />}
      {tab === 'find' && (
        <section className="card grid filters">
          <label>I'm leaving from <select value={q.from} onChange={(e) => setQ({ ...q, from: e.target.value })}>{names.map((n) => <option key={n}>{n}</option>)}</select></label>
          <label>Going to <select value={q.dest} onChange={(e) => setQ({ ...q, dest: e.target.value })}><option value="">Anywhere</option>{names.map((n) => <option key={n}>{n}</option>)}</select></label>
          <label>Around (±90 min) <input type="datetime-local" value={q.time} onChange={(e) => setQ({ ...q, time: e.target.value })} /></label>
          <label>Pick-up within (km) <input type="number" min="1" max="50" value={q.radius} onChange={(e) => setQ({ ...q, radius: e.target.value })} /></label>
          <p className="hint">{POLICY}</p>
        </section>
      )}
      {tab !== 'offer' && (
        <section className="list">
          {rides.length === 0 ? <p className="muted">{tab === 'find' ? 'No rides match yet. Widen the time or distance, or offer one yourself.' : 'You have no rides yet.'}</p>
            : rides.map((r) => <RideCard key={r.id} ride={r} act={act} />)}
        </section>
      )}
    </div>
  );
}
