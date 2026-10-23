// Netlify: every night, delete chats nobody has touched for RETENTION_DAYS.
import { getStore } from '@netlify/blobs';
import { createServerlessApi } from '../../src/serverless.js';

export default async () => {
  const api = createServerlessApi({
    store: getStore({ name: 'secure-chat', consistency: 'strong' }),
    env: Netlify.env.toObject(),
  });
  console.log(`Deleted ${await api.prune()} old chats.`);
};

export const config = { schedule: '17 2 * * *' }; // 02:17 UTC daily
