/* Matches each person's Before and After answers using the random code the survey
   saved on their device, and prepares paired summaries and a paired CSV.
   Used by the results page (as window.MSNPairing) and by the tests (via require).

   It never guesses. If one code was used by several people (a shared phone), it only
   pairs the ones whose grade is unique on both sides, and leaves the rest out. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MSNPairing = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const BRANCHES = ['attendee', 'volunteer'];
  const BRANCH_SHORT = { attendee: 'Attendee', volunteer: 'Booth host' };

  // "5" and "5th Grade" are the same grade; the two surveys word it differently.
  const gradeNumber = value => {
    if (typeof value !== 'string') return null;
    if (value === 'Pre-K') return -1;
    if (value === 'K') return 0;
    if (value === 'College') return 13;
    if (value === 'Graduated') return 14;
    const match = value.match(/^(\d+)/);
    return match ? Number(match[1]) : null;
  };

  const mean = list => (list.length ? list.reduce((sum, n) => sum + n, 0) / list.length : null);

  // Sample standard deviation; needs at least two values.
  const sd = list => {
    if (list.length < 2) return null;
    const m = mean(list);
    return Math.sqrt(list.reduce((sum, n) => sum + (n - m) ** 2, 0) / (list.length - 1));
  };

  /* ---------- matching ---------- */

  function pairResponses(responses) {
    const stats = { before: 0, after: 0, withCode: 0, noCode: 0, pairs: 0, ambiguous: 0, waiting: 0 };
    const groups = new Map();

    for (const item of responses) {
      if (item.form !== 'before' && item.form !== 'after') continue;
      stats[item.form] += 1;
      if (typeof item.pairId !== 'string' || item.pairId === '') { stats.noCode += 1; continue; }
      stats.withCode += 1;
      const key = `${item.pairId}|${item.branch}`;
      let group = groups.get(key);
      if (!group) { group = { before: [], after: [] }; groups.set(key, group); }
      group[item.form].push(item);
    }

    const pairs = [];
    for (const { before, after } of groups.values()) {
      if (!before.length || !after.length) { stats.waiting += before.length + after.length; continue; }
      if (before.length === 1 && after.length === 1) { pairs.push({ before: before[0], after: after[0] }); continue; }

      // Several people used this code (a shared phone): pair only where grade tells them apart.
      const byGrade = new Map();
      for (const item of [...before, ...after]) {
        const grade = gradeNumber((item.answers || {}).grade);
        if (grade === null) { stats.ambiguous += 1; continue; }
        let sub = byGrade.get(grade);
        if (!sub) { sub = { before: [], after: [] }; byGrade.set(grade, sub); }
        sub[item.form].push(item);
      }
      for (const sub of byGrade.values()) {
        if (sub.before.length === 1 && sub.after.length === 1) pairs.push({ before: sub.before[0], after: sub.after[0] });
        else if (!sub.before.length || !sub.after.length) stats.waiting += sub.before.length + sub.after.length;
        else stats.ambiguous += sub.before.length + sub.after.length;
      }
    }

    pairs.sort((a, b) => (a.before.submittedAt < b.before.submittedAt ? -1 : 1));
    stats.pairs = pairs.length;
    return { pairs, stats };
  }

  /* ---------- summaries ---------- */

  const levelOf = (scale, answers, questionKey, rowKey) => {
    const cell = ((answers || {})[questionKey] || {})[rowKey];
    const index = scale.indexOf(cell);
    return index === -1 ? null : index + 1;
  };

  // Rating questions that both surveys ask of this group, so a before/after change can be measured.
  const sharedGrids = (definitions, branch) => {
    const before = definitions.forms.before.branches[branch].questions;
    const after = definitions.forms.after.branches[branch].questions;
    return before
      .filter(question => question.type === 'grid')
      .filter(question => after.some(other => other.key === question.key && other.type === 'grid'));
  };

  function summarisePairs(pairs, definitions) {
    const scale = definitions.scale;
    return BRANCHES.map(branch => {
      const group = pairs.filter(pair => pair.before.branch === branch);
      const rows = [];
      for (const question of sharedGrids(definitions, branch)) {
        for (const row of question.rows) {
          const before = [];
          const after = [];
          const change = [];
          for (const pair of group) {
            const b = levelOf(scale, pair.before.answers, question.key, row.key);
            const a = levelOf(scale, pair.after.answers, question.key, row.key);
            if (b === null || a === null) continue;
            before.push(b);
            after.push(a);
            change.push(a - b);
          }
          rows.push({
            question: question.question,
            statement: row.text,
            n: change.length,
            meanBefore: mean(before),
            meanAfter: mean(after),
            meanChange: mean(change),
            sdChange: sd(change),
          });
        }
      }
      return { branch, label: BRANCH_SHORT[branch], pairs: group.length, rows };
    });
  }

  /* ---------- paired spreadsheet ---------- */

  // One row per matched pair. The random code itself is left out; pairs just get a number.
  function buildPairedTable(pairs, definitions) {
    const scale = definitions.scale;
    const columns = [
      { header: 'Pair #', get: (pair, index) => index + 1 },
      { header: 'Group', get: pair => BRANCH_SHORT[pair.before.branch] || pair.before.branch },
      { header: 'Role (before)', get: pair => pair.before.answers.role },
      { header: 'Role (after)', get: pair => pair.after.answers.role },
      { header: 'Grade (before)', get: pair => pair.before.answers.grade },
      { header: 'Grade (after)', get: pair => pair.after.answers.grade },
      { header: 'Before submitted (UTC)', get: pair => pair.before.submittedAt },
      { header: 'After submitted (UTC)', get: pair => pair.after.submittedAt },
    ];

    for (const branch of BRANCHES) {
      const beforeQuestions = definitions.forms.before.branches[branch].questions.filter(q => q.key !== 'grade');
      const afterQuestions = definitions.forms.after.branches[branch].questions.filter(q => q.key !== 'grade');
      const keys = [...new Set([...beforeQuestions.map(q => q.key), ...afterQuestions.map(q => q.key)])];
      const inBranch = pair => pair.before.branch === branch;

      for (const key of keys) {
        const b = beforeQuestions.find(q => q.key === key);
        const a = afterQuestions.find(q => q.key === key);
        const question = b || a;
        const prefix = `${BRANCH_SHORT[branch]}: ${question.question}`;

        if (question.type === 'grid') {
          for (const row of question.rows) {
            const level = (item, pair) => (inBranch(pair) ? levelOf(scale, item.answers, key, row.key) : null);
            const text = `${prefix} — ${row.text}`;
            if (b) columns.push({ header: `${text} — Before (1–5)`, get: pair => level(pair.before, pair) ?? '' });
            if (a) columns.push({ header: `${text} — After (1–5)`, get: pair => level(pair.after, pair) ?? '' });
            if (a && b) {
              columns.push({
                header: `${text} — Change (After − Before)`,
                get: pair => {
                  const x = level(pair.before, pair);
                  const y = level(pair.after, pair);
                  return x === null || y === null ? '' : y - x;
                },
              });
            }
          }
        } else {
          const value = (item, pair) => (inBranch(pair) ? (item.answers || {})[key] : '');
          if (b) columns.push({ header: `${prefix} — Before`, get: pair => value(pair.before, pair) ?? '' });
          if (a) columns.push({ header: `${prefix} — After`, get: pair => value(pair.after, pair) ?? '' });
        }
      }
    }

    return {
      header: columns.map(column => column.header),
      rows: pairs.map((pair, index) => columns.map(column => column.get(pair, index))),
    };
  }

  // A leading = + - @ would be run as a formula by Excel or Sheets, so defuse it.
  // Real numbers (like a change of -1) are left alone; only typed-in text is defused.
  const csvCell = value => {
    let text = value === undefined || value === null ? '' : String(value);
    if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  };

  const toCsv = table =>
    [table.header, ...table.rows].map(line => line.map(csvCell).join(',')).join('\r\n');

  return { gradeNumber, mean, sd, pairResponses, summarisePairs, buildPairedTable, csvCell, toCsv };
});
