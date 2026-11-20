/* Survey pages: build the questions from /survey/forms.json, show the section that
   matches the respondent's role, send the answers to /api/survey, show the thank-you.
   Everything goes into the page with textContent, never as HTML. */
(() => {
  'use strict';

  const root = document.getElementById('survey-root');
  if (!root) return;

  const formId = root.dataset.survey;
  const openedAt = Date.now(); // when this page opened; only the elapsed time is sent
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

  /* ---------- random pair code, so Before and After answers can be matched ---------- */

  const PAIR_KEY = 'msn-pair-id';

  const randomCode = () => {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
    const bytes = new Uint8Array(16);
    window.crypto.getRandomValues(bytes);
    return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  };

  // The Before survey makes a code (once per device) and saves it; the After survey reads it.
  // Storage can be blocked (private browsing), in which case the answers are simply unmatched.
  const pairCode = () => {
    try {
      let code = window.localStorage.getItem(PAIR_KEY);
      if (!code && formId === 'before') {
        code = randomCode();
        window.localStorage.setItem(PAIR_KEY, code);
      }
      return code || '';
    } catch (_) {
      return '';
    }
  };

  /* ---------- question builders ---------- */

  const radioLabel = (name, value, text, required) => {
    const label = el('label', 'choice');
    const input = el('input');
    input.type = 'radio';
    input.name = name;
    input.value = value;
    if (required) input.required = true;
    label.append(input, el('span', 'mark'), el('span', 'choice-text', text));
    return { label, input };
  };

  // Long lists of choices are shuffled for each person so the first ones are not favoured.
  // The last few ("Other", "Undecided") stay at the end. Only the display order changes.
  const orderedOptions = question => {
    if (!question.shuffle) return question.options;
    const keep = question.keepLast || 0;
    const movable = question.options.slice(0, question.options.length - keep);
    const fixed = question.options.slice(question.options.length - keep);
    for (let i = movable.length - 1; i > 0; i -= 1) {
      const pick = Math.floor(Math.random() * (i + 1));
      [movable[i], movable[pick]] = [movable[pick], movable[i]];
    }
    return [...movable, ...fixed];
  };

  const buildChoice = question => {
    const set = el('fieldset');
    set.append(el('legend', '', question.question));
    const list = el('div', question.ui === 'tiles' ? 'choices tiles' : 'choices');
    for (const option of orderedOptions(question)) list.append(radioLabel(question.key, option, option).label);
    if (question.other) {
      const { label } = radioLabel(question.key, 'Other', 'Other:');
      const detail = el('input', 'other-text');
      detail.type = 'text';
      detail.name = `${question.key}__other`;
      detail.maxLength = 100;
      detail.autocomplete = 'off';
      detail.setAttribute('enterkeyhint', 'done');
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
        chip.append(input, el('span', 'dot'), el('span', 'chip-text', level));
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

  /* ---------- grade picker: swipe a row of bubbles sideways, or tap one ---------- */

  // 1 -> 1st, 2 -> 2nd, 3 -> 3rd, 6 -> 6th, 11 -> 11th (display only; the saved answer is unchanged)
  const ordinal = number => {
    const lastTwo = number % 100;
    if (lastTwo >= 11 && lastTwo <= 13) return `${number}th`;
    return `${number}${{ 1: 'st', 2: 'nd', 3: 'rd' }[number % 10] || 'th'}`;
  };

  const gradeWords = option => {
    if (/^\d+$/.test(option)) return `${ordinal(Number(option))} Grade`;
    if (option === 'K') return 'Kindergarten';
    return option;
  };

  const bubbleText = option => {
    const ordinal = option.match(/^(\d+(?:st|nd|rd|th)) Grade$/);
    return ordinal ? ordinal[1] : option;
  };

  // Underneath it is still an ordinary radio group, so keyboards and screen readers work.
  const buildSwipe = question => {
    const set = el('fieldset', 'swipe');
    set.append(el('legend', '', question.question));

    const prompt = '‹  Swipe to pick your grade  ›';
    const readout = el('div', 'swipe-readout', prompt);
    readout.setAttribute('aria-live', 'polite');

    const frame = el('div', 'swipe-frame');
    const strip = el('div', 'swipe-strip');
    const options = question.other ? [...question.options, 'Other'] : question.options;
    const items = options.map(option => {
      const item = el('label', 'swipe-item');
      const input = el('input');
      input.type = 'radio';
      input.name = question.key;
      input.value = option;
      input.setAttribute('aria-label', gradeWords(option));
      item.append(input, el('span', 'swipe-bubble', bubbleText(option)));
      strip.append(item);
      return item;
    });
    frame.append(strip, el('div', 'swipe-caret'));
    set.append(readout, frame);

    let otherBox = null;
    if (question.other) {
      otherBox = el('div', 'swipe-other');
      otherBox.hidden = true;
      const detail = el('input', 'other-text');
      detail.type = 'text';
      detail.name = `${question.key}__other`;
      detail.maxLength = 100;
      detail.autocomplete = 'off';
      detail.placeholder = 'Type your grade';
      detail.setAttribute('enterkeyhint', 'done');
      detail.setAttribute('aria-label', `${question.question} Other, please specify`);
      otherBox.append(detail);
      set.append(otherBox);
    }

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let touched = false;   // only a person's own swipe, tap or key press may choose a grade
    let settle = 0;
    let frameRequest = 0;

    const show = () => {
      const picked = strip.querySelector('input:checked');
      set.classList.toggle('has-value', Boolean(picked));
      readout.textContent = picked ? gradeWords(picked.value) : prompt;
      if (otherBox) otherBox.hidden = !(picked && picked.value === 'Other');
    };

    // Bubbles shrink and fade the further they are from the middle.
    const scale = () => {
      frameRequest = 0;
      const box = strip.getBoundingClientRect();
      if (!box.width) return;
      // Leave exactly enough room at each end for the first and last bubble to reach the middle.
      strip.style.setProperty('--pad-start', `${(strip.clientWidth - items[0].offsetWidth) / 2}px`);
      strip.style.setProperty('--pad-end', `${(strip.clientWidth - items[items.length - 1].offsetWidth) / 2}px`);
      const middle = box.left + box.width / 2;
      for (const item of items) {
        const r = item.getBoundingClientRect();
        const distance = Math.min(1, Math.abs(r.left + r.width / 2 - middle) / (box.width / 2));
        item.style.setProperty('--d', distance.toFixed(3));
      }
    };

    const goTo = item => {
      strip.scrollTo({
        left: item.offsetLeft - (strip.clientWidth - item.offsetWidth) / 2,
        behavior: reduced ? 'auto' : 'smooth',
      });
    };

    const nearest = () => {
      const box = strip.getBoundingClientRect();
      const middle = box.left + box.width / 2;
      let best = items[0];
      let bestDistance = Infinity;
      for (const item of items) {
        const r = item.getBoundingClientRect();
        const distance = Math.abs(r.left + r.width / 2 - middle);
        if (distance < bestDistance) { best = item; bestDistance = distance; }
      }
      return best;
    };

    // A tap or an arrow key picked one: slide it to the middle.
    strip.addEventListener('change', event => {
      touched = true;
      show();
      goTo(event.target.closest('.swipe-item'));
    });

    for (const type of ['pointerdown', 'touchstart', 'wheel', 'keydown']) {
      strip.addEventListener(type, () => { touched = true; }, { passive: true });
    }

    // After a swipe comes to rest, whatever sits in the middle is the answer.
    strip.addEventListener('scroll', () => {
      if (!frameRequest) frameRequest = requestAnimationFrame(scale);
      clearTimeout(settle);
      settle = setTimeout(() => {
        if (!touched) return;
        const input = nearest().querySelector('input');
        if (!input.checked) {
          input.checked = true;
          show();
        }
      }, 120);
    }, { passive: true });

    if (typeof ResizeObserver === 'function') new ResizeObserver(scale).observe(strip);
    show();
    return set;
  };

  const build = question => {
    if (question.ui === 'swipe') return buildSwipe(question);
    return ({
      choice: buildChoice,
      select: buildSelect,
      grid: buildGrid,
      text: buildText,
    })[question.type](question);
  };

  /* ---------- the research notice: folded and faded until "Read full instructions" ---------- */

  // Nothing is removed. The whole text stays on the page (screen readers still read it);
  // it is only clipped until the button opens it.
  const buildIntro = paragraphs => {
    const wrap = el('div', 'intro-wrap collapsed');
    const body = el('div', 'intro-body');
    const intro = el('div', 'survey-intro');
    intro.id = 'survey-intro';
    for (const paragraph of paragraphs) intro.append(el('p', '', paragraph));
    const fade = el('div', 'intro-fade');
    fade.setAttribute('aria-hidden', 'true');
    body.append(intro, fade);

    const toggle = el('button', 'intro-toggle', 'Read full instructions');
    toggle.type = 'button';
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-controls', 'survey-intro');

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let timer = 0;
    toggle.addEventListener('click', () => {
      clearTimeout(timer);
      const opening = wrap.classList.contains('collapsed');
      intro.style.maxHeight = `${intro.scrollHeight}px`;
      if (opening) {
        wrap.classList.remove('collapsed');
        timer = setTimeout(() => { intro.style.maxHeight = 'none'; }, reduced ? 0 : 350);
      } else {
        void intro.offsetHeight; // register the open height so the fold animates
        wrap.classList.add('collapsed');
        intro.style.maxHeight = '';
        toggle.scrollIntoView({ block: 'nearest' });
      }
      toggle.setAttribute('aria-expanded', String(opening));
      toggle.textContent = opening ? 'Show less' : 'Read full instructions';
    });

    wrap.append(body, toggle);
    return wrap;
  };

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

    form.append(buildIntro(current.intro));

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
    const back = el('a', 'back-link', '\u2190 Wrong survey? Go back');
    back.href = '/survey/';
    actions.append(submit, status, back);
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
            pairId: pairCode() || undefined,
            elapsedSeconds: Math.round((Date.now() - openedAt) / 1000),
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

  fetch('/survey/forms.json', { cache: 'no-cache' })
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
