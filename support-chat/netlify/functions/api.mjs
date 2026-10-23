// Netlify: the chat API (see ../../src/serverless.js). Chats live in Netlify Blobs.
import { getStore } from '@netlify/blobs';
import { createServerlessApi } from '../../src/serverless.js';

let api = null;

export default async (req, context) => {
  api ||= createServerlessApi({
    store: getStore({ name: 'secure-chat', consistency: 'strong' }),
    env: Netlify.env.toObject(),
  });
  return api.fetch(req, context.ip);
};

export const config = { path: ['/api/*', '/config.json', '/healthz'] };
