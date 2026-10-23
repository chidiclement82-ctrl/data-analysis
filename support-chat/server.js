// Starts the secure chat. Settings come from environment variables; see README.md.
import { createRelay } from './src/relay.js';

const env = process.env;
const port = Number(env.PORT) || 8787;
const host = env.HOST || '127.0.0.1';

let teamKey = null;
if (env.TEAM_KEY) {
  try { teamKey = JSON.parse(env.TEAM_KEY); } catch { console.error('TEAM_KEY must be the JSON public key shown in the team inbox.'); process.exit(1); }
}

const { server, store } = createRelay({
  agentPassword: env.AGENT_PASSWORD,
  teamKey,
  brandName: env.BRAND_NAME,
  replyTime: env.REPLY_TIME,
  contactUrl: env.CONTACT_URL,
  contactLabel: env.CONTACT_LABEL,
  allowedOrigins: (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean),
  retentionDays: Number(env.RETENTION_DAYS) || 30,
  maxMessageBytes: Number(env.MAX_MESSAGE_BYTES) || undefined,
  trustProxy: env.TRUST_PROXY === '1' || Boolean(env.RENDER),
  dataDir: env.DATA_DIR || new URL('./data', import.meta.url).pathname,
});

if (!env.AGENT_PASSWORD) console.warn('AGENT_PASSWORD is not set: nobody can sign in to the team inbox.');

server.listen(port, host, () => {
  console.log(`Secure chat on http://${host}:${port}  (team inbox: /team, ${store.list().length} chats kept)`);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => server.close(() => process.exit(0)));
}
