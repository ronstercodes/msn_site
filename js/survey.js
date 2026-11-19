/* Survey pages: build the questions from /survey/forms.json, show the section that
   matches the respondent's role, send the answers to /api/survey, show the thank-you.
   Everything goes into the page with textContent, never as HTML. */
(() => {
  'use strict';

  const root = document.getElementById('survey-root');
  if (!root) return;

  const formId = root.dataset.survey;
  const thanks = document.getElementById('survey-thanks');
  let definitions = null;
  let form = null;          // the <form> element once built
  let current = null;       // this survey's definition
  let activeBranch = null;  // 'attendee' | 'volunteer' | null

  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  /* ---------- question builders ---------- */

  const radioLabel = (name, value, text, required) => {
    const label = el('label', 'choice');
    const input = el('input');
    input.type = 'radio';
    input.name = name;
    input.value = value;
    if (required) input.required = true;
    label.append(input, el('span', '', text));
    return { label, input };
  };

  const buildChoice = question => {
    const set = el('fieldset');
    set.append(el('legend', '', question.question));
    const list = el('div', 'choices');
    for (const option of question.options) list.append(radioLabel(question.key, option, option).label);
    if (question.other) {
      const { label } = radioLabel(question.key, 'Other', 'Other:');
      const detail = el('input', 'other-text');
      detail.type = 'text';
      detail.name = `${question.key}__other`;
      detail.maxLength = 100;
      detail.autocomplete = 'off';
      detail.setAttribute('aria-label', `${question.question} Other, please specify`);
      // Typing in the box means they meant "Other".
      detail.addEventListener('input', () => { label.querySelector('input').checked = true; });
      label.append(detail);
      list.append(label);
    }
    set.append(list);
    return set;
  };

  const buildSelect = question => {
    const wrap = el('div', 'field');
    const label = el('label', 'q-label', question.question);
    label.htmlFor = `f-${question.key}`;
    const select = el('select');
    select.id = `f-${question.key}`;
    select.name = question.key;
    const blank = el('option', '', 'Choose one');
    blank.value = '';
    select.append(blank);
    for (const option of question.options) {
      const item = el('option', '', option);
      item.value = option;
      select.append(item);
    }
    wrap.append(label, select);
    return wrap;
  };

  const buildGrid = question => {
    const set = el('fieldset');
    set.append(el('legend', '', question.question));
    const rows = el('div', 'likert-rows');
    for (const row of question.rows) {
      const line = el('fieldset', 'likert-row');
      line.append(el('legend', 'likert-q', row.text));
      const options = el('div', 'likert-options');
      definitions.scale.forEach(level => {
        const chip = el('label', 'chip');
        const input = el('input');
        input.type = 'radio';
        input.name = `${question.key}__${row.key}`;
        input.value = level;
        chip.append(input, el('span', '', level));
        options.append(chip);
      });
      line.append(options);
      rows.append(line);
    }
    set.append(rows);
    return set;
  };

  const buildText = question => {
    const wrap = el('div', 'field');
    const label = el('label', 'q-label', question.question);
    label.htmlFor = `f-${question.key}`;
    const area = el('textarea');
    area.id = `f-${question.key}`;
    area.name = question.key;
    area.rows = 4;
    area.maxLength = question.maxLength || 1000;
    wrap.append(label, area);
    return wrap;
  };

  const build = question => ({
    choice: buildChoice,
    select: buildSelect,
    grid: buildGrid,
    text: buildText,
  }[question.type](question));

  /* ---------- the form ---------- */

  const checked = name => form.querySelector(`input[name="${CSS.escape(name)}"]:checked`);

  const questionsFor = branch =>
    [...current.common, ...(branch ? current.branches[branch].questions : [])];

  const collect = () => {
    const answers = { role: checked('role').value };
    for (const question of questionsFor(activeBranch)) {
      if (question.type === 'choice') {
        const picked = checked(question.key);
        if (!picked) continue;
        if (picked.value === 'Other') {
          const detail = form.elements[`${question.key}__other`];
          const text = detail ? detail.value.trim() : '';
          answers[question.key] = text ? `Other: ${text}` : 'Other';
        } else {
          answers[question.key] = picked.value;
        }
      } else if (question.type === 'select' || question.type === 'text') {
        const value = form.elements[question.key].value.trim();
        if (value) answers[question.key] = value;
      } else if (question.type === 'grid') {
        const rows = {};
        for (const row of question.rows) {
          const picked = checked(`${question.key}__${row.key}`);
          if (picked) rows[row.key] = picked.value;
        }
        if (Object.keys(rows).length) answers[question.key] = rows;
      }
    }
    return answers;
  };

  const showBranch = branch => {
    const holder = form.querySelector('.survey-branch');
    holder.replaceChildren();
    activeBranch = branch;
    if (!branch) return;
    const section = el('section', 'survey-section');
    section.append(el('h2', '', current.branches[branch].title));
    section.append(el('p', 'survey-section-intro', current.branches[branch].intro));
    for (const question of current.branches[branch].questions) section.append(build(question));
    holder.append(section);
  };

  const buildForm = () => {
    form = el('form', 'survey');
    form.id = 'survey-form';
    form.noValidate = true;

    const intro = el('div', 'survey-intro');
    for (const paragraph of current.intro) intro.append(el('p', '', paragraph));
    form.append(intro);

    const roleSet = el('fieldset');
    roleSet.append(el('legend', '', current.role.question));
    const roles = el('div', 'choices');
    for (const option of current.role.options) {
      const { label, input } = radioLabel('role', option.value, option.value, true);
      input.dataset.branch = option.branch;
      roles.append(label);
    }
    roleSet.append(roles);
    form.append(roleSet);

    for (const question of current.common) form.append(build(question));
    form.append(el('div', 'survey-branch'));

    const trap = el('div', 'hp');
    trap.setAttribute('aria-hidden', 'true');
    const trapLabel = el('label', '', 'Leave this empty ');
    const trapInput = el('input');
    trapInput.type = 'text';
    trapInput.name = 'website';
    trapInput.tabIndex = -1;
    trapInput.autocomplete = 'off';
    trapLabel.append(trapInput);
    trap.append(trapLabel);
    form.append(trap);

    const actions = el('div', 'survey-actions');
    actions.hidden = true;
    const submit = el('button', 'btn', 'Send my answers');
    submit.type = 'submit';
    const status = el('p', 'survey-status');
    status.id = 'survey-status';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    actions.append(submit, status);
    form.append(actions);

    // Picking a role shows the questions for that group.
    roleSet.addEventListener('change', event => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement) || target.name !== 'role') return;
      if (target.dataset.branch !== activeBranch) showBranch(target.dataset.branch);
      actions.hidden = false;
    });

    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (!form.reportValidity()) return;

      submit.disabled = true;
      status.textContent = 'Sending…';
      status.classList.remove('error');

      try {
        const response = await fetch('/api/survey', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            form: formId,
            answers: collect(),
            website: form.elements.website.value,
          }),
        });
        if (!response.ok) {
          let problem = '';
          try { problem = (await response.json()).error || ''; } catch (_) { /* not JSON */ }
          throw new Error(problem || 'Something went wrong.');
        }
        form.hidden = true;
        thanks.hidden = false;
        thanks.querySelector('h2').focus();
        thanks.scrollIntoView({ block: 'start' });
      } catch (error) {
        const offline = error instanceof TypeError;
        status.textContent = (offline ? 'We could not reach the server.' : error.message) +
          ' Please try again, or email info@mathandsciencenight.com.';
        status.classList.add('error');
        submit.disabled = false;
      }
    });

    root.replaceChildren(form);
  };

  /* ---------- start ---------- */

  fetch('/survey/forms.json')
    .then(response => {
      if (!response.ok) throw new Error('forms');
      return response.json();
    })
    .then(data => {
      definitions = data;
      current = data.forms[formId];
      if (!current) throw new Error('unknown survey');
      buildForm();
    })
    .catch(() => {
      root.replaceChildren(el('p', '',
        'We could not load the survey. Please refresh the page, or email info@mathandsciencenight.com.'));
    });
})();
