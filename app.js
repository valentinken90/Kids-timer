'use strict';

// ── SVG arc geometry ──────────────────────────────────────────────
const ARC_R = 110;                        // ring radius (matches SVG)
const ARC_C = 2 * Math.PI * ARC_R;       // circumference ≈ 691.15

// ── Default state ─────────────────────────────────────────────────
const DEFAULTS = {
  config: { totalMins: 60, greenMins: 35, yellowMins: 10, redMins: 15 },
  tasks: [
    { id: 1, name: 'Brush teeth',    duration: 5, done: false },
    { id: 2, name: 'Put pyjamas on', duration: 5, done: false },
    { id: 3, name: 'Tidy toys',      duration: 5, done: false },
  ],
};

// ── Runtime state ─────────────────────────────────────────────────
let state   = loadState();          // { config, tasks }
let elapsed = 0;                    // seconds elapsed (not persisted)
let running = false;
let timerId = null;
let toastTimer  = null;
let nextId  = maxTaskId(state.tasks) + 1;

// settingsTasks: draft copy while settings panel is open
let settingsTasks = [];

// ── LocalStorage persistence ──────────────────────────────────────
function loadState() {
  try {
    const raw = localStorage.getItem('kids-timer-v1');
    if (raw) {
      const saved = JSON.parse(raw);
      return {
        config: { ...DEFAULTS.config, ...saved.config },
        tasks:  Array.isArray(saved.tasks) ? saved.tasks : deepCopy(DEFAULTS.tasks),
      };
    }
  } catch { /* ignore corrupt storage */ }
  return { config: { ...DEFAULTS.config }, tasks: deepCopy(DEFAULTS.tasks) };
}

function saveState() {
  localStorage.setItem('kids-timer-v1', JSON.stringify({
    config: state.config,
    tasks:  state.tasks,
  }));
}

// ── Helpers ───────────────────────────────────────────────────────
function deepCopy(x) { return JSON.parse(JSON.stringify(x)); }

function maxTaskId(tasks) {
  return tasks.reduce((m, t) => Math.max(m, t.id), 0);
}

