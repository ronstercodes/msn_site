/* Survey results: asks the server for the responses (needs the results key),
   summarises one survey at a time, and offers a CSV download.
   Everything people typed goes in with textContent, never as HTML. */
(() => {
  'use strict';

  const keyForm = document.getElementById('results-key-form');
  if (!keyForm) return;

  const keyInput = document.getElementById('results-key');
  const status = document.getElementById('results-status');
  const panel = document.getElementById('results');
  const picker = document.getElementById('results-form');
  const statsBox = document.getElementById('stats');
  const summary = document.getElementById('summary');
  const loadButton = keyForm.querySelector('button[type="submit"]');

  let definitions = null;
  let responses = [];

  const say = (message, isError) => {
    status.textContent = message;
    status.classList.toggle('error', Boolean(isError));
  };

  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  const BRANCH_SHORT = { attendee: 'Attendee', volunteer: 'Volunteer' };

  /* ---------- reading the answers ---------- */

  const answerOf = (item, question) => (item.answers || {})[question.key];
  const cellOf = (item, question, row) => {
    const value = answerOf(item, question);
    return value && typeof value === 'object' ? value[row.key] : undefined;
  };

  /* ---------- summaries ---------- */

  const drawBars = (labels, counts) => {
    const box = el('div', 'bars');
    const top = Math.max(1, ...labels.map(label => counts.get(label) || 0));
    for (const label of labels) {
      const count = counts.get(label) || 0;
      const row = el('div', 'bar-row');
      row.append(el('span', 'bar-label', label));
      const track = el('span', 'bar-track');
      const fill = el('span', 'bar-fill');
      fill.style.width = `${(count / top) * 100}%`;
      track.append(fill);
      row.append(track, el('span', 'bar-count', String(count)));
      box.append(row);
    }
    return box;
  };

  const summariseChoice = (question, items, ordered) => {
    const counts = new Map();
    for (const item of items) {
      const value = answerOf(item, question);
      if (typeof value === 'string' && value !== '') counts.set(value, (counts.get(value) || 0) + 1);
    }
    const known = ordered || question.options;
    const extras = [...counts.keys()].filter(value => !known.includes(value))
      .sort((a, b) => counts.get(b) - counts.get(a));
    return drawBars([...known, ...extras], counts);
  };

  const summariseGrid = (question, items, scale) => {
    const wrap = el('div', 'table-wrap');
    const table = el('table', 'results-table');
    const head = el('tr');
    head.append(el('th', '', 'Statement'));
    for (const level of scale) head.append(el('th', '', level));
    head.append(el('th', '', 'Average (1–5)'), el('th', '', 'Answered'));
    table.append(head);
    for (const row of question.rows) {
      const counts = scale.map(() => 0);
      let total = 0;
      let sum = 0;
      for (const item of items) {
        const index = scale.indexOf(cellOf(item, question, row));
        if (index === -1) continue;
        counts[index] += 1;
        total += 1;
        sum += index + 1;
      }
      const line = el('tr');
      line.append(el('td', '', row.text));
      for (const count of counts) line.append(el('td', '', String(count)));
      line.append(el('td', 'mean', total ? (sum / total).toFixed(2) : '–'), el('td', '', String(total)));
      table.append(line);
    }
    wrap.append(table);
    return wrap;
  };

  const summariseText = (question, items) => {
    const list = el('ul', 'comment-list');
    for (const item of items) {
      const value = answerOf(item, question);
      if (typeof value === 'string' && value !== '') list.append(el('li', 'comment', value));
    }
    if (!list.children.length) list.append(el('li', 'quiet', 'No answers yet.'));
    return list;
  };

  const summarise = (question, items) => {
    const block = el('div', 'results-question');
    block.append(el('h4', 'results-sub', question.question));
    if (question.type === 'grid') block.append(summariseGrid(question, items, definitions.scale));
    else if (question.type === 'text') block.append(summariseText(question, items));
    else block.append(summariseChoice(question, items));
    return block;
  };

  const render = () => {
    const formId = picker.value;
    const form = definitions.forms[formId];
    const items = responses.filter(item => item.form === formId);
    const inBranch = branch => items.filter(item => item.branch === branch);

    statsBox.replaceChildren();
    const stat = (number, label) => {
      const box = el('div');
      box.append(el('span', 'stat-num', String(number)), el('span', 'stat-label', label));
      statsBox.append(box);
    };
    stat(items.length, 'responses');
    for (const branch of Object.keys(form.branches)) {
      stat(inBranch(branch).length, `${form.branches[branch].title.replace(' Survey', '').toLowerCase()}s`);
    }

    summary.replaceChildren();
    if (!items.length) {
      summary.append(el('p', 'quiet', 'No responses to this survey yet.'));
      return;
    }

    summary.append(el('h2', 'results-h', 'Everyone'));
    summary.append(summarise({ ...form.role, type: 'choice', options: form.role.options.map(option => option.value) }, items));
    for (const question of form.common) summary.append(summarise(question, items));

    for (const [branch, section] of Object.entries(form.branches)) {
      const group = inBranch(branch);
      summary.append(el('h2', 'results-h', `${section.title} (${group.length})`));
      if (!group.length) {
        summary.append(el('p', 'quiet', 'No responses yet.'));
        continue;
      }
      for (const question of section.questions) summary.append(summarise(question, group));
    }
  };

  /* ---------- CSV ---------- */

  // A leading = + - @ would be run as a formula by Excel or Sheets, so defuse it.
  const csvCell = value => {
    let text = value === undefined || value === null ? '' : String(value);
    if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  };

  const downloadCsv = () => {
    const formId = picker.value;
    const form = definitions.forms[formId];
    const items = responses.filter(item => item.form === formId);

    const columns = [
      { header: 'Submitted at (UTC)', get: item => item.submittedAt },
      { header: 'Group', get: item => item.branch },
      { header: form.role.question.trim(), get: item => (item.answers || {}).role },
    ];
    for (const question of form.common) {
      columns.push({ header: question.question, get: item => answerOf(item, question) });
    }
    for (const [branch, section] of Object.entries(form.branches)) {
      for (const question of section.questions) {
        const prefix = `${BRANCH_SHORT[branch] || branch}: ${question.question}`;
        if (question.type === 'grid') {
          for (const row of question.rows) {
            columns.push({ header: `${prefix} — ${row.text}`, get: item => cellOf(item, question, row) });
          }
        } else {
          columns.push({ header: prefix, get: item => answerOf(item, question) });
        }
      }
    }

    const lines = [columns.map(column => csvCell(column.header)).join(',')];
    for (const item of items) lines.push(columns.map(column => csvCell(column.get(item))).join(','));

    const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `msn-survey-${formId}-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  };

  document.getElementById('download-csv').addEventListener('click', downloadCsv);
  picker.addEventListener('change', render);

  /* ---------- loading ---------- */

  keyForm.addEventListener('submit', async event => {
    event.preventDefault();
    loadButton.disabled = true;
    say('Loading…', false);
    try {
      const [formsResponse, dataResponse] = await Promise.all([
        fetch('/survey/forms.json', { cache: 'no-cache' }),
        fetch('/api/survey-results', {
          headers: { Authorization: `Bearer ${keyInput.value}` },
          cache: 'no-store',
        }),
      ]);
      const data = await dataResponse.json().catch(() => ({}));
      if (!dataResponse.ok) throw new Error(data.error || 'Something went wrong.');
      if (!formsResponse.ok) throw new Error('Could not load the survey questions.');
      definitions = await formsResponse.json();
      responses = Array.isArray(data.responses) ? data.responses : [];

      const previous = picker.value;
      picker.replaceChildren();
      for (const [id, form] of Object.entries(definitions.forms)) {
        const count = responses.filter(item => item.form === id).length;
        const option = el('option', '', `${form.label} (${count})`);
        option.value = id;
        picker.append(option);
      }
      if (previous && definitions.forms[previous]) picker.value = previous;

      render();
      panel.hidden = false;
      say(`Updated ${new Date().toLocaleTimeString()}. Press the button again to refresh.`, false);
    } catch (error) {
      panel.hidden = true;
      say(error instanceof TypeError ? 'We could not reach the server.' : error.message, true);
    } finally {
      loadButton.disabled = false;
    }
  });
})();
