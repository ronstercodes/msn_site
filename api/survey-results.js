'use strict';

const { createHash, timingSafeEqual } = require('node:crypto');
const { list, get } = require('@vercel/blob');
const { PREFIX } = require('./_survey.js');

const MAX_RESPONSES = 5000;
const BATCH = 10;

function keyMatches(given, expected) {
  const a = createHash('sha256').update(given).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

async function readRecord(pathname) {
  const file = await get(pathname, { access: 'private', useCache: false });
  if (!file || file.statusCode !== 200) return null;
  try {
    return JSON.parse(await new Response(file.stream).text());
  } catch (_) {
    return null;
  }
}

// GET /api/survey-results — returns every saved response, newest first.
// Needs the header "Authorization: Bearer <SURVEY_ADMIN_KEY>".
module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  const expected = process.env.SURVEY_ADMIN_KEY;
  if (!expected) {
    return res.status(503).json({ error: 'Results are not switched on yet.' });
  }

  const header = req.headers.authorization || '';
  const given = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!given || !keyMatches(given, expected)) {
    return res.status(401).json({ error: 'Wrong key.' });
  }

  try {
    const paths = [];
    let cursor;
    do {
      const page = await list({ prefix: PREFIX, limit: 1000, cursor });
      for (const blob of page.blobs) paths.push(blob.pathname);
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor && paths.length < MAX_RESPONSES);

    const responses = [];
    const wanted = paths.slice(0, MAX_RESPONSES);
    for (let i = 0; i < wanted.length; i += BATCH) {
      const batch = await Promise.all(wanted.slice(i, i + BATCH).map(readRecord));
      for (const record of batch) if (record) responses.push(record);
    }

    responses.sort((a, b) => (a.submittedAt < b.submittedAt ? 1 : -1));
    return res.status(200).json({ count: responses.length, responses });
  } catch (err) {
    console.error('survey: could not read responses:', err && err.name);
    return res.status(500).json({ error: 'Could not load the responses.' });
  }
};