function formatTime(secs) {
  const s = Math.max(0, secs);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, '0')}`;
}

function escHtml(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

// ── Computed values ───────────────────────────────────────────────

/** Total green time already earned from completed tasks (capped at configured redMins). */
function earnedMins() {
  const raw = state.tasks
    .filter(t => t.done)
    .reduce((s, t) => s + t.duration, 0);
  return Math.min(raw, state.config.redMins);
}

/** Current effective zone durations in minutes. */
function currentZones() {
  const e = earnedMins();
  return {
    greenMins:  state.config.greenMins  + e,
    yellowMins: state.config.yellowMins,
    redMins:    Math.max(0, state.config.redMins - e),
    earned:     e,
  };
}

function totalSecs()     { return state.config.totalMins * 60; }
function remainingSecs() { return Math.max(0, totalSecs() - elapsed); }

/** Which colour zone is the timer currently in? */
function currentZone() {
  const rem = remainingSecs();
  if (rem <= 0) return 'done';
  const z = currentZones();
  if (rem <= z.redMins    * 60)               return 'red';
  if (rem <= (z.redMins + z.yellowMins) * 60) return 'yellow';
  return 'green';
}

// ── Timer control ─────────────────────────────────────────────────
function tick() {
  elapsed++;
  if (elapsed >= totalSecs()) {
    elapsed = totalSecs();
    running = false;
    clearInterval(timerId);
    showToast('🎉 Time\'s up! Amazing work today!');
  }
  render();
}

function startTimer()  {
  if (running || remainingSecs() <= 0) return;
  running = true;
  timerId = setInterval(tick, 1000);
  render();
}

function pauseTimer()  {
  if (!running) return;
  running = false;
  clearInterval(timerId);
  render();
}

function toggleTimer() { running ? pauseTimer() : startTimer(); }

function resetTimer()  {
  running = false;
  clearInterval(timerId);
  elapsed = 0;
  render();
}

// ── Toast ─────────────────────────────────────────────────────────
function showToast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 3500);
}

// ── Task toggle ───────────────────────────────────────────────────
function toggleTask(id) {
  const task = state.tasks.find(t => t.id === id);
  if (!task) return;

  const earnedBefore = earnedMins();
  task.done = !task.done;
  const earnedAfter = earnedMins();

  if (task.done) {
    const gained = earnedAfter - earnedBefore;
    const allDone = state.tasks.every(t => t.done);

    if (allDone) {
      showToast('🎉 All tasks done — enjoy your free time!');
    } else if (gained > 0) {
      showToast(`🌟 You earned ${gained} minute${gained !== 1 ? 's' : ''} of free time!`);
    } else {
      // Task done but red was already zeroed out
      showToast('✅ Great job!');
    }
  }

  saveState();
  render();
}

// ── SVG arc rendering ─────────────────────────────────────────────
/**
 * Set a stroke-dasharray arc on an SVG circle.
 * arcLen  = length of the coloured dash in SVG user units
 * offset  = dashoffset so the dash starts at the right position around the ring
 *
 * Formula: to start a dash at ring-position P, dashoffset = C - P
 * All arc circles are CSS-rotated -90° so position 0 = 12 o'clock.
 */
function setArc(id, arcLen, dashOffset) {
  const el = document.getElementById(id);
  if (!el) return;

  if (arcLen <= 0) {
    el.style.visibility = 'hidden';
    return;
  }
  el.style.visibility = '';
  el.setAttribute('stroke-dasharray',  `${arcLen.toFixed(2)} ${(ARC_C - arcLen).toFixed(2)}`);
  el.setAttribute('stroke-dashoffset', dashOffset.toFixed(2));
}

// ── Full render ───────────────────────────────────────────────────
function render() {
  const zone  = currentZone();
  const zones = currentZones();
  const rem   = remainingSecs();
  const total = totalSecs();

  // Body tint
  document.body.className = `zone-${zone}`;

  // ── Zone badge ──
  const badge = document.getElementById('zone-badge');
  const badgeText = {
    green:  '🟢 Free time!',
    yellow: '🟡 Wrap up soon!',
    red:    '🔴 Task time!',
    done:   '🎉 All done!',
  };
  badge.textContent = badgeText[zone] ?? '';
  badge.className   = zone;

  // ── SVG arcs ──
  // Zone arc lengths (proportional to their share of the total circle)
  const greenLen  = (zones.greenMins  / state.config.totalMins) * ARC_C;
  const yellowLen = (zones.yellowMins / state.config.totalMins) * ARC_C;
  const redLen    = (zones.redMins    / state.config.totalMins) * ARC_C;

  // Consumed arc: how far around the ring we've progressed
  const consumedLen = (elapsed / total) * ARC_C;

  // Arc order around the ring: green → yellow → red (starting from 12 o'clock)
  // dashoffset formula: C - startPosition
  setArc('svg-green',    greenLen,   0);
  setArc('svg-yellow',   yellowLen,  ARC_C - greenLen);
  setArc('svg-red',      redLen,     ARC_C - greenLen - yellowLen);
  setArc('svg-consumed', consumedLen, 0);

  // ── Moving dot at current elapsed position ──
  const dot = document.getElementById('svg-dot');
  if (elapsed <= 0 || rem <= 0) {
    dot.style.visibility = 'hidden';
  } else {
    dot.style.visibility = '';
    // Angle: 0 = top (-π/2), clockwise positive
    const angle = (elapsed / total) * 2 * Math.PI - Math.PI / 2;
    dot.setAttribute('cx', (150 + ARC_R * Math.cos(angle)).toFixed(2));
    dot.setAttribute('cy', (150 + ARC_R * Math.sin(angle)).toFixed(2));
  }

  // ── Countdown display ──
  document.getElementById('time-remaining').textContent = formatTime(rem);

  const timeLabels = {
    green:  'free time left',
    yellow: 'heads up!',
    red:    'task time!',
    done:   'all done! 🎉',
  };
  document.getElementById('time-label').textContent = timeLabels[zone] ?? 'remaining';

  // ── Start/Pause button ──
  const startBtn = document.getElementById('btn-start');
  if (rem <= 0) {
    startBtn.textContent = '✓ Done!';
    startBtn.disabled    = true;
    startBtn.className   = 'btn btn-primary btn-large done-state';
  } else if (running) {
    startBtn.textContent = '⏸ Pause';
    startBtn.disabled    = false;
    startBtn.className   = 'btn btn-primary btn-large paused';
  } else {
    startBtn.textContent = elapsed > 0 ? '▶ Resume' : '▶ Start';
    startBtn.disabled    = false;
    startBtn.className   = 'btn btn-primary btn-large';
  }

  // ── Earned green time bar ──
  const earnedEl = document.getElementById('earned-bar');
  const e = zones.earned;
  if (e > 0) {
    document.getElementById('earned-text').textContent =
      `🌟 ${e} min${e !== 1 ? 's' : ''} of bonus free time earned!`;
    earnedEl.classList.remove('hidden');
  } else {
    earnedEl.classList.add('hidden');
  }

  // ── Task list ──
  renderTasks();
}

function renderTasks() {
  const list = document.getElementById('task-list');
  const countEl = document.getElementById('tasks-count');

  if (state.tasks.length === 0) {
    list.innerHTML = '<p class="task-empty">No tasks yet — tap ⚙️ to add some!</p>';
    countEl.textContent = '';
    return;
  }

  const doneCount = state.tasks.filter(t => t.done).length;
  countEl.textContent = `${doneCount} / ${state.tasks.length}`;

  list.innerHTML = state.tasks.map(task => `
    <div class="task-item ${task.done ? 'done' : ''}" data-id="${task.id}" role="button"
         tabindex="0" aria-pressed="${task.done}" aria-label="${escHtml(task.name)}">
      <div class="task-checkbox" aria-hidden="true">${task.done ? '✓' : ''}</div>
      <div class="task-info">
        <div class="task-name">${escHtml(task.name)}</div>
        <div class="task-duration">
          ${task.done
            ? `+${task.duration} min${task.duration !== 1 ? 's' : ''} earned`
            : `${task.duration} min${task.duration !== 1 ? 's' : ''}`}
        </div>
      </div>
    </div>
  `).join('');

  list.querySelectorAll('.task-item').forEach(row => {
    const id = Number(row.dataset.id);
    row.addEventListener('click',   () => toggleTask(id));
    row.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleTask(id); } });
  });
}

// ── Settings panel ────────────────────────────────────────────────
function openSettings() {
  pauseTimer();

  // Populate fields from current state
  document.getElementById('set-total').value  = state.config.totalMins;
  document.getElementById('set-green').value  = state.config.greenMins;
  document.getElementById('set-yellow').value = state.config.yellowMins;

  // Draft copy of tasks for editing
  settingsTasks = deepCopy(state.tasks);

  updateRedDisplay();
  renderSettingsTasks();

  document.getElementById('settings-overlay').classList.remove('hidden');
  document.getElementById('set-total').focus();
}

function closeSettings() {
  document.getElementById('settings-overlay').classList.add('hidden');
}

/** Recomputes and displays the auto-derived red time. Returns red value (may be negative = invalid). */
function updateRedDisplay() {
  const total  = parseInt(document.getElementById('set-total').value)  || 0;
  const green  = parseInt(document.getElementById('set-green').value)  || 0;
  const yellow = parseInt(document.getElementById('set-yellow').value) || 0;
  const red    = total - green - yellow;

  const dispEl = document.getElementById('set-red-display');
  const errEl  = document.getElementById('settings-error');

  dispEl.textContent = `${red} min`;

  if (total <= 0) {
    dispEl.className = 'computed-val invalid';
    errEl.textContent = 'Total time must be greater than 0.';
    errEl.classList.remove('hidden');
  } else if (green < 0 || yellow < 0 || red < 0) {
    dispEl.className = 'computed-val invalid';
    errEl.textContent = 'Zone durations add up to more than the total — please reduce green or yellow time.';
    errEl.classList.remove('hidden');
  } else {
    dispEl.className = 'computed-val';
    errEl.classList.add('hidden');
  }

  return red;
}

function renderSettingsTasks() {
  const list = document.getElementById('settings-task-list');

  if (settingsTasks.length === 0) {
    list.innerHTML = '<p class="task-empty" style="padding:8px 0">No tasks — tap + Add Task below.</p>';
    return;
  }

  list.innerHTML = settingsTasks.map((t, i) => `
    <div class="stask-row" data-index="${i}">
      <input type="text"   value="${escHtml(t.name)}" placeholder="Task name"
             data-index="${i}" data-field="name" maxlength="50" autocomplete="off">
      <input type="number" value="${t.duration}" min="1" max="999"
             data-index="${i}" data-field="duration" inputmode="numeric">
      <span class="stask-min">min</span>
      <button class="btn-del" data-index="${i}" aria-label="Delete task">🗑</button>
    </div>
  `).join('');

  list.querySelectorAll('input[data-field="name"]').forEach(input => {
    input.addEventListener('input', () => {
      settingsTasks[Number(input.dataset.index)].name = input.value;
    });
  });

  list.querySelectorAll('input[data-field="duration"]').forEach(input => {
    input.addEventListener('input', () => {
      const v = Math.max(1, parseInt(input.value) || 1);
      settingsTasks[Number(input.dataset.index)].duration = v;
    });
  });

  list.querySelectorAll('.btn-del').forEach(btn => {
    btn.addEventListener('click', () => {
      settingsTasks.splice(Number(btn.dataset.index), 1);
      renderSettingsTasks();
    });
  });
}

function addSettingsTask() {
  settingsTasks.push({ id: nextId++, name: '', duration: 5, done: false });
  renderSettingsTasks();
  // Focus the new task name input
  const inputs = document.querySelectorAll('#settings-task-list input[data-field="name"]');
  if (inputs.length) inputs[inputs.length - 1].focus();
}

function saveSettings() {
  const total  = parseInt(document.getElementById('set-total').value)  || 0;
  const green  = parseInt(document.getElementById('set-green').value)  || 0;
  const yellow = parseInt(document.getElementById('set-yellow').value) || 0;
  const red    = updateRedDisplay();

  if (total <= 0 || green < 0 || yellow < 0 || red < 0) return; // validation failed

  // Persist done-state for tasks that still exist (by ID), strip blank names
  const oldTasks = state.tasks;
  const newTasks = settingsTasks
    .filter(t => t.name.trim() !== '')
    .map(t => ({
      id:       t.id,
      name:     t.name.trim(),
      duration: Math.max(1, t.duration),
      // Preserve done status from previous state if ID matches
      done: oldTasks.find(o => o.id === t.id)?.done ?? false,
    }));

  state.config = { totalMins: total, greenMins: green, yellowMins: yellow, redMins: red };
  state.tasks  = newTasks;

  // Reset timer whenever config changes to avoid stale elapsed vs new total
  resetTimer();
  saveState();
  closeSettings();
  render();
}

// ── Init ──────────────────────────────────────────────────────────
function init() {
  document.getElementById('btn-start').addEventListener('click', toggleTimer);
  document.getElementById('btn-reset').addEventListener('click', resetTimer);

  document.getElementById('btn-settings').addEventListener('click', openSettings);
  document.getElementById('btn-close-settings').addEventListener('click', closeSettings);
  document.getElementById('btn-save-settings').addEventListener('click', saveSettings);
  document.getElementById('btn-add-task').addEventListener('click', addSettingsTask);

  ['set-total', 'set-green', 'set-yellow'].forEach(id => {
    document.getElementById(id).addEventListener('input', updateRedDisplay);
  });

  // Close settings when tapping the dark backdrop
  document.getElementById('settings-overlay').addEventListener('click', e => {
    if (e.target === document.getElementById('settings-overlay')) closeSettings();
  });

  render();
}

document.addEventListener('DOMContentLoaded', init);
