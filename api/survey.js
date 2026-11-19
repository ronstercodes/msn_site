'use strict';

const { randomUUID } = require('node:crypto');
const { put } = require('@vercel/blob');
const { PREFIX, validate } = require('./_survey.js');

// POST /api/survey — saves one anonymous response as a private JSON file in
// the Blob store. Request bodies are never logged.
module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  // Only accept submissions sent from the site itself.
  const origin = req.headers.origin;
  if (origin) {
    let sameSite = false;
    try {
      sameSite = new URL(origin).host === req.headers.host;
    } catch (_) {
      sameSite = false;
    }
    if (!sameSite) return res.status(403).json({ error: 'Forbidden.' });
  }

  const body = req.body;
  if (!body || typeof body !== 'object' || JSON.stringify(body).length > 20000) {
    return res.status(400).json({ error: 'Please fill in the survey and try again.' });
  }

  const result = validate(body);
  if (result.spam) return res.status(201).json({ ok: true });
  if (result.error) return res.status(400).json({ error: result.error });

  const id = randomUUID();
  const now = Date.now();
  const submittedAt = new Date(now).toISOString();
  // Start = server time of receipt minus the time the person reported spending. Using elapsed
  // time (not the phone's clock) means a wrong phone clock cannot skew it.
  const { durationSeconds } = result.value;
  const startedAt = durationSeconds === undefined ? undefined : new Date(now - durationSeconds * 1000).toISOString();
  const record = { id, submittedAt, ...(startedAt ? { startedAt } : {}), ...result.value };

  try {
    await put(`${PREFIX}${record.form}/${submittedAt.slice(0, 10)}/${id}.json`, JSON.stringify(record), {
      access: 'private',
      contentType: 'application/json',
      addRandomSuffix: false,
    });
  } catch (err) {
    console.error('survey: could not save a response:', err && err.name);
    return res.status(500).json({ error: 'We could not save your answers.' });
  }

  return res.status(201).json({ ok: true });
};
