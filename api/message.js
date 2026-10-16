import { put } from '@vercel/blob';

// POST /api/message — the message form (src/MessagePanel.jsx). Each message is saved as a private
// JSON file in the "slopes-messages" Vercel Blob store (BLOB_READ_WRITE_TOKEN), under
// messages/<topic>/<time>-<id>.json; browse them in the Vercel dashboard → Storage.

// Every field is required; which fields depends on the topic chosen.
const TOPICS = {
  idea: ['name', 'email', 'idea', 'importance'],
  issue: ['name', 'location', 'device', 'issue'],
};
const MAX_LENGTH = { name: 200, email: 320, location: 200, device: 200, idea: 5000, importance: 5000, issue: 5000 };
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const body = typeof req.body === 'string' ? safeParse(req.body) : req.body ?? {};
  // A hidden field people never see; bots that fill everything in get a quiet "ok".
  if (body.website) return res.status(200).json({ ok: true });

  const fieldNames = TOPICS[body.topic];
  if (!fieldNames) return res.status(400).json({ error: 'Unknown topic' });
  const fields = {};
  for (const name of fieldNames) {
    const value = typeof body.fields?.[name] === 'string' ? body.fields[name].trim() : '';
    if (!value) return res.status(400).json({ error: `Missing ${name}` });
    if (value.length > MAX_LENGTH[name]) return res.status(400).json({ error: `${name} is too long` });
    fields[name] = value;
  }
  if (fields.email && !EMAIL.test(fields.email)) return res.status(400).json({ error: 'Invalid email' });

  const receivedAt = new Date().toISOString();
  const message = {
    topic: body.topic,
    fields,
    receivedAt,
    userAgent: req.headers['user-agent'] ?? null,
    country: req.headers['x-vercel-ip-country'] ?? null,
    city: req.headers['x-vercel-ip-city'] ? decodeURIComponent(req.headers['x-vercel-ip-city']) : null,
  };
  try {
    await put(`messages/${body.topic}/${receivedAt.replace(/[:.]/g, '-')}.json`, JSON.stringify(message, null, 2), {
      access: 'private',
      contentType: 'application/json',
      addRandomSuffix: true,
    });
  } catch (err) {
    console.error('Saving message failed', err);
    return res.status(500).json({ error: 'Could not save your message' });
  }
  return res.status(200).json({ ok: true });
}

function safeParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}
