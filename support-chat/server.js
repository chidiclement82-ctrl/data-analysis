// Starts the support chat relay. Settings come from environment variables;
// see README.md.
import { createRelay } from './src/relay.js';

const env = process.env;
const port = Number(env.PORT) || 8787;
const host = env.HOST || '127.0.0.1';

const { server, store } = createRelay({
  agentPassword: env.AGENT_PASSWORD,
  agentKeyId: env.AGENT_KEY_ID,
  allowedOrigins: (env.ALLOWED_ORIGINS || 'https://ogarider.name.ng,localhost').split(',').map((s) => s.trim()).filter(Boolean),
  retentionDays: Number(env.RETENTION_DAYS) || 30,
  maxMessageBytes: Number(env.MAX_MESSAGE_BYTES) || undefined,
  trustProxy: env.TRUST_PROXY === '1' || Boolean(env.RENDER),
  dataDir: env.DATA_DIR || new URL('./data', import.meta.url).pathname,
});

if (!env.AGENT_PASSWORD) console.warn('AGENT_PASSWORD is not set: customers can write, but the team cannot sign in.');

server.listen(port, host, () => {
  console.log(`Support chat relay on http://${host}:${port} (${store.list().length} chats kept)`);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => server.close(() => process.exit(0)));
}
