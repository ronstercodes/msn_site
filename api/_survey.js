'use strict';

// Shared by api/survey.js (saves answers) and api/survey-results.js (reads them).
// The questions live in survey/forms.json, which the survey pages also read,
// so what the server accepts always matches what the page shows.

const definitions = require('../survey/forms.json');

const PREFIX = 'survey-responses/';
const MAX_OTHER = 100;
const DEFAULT_MAX_TEXT = 1000;
// Random code the survey saves on a person's device so Before and After can be matched. Optional.
const PAIR_ID = /^[A-Za-z0-9-]{16,64}$/;

const has = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const isPlainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const isBlank = value => value === undefined || value === null || value === '';

// Keeps newlines and tabs, drops other control characters.
function cleanText(value, max) {
  if (typeof value !== 'string') return '';
  return value
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .trim()
    .slice(0, max);
}

// Result is { skip: true }, { invalid: true } or { value: '...' }.
function checkChoice(question, raw) {
  if (isBlank(raw)) return { skip: true };
  if (typeof raw !== 'string') return { invalid: true };
  if (question.options.includes(raw)) return { value: raw };
  if (question.other && (raw === 'Other' || raw.startsWith('Other:'))) {
    const detail = cleanText(raw.slice('Other:'.length), MAX_OTHER);
    return { value: detail ? `Other: ${detail}` : 'Other' };
  }
  return { invalid: true };
}

// Returns { spam: true }, { error: '...' } or { value: { form, branch, pairId?, answers } }.
function validate(body) {
  if (!isPlainObject(body)) return { error: 'Please fill in the survey and try again.' };

  // Hidden field that people never see. Bots that fill it in are dropped quietly.
  if (typeof body.website === 'string' && body.website.trim() !== '') return { spam: true };

  if (typeof body.form !== 'string' || !has(definitions.forms, body.form)) {
    return { error: 'We could not tell which survey this is.' };
  }
  const formId = body.form;
  const form = definitions.forms[formId];

  const given = body.answers;
  if (!isPlainObject(given)) return { error: 'Please fill in the survey and try again.' };

  const chosen = form.role.options.find(option => option.value === given.role);
  if (!chosen) return { error: 'Please tell us which one best describes you.' };

  const answers = { role: chosen.value };
  const questions = [...form.common, ...form.branches[chosen.branch].questions];

  for (const question of questions) {
    const raw = has(given, question.key) ? given[question.key] : undefined;

    if (question.type === 'choice' || question.type === 'select') {
      const result = checkChoice(question, raw);
      if (result.invalid) return { error: 'Please choose one of the listed answers.' };
      if (!result.skip) answers[question.key] = result.value;

    } else if (question.type === 'grid') {
      if (isBlank(raw)) continue;
      if (!isPlainObject(raw)) return { error: 'Please choose one of the listed answers.' };
      const rows = {};
      for (const row of question.rows) {
        const cell = has(raw, row.key) ? raw[row.key] : undefined;
        if (isBlank(cell)) continue;
        if (typeof cell !== 'string' || !definitions.scale.includes(cell)) {
          return { error: 'Please choose one of the listed answers.' };
        }
        rows[row.key] = cell;
      }
      if (Object.keys(rows).length) answers[question.key] = rows;

    } else if (question.type === 'text') {
      const text = cleanText(raw, question.maxLength || DEFAULT_MAX_TEXT);
      if (text) answers[question.key] = text;
    }
  }

  const pairId = typeof body.pairId === 'string' && PAIR_ID.test(body.pairId) ? body.pairId : undefined;
  return { value: { form: formId, branch: chosen.branch, ...(pairId ? { pairId } : {}), answers } };
}

module.exports = { PREFIX, definitions, cleanText, validate };
