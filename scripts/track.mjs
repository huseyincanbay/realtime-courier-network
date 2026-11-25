const API = process.env.API_URL ?? 'http://localhost:4000/api/v1';
const WS = process.env.WS_URL ?? 'ws://localhost:3004';
const OPEN = '0';
const PING = '2';
const PONG = '3';
const CONNECT = '40/ws,';
const CONNECT_ERROR = '44/ws,';
const EVENT = '42/ws,';

const [email, password] = process.argv.slice(2);
if (!email || !password) {
  console.error('usage: pnpm track <email> <password>');
  process.exit(1);
}
if (typeof WebSocket === 'undefined') {
  console.error('pnpm track needs Node 22 or newer');
  process.exit(1);
}

const login = await fetch(`${API}/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email, password }),
});
if (!login.ok) {
  console.error(`login failed (${login.status})`);
  process.exit(1);
}
const { accessToken } = await login.json();

const socket = new WebSocket(`${WS}/socket.io/?EIO=4&transport=websocket`);
const emit = (event, payload) => socket.send(EVENT + JSON.stringify([event, payload]));

socket.addEventListener('message', ({ data }) => {
  if (data === PING) return socket.send(PONG);
  if (data.startsWith(OPEN)) return socket.send(CONNECT + JSON.stringify({ token: accessToken }));
  if (data.startsWith(CONNECT_ERROR)) {
    console.error('refused:', JSON.parse(data.slice(CONNECT_ERROR.length)).message);
    process.exit(1);
  }
  if (!data.startsWith(EVENT)) return;
  const [event, payload] = JSON.parse(data.slice(EVENT.length));
  console.log(new Date().toTimeString().slice(0, 8), event, JSON.stringify(payload));
  if (event === 'order:created') emit('subscribe:order', { orderId: payload.orderId });
});
socket.addEventListener('close', () => {
  console.log('disconnected');
  process.exit(0);
});
socket.addEventListener('error', () => {
  console.error(`cannot reach ${WS}`);
  process.exit(1);
});
