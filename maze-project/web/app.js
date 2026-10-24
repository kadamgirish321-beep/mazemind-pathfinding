/* MazeMind UI: tabs, canvas renderer, assessment session, generator animation, solver race, benchmark. */
(function () {
  'use strict';
  const C = window.MazeCore;
  const $ = (s) => document.querySelector(s);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const fmt = (x, d = 0) => Number(x).toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d });

  /* ---------- Theme tokens for canvas ---------- */
  let P = {};
  function readPalette() {
    const s = getComputedStyle(document.documentElement);
    const g = (n) => s.getPropertyValue(n).trim();
    P = {
      surface: g('--surface'), ink: g('--ink'), muted: g('--muted'), rule: g('--rule'), rock: g('--rock'),
      accent: g('--accent'), path: g('--path'), error: g('--error'), visit: g('--visit'),
      stack: g('--stack'), dead: g('--dead'),
    };
  }
  readPalette();
  const redrawers = {};
  function redrawAll() { readPalette(); Object.values(redrawers).forEach((f) => f()); }
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', redrawAll);
  new MutationObserver(redrawAll).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  /* ---------- Tabs ---------- */
  const views = {};
  let onTab = {};
  const tabs = Array.from(document.querySelectorAll('.tab'));
  tabs.forEach((t) => {
    views[t.dataset.tab] = $('#view-' + t.dataset.tab);
    t.addEventListener('click', () => showTab(t.dataset.tab));
  });
  // Arrow keys, Home and End move between tabs (WAI-ARIA tabs pattern).
  $('.tabs').addEventListener('keydown', (e) => {
    const k = tabs.indexOf(document.activeElement);
    if (k < 0) return;
    const to = { ArrowRight: k + 1, ArrowLeft: k - 1, Home: 0, End: tabs.length - 1 }[e.key];
    if (to == null) return;
    e.preventDefault();
    const t = tabs[(to + tabs.length) % tabs.length];
    t.focus();
    showTab(t.dataset.tab);
  });
  function showTab(name) {
    tabs.forEach((t) => {
      const on = t.dataset.tab === name;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
    });
    Object.entries(views).forEach(([k, v]) => { v.hidden = k !== name; });
    $('#tip').hidden = true;
    try { localStorage.setItem('mazemind-tab', name); } catch (e) { /* storage unavailable */ }
    if (onTab[name]) onTab[name]();
  }

  /* ---------- Canvas renderer ---------- */
  function setupCanvas(canvas, maze, maxPx) {
    const box = canvas.parentElement.clientWidth || maxPx;
    const avail = Math.min(maxPx, box);
    const cell = Math.max(3, Math.floor((avail - 8) / Math.max(maze.cols, maze.rows)));
    const w = cell * maze.cols + 8, h = cell * maze.rows + 8;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, cell, off: 4, w, h };
  }

  function render(view, maze, L = {}) {
    const { ctx, cell, off, w, h } = view;
    const x0 = (i) => off + maze.col(i) * cell, y0 = (i) => off + maze.row(i) * cell;
    ctx.fillStyle = P.surface;
    ctx.fillRect(0, 0, w, h);
    const fill = (cells, color, alpha = 1) => {
      if (!cells) return;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = color;
      for (const i of cells) ctx.fillRect(x0(i), y0(i), cell, cell);
      ctx.globalAlpha = 1;
    };
    if (L.unvisited) {
      ctx.fillStyle = P.rock;
      for (let i = 0; i < maze.size; i++) if (!L.unvisited[i]) ctx.fillRect(x0(i), y0(i), cell, cell);
    }
    (L.fills || []).forEach((f) => fill(f.cells, f.color, f.alpha));
    if (L.markers !== false) {
      fill([maze.size - 1], P.path, 0.28);
      fill([0], P.accent, 0.16);
    }
    if (L.highlight != null) fill([L.highlight], P.accent);
    for (const ln of L.lines || []) {
      if (!ln.cells || ln.cells.length < 2) continue;
      ctx.strokeStyle = ln.color;
      ctx.lineWidth = Math.max(1.5, cell * (ln.width || 0.22));
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.setLineDash(ln.dash ? [cell * 0.35, cell * 0.3] : []);
      ctx.beginPath();
      ln.cells.forEach((i, k) => {
        const x = x0(i) + cell / 2, y = y0(i) + cell / 2;
        if (k) ctx.lineTo(x, y); else ctx.moveTo(x, y);
      });
      ctx.stroke();
      ctx.setLineDash([]);
    }
    // Walls: draw N and W of every cell, plus the outer E and S edges.
    ctx.strokeStyle = P.ink;
    ctx.lineWidth = Math.max(1.25, Math.min(3, cell / 9));
    ctx.lineCap = 'square';
    ctx.beginPath();
    for (let r = 0; r < maze.rows; r++) {
      for (let c = 0; c < maze.cols; c++) {
        const i = r * maze.cols + c, wv = maze.walls[i];
        const x = off + c * cell, y = off + r * cell;
        if (wv & C.N) { ctx.moveTo(x, y); ctx.lineTo(x + cell, y); }
        if (wv & C.W) { ctx.moveTo(x, y); ctx.lineTo(x, y + cell); }
        if (c === maze.cols - 1 && (wv & C.E)) { ctx.moveTo(x + cell, y); ctx.lineTo(x + cell, y + cell); }
        if (r === maze.rows - 1 && (wv & C.S)) { ctx.moveTo(x, y + cell); ctx.lineTo(x + cell, y + cell); }
      }
    }
    ctx.stroke();
    if (L.player != null) {
      ctx.fillStyle = P.accent;
      ctx.beginPath();
      ctx.arc(x0(L.player) + cell / 2, y0(L.player) + cell / 2, Math.max(2.5, cell * 0.3), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /* ================================================================== */
  /* 1. Assessment                                                       */
  /* ================================================================== */
  const TRIALS = 6, START_LEVEL = 3;
  const A = { level: START_LEVEL, trials: [], t: null, view: null, active: false, sim: null, action: null, raf: 0 };
  const asCanvas = $('#as-canvas');

  function makeTrial(level) {
    const seed = (Math.random() * 4294967295) >>> 0;
    const built = C.buildTrialMaze(level, seed);
    return { ...built, solution: built.metrics.path, trail: [0], pos: 0, bumps: 0, t0: 0, tFirst: null, review: false };
  }

  function drawAssess() {
    const t = A.t;
    if (!t) return;
    A.view = setupCanvas(asCanvas, t.maze, 560);
    const L = { lines: [], fills: [] };
    if (t.review) {
      L.fills.push({ cells: t.solution, color: P.path, alpha: 0.22 });
      L.fills.push({ cells: t.result.offPath, color: P.dead });
      L.lines.push({ cells: t.trail, color: P.accent, width: 0.16 });
    } else if (t.trail.length > 1) {
      L.lines.push({ cells: t.trail, color: P.accent, width: 0.16 });
    }
    L.player = t.pos;
    render(A.view, t.maze, L);
  }
  redrawers.assess = drawAssess;

  function header() {
    const t = A.t;
    const n = A.trials.length + (A.active || A.sim ? 1 : 0);
    $('#as-title').textContent = (A.active || A.sim || A.trials.length ? `Trial ${Math.max(1, n)}` : 'Practice maze') + ` · level ${t.level} · ${t.size} × ${t.size}`;
    $('#as-trial').textContent = `${Math.min(n, TRIALS)} / ${TRIALS}`;
    $('#as-level').textContent = t.level;
    $('#as-diff').textContent = t.metrics.difficulty;
  }

  function overlay(show, opts = {}) {
    const ov = $('#as-overlay');
    ov.hidden = !show;
    if (!show) return;
    ov.classList.toggle('compact', !!opts.compact);
    $('#ov-title').textContent = opts.title;
    $('#ov-text').textContent = opts.text;
    const btn = $('#ov-btn');
    btn.hidden = !opts.button;
    if (opts.button) btn.textContent = opts.button;
    A.action = opts.action || null;
    if (opts.button && opts.focus) btn.focus({ preventScroll: true });
  }
  $('#ov-btn').addEventListener('click', () => { if (A.action) A.action(); });

  function tick() {
    cancelAnimationFrame(A.raf);
    const loop = () => {
      if (!A.active) return;
      $('#as-timer').textContent = ((performance.now() - A.t.t0) / 1000).toFixed(1) + ' s';
      A.raf = requestAnimationFrame(loop);
    };
    loop();
  }

  function resetSession() {
    cancelSim();
    A.active = false;
    cancelAnimationFrame(A.raf);
    A.trials = [];
    A.level = START_LEVEL;
    $('#as-rows').innerHTML = '<tr><td colspan="7" class="empty">Results appear here after each maze.</td></tr>';
    $('#as-summary').hidden = true;
  }

  function beginTrial() {
    A.t = makeTrial(A.level);
    A.t.t0 = performance.now();
    A.active = true;
    overlay(false);
    header();
    drawAssess();
    tick();
  }

  function move(name) {
    if (!A.active || A.sim) return;
    const t = A.t, d = C.DIR[name];
    if (!t.maze.canMove(t.pos, d)) { t.bumps++; return; }
    if (t.tFirst == null) t.tFirst = performance.now();
    t.pos = t.maze.neighbor(t.pos, d);
    t.trail.push(t.pos);
    drawAssess();
    if (t.pos === t.maze.size - 1) {
      const now = performance.now();
      finishTrial({ planningMs: t.tFirst - t.t0, totalMs: now - t.t0, wallBumps: t.bumps });
    }
  }

  function finishTrial(timing) {
    A.active = false;
    const t = A.t;
    const r = C.scoreTrial(t.maze, t.solution, t.trail, timing);
    t.result = r;
    t.review = true;
    $('#as-timer').textContent = (timing.totalMs / 1000).toFixed(1) + ' s';
    const entry = { ...r, level: t.level, size: t.size, difficulty: t.metrics.difficulty };
    A.trials.push(entry);
    addRow(entry, A.trials.length);
    drawAssess();
    const prev = A.level;
    A.level = C.nextLevel(A.level, r);
    const change = A.level > prev ? 'moves up to' : A.level < prev ? 'drops to' : 'stays at';
    const msg = `${r.moves} moves (best ${r.optimal}), ${r.wrongTurns} wrong turn${r.wrongTurns === 1 ? '' : 's'}, score ${r.score}.`;
    if (A.trials.length < TRIALS) {
      overlay(true, {
        compact: true,
        title: `Trial ${A.trials.length} done`,
        text: `${msg} Next maze ${change} level ${A.level}. The green cells are the shortest route and the orange cells are wrong turns.`,
        button: A.sim ? null : 'Next maze',
        action: beginTrial,
        focus: true,
      });
    } else {
      showSummary();
      overlay(true, {
        compact: true,
        title: 'Assessment complete',
        text: `${msg} See the session summary for the result.`,
        button: A.sim ? null : 'Start again',
        action: () => { resetSession(); beginTrial(); },
        focus: true,
      });
    }
  }

  function addRow(e, n) {
    const tb = $('#as-rows');
    if (n === 1) tb.innerHTML = '';
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${n}</td><td>${e.level}</td><td>${e.moves} / ${e.optimal}</td>` +
      `<td>${fmt(e.efficiency * 100)}%</td><td>${e.wrongTurns}</td><td>${fmt(e.planningMs / 1000, 1)} s</td><td>${e.score}</td>`;
    tb.appendChild(tr);
  }

  function showSummary() {
    const s = C.summarize(A.trials);
    $('#as-summary').hidden = false;
    $('#sum-band').textContent = s.band;
    $('#sum-final').textContent = s.finalLevel;
    $('#sum-eff').textContent = fmt(s.meanEff * 100) + '%';
    $('#sum-err').textContent = s.errors;
    $('#sum-plan').textContent = fmt(s.meanPlanningMs / 1000, 1) + ' s';
    const pts = A.trials.map((t, i) => [i + 1, t.level]);
    pts.push([A.trials.length + 1, s.finalLevel]);
    lineChart($('#sum-chart'), {
      series: [{ name: 'Level', color: 'var(--accent)', pts, step: true }],
      xLabel: 'Trial (7 = level reached after the last trial)', yLabel: 'Level',
      xTicks: pts.map((p) => p[0]), xMin: 1, yMin: 1, yMax: C.MAX_LEVEL, height: 220,
      tip: (p) => `Trial ${p[0]}: level ${p[1]}`,
    });
  }

  function cancelSim() {
    if (A.sim) A.sim.cancelled = true;
    A.sim = null;
  }

  async function runSim() {
    resetSession();
    const sim = { cancelled: false };
    A.sim = sim;
    const skill = parseFloat($('#as-skill').value);
    // Every await can resume after the user restarted or started another run,
    // so check for cancellation before touching the shared session state.
    for (let k = 0; k < TRIALS; k++) {
      if (sim.cancelled) return;
      A.t = makeTrial(A.level);
      overlay(false);
      header();
      $('#as-timer').textContent = 'simulated';
      drawAssess();
      const s = C.simulateParticipant(A.t.maze, A.t.solution, skill, A.t.seed + k);
      const interval = Math.max(6, Math.min(70, 2600 / s.trail.length));
      await sleep(400);
      if (sim.cancelled) return;
      for (let i = 1; i < s.trail.length; i++) {
        if (sim.cancelled) return;
        A.t.pos = s.trail[i];
        A.t.trail.push(A.t.pos);
        drawAssess();
        await sleep(interval);
      }
      if (sim.cancelled) return;
      finishTrial({ planningMs: s.planningMs, totalMs: s.totalMs, wallBumps: 0 });
      $('#as-timer').textContent = (s.totalMs / 1000).toFixed(1) + ' s (sim)';
      await sleep(1500);
    }
    if (sim.cancelled) return;
    A.sim = null;
    overlay(true, {
      compact: true, title: 'Simulation complete',
      text: `Simulated skill ${Math.round(skill * 100)}%. Try a lower skill to watch the level drop.`,
      button: 'Take the test yourself', action: () => { resetSession(); beginTrial(); },
    });
  }

  $('#as-start').addEventListener('click', () => { resetSession(); beginTrial(); });
  $('#as-sim').addEventListener('click', runSim);
  document.querySelectorAll('.dpad button').forEach((b) => b.addEventListener('click', () => move(b.dataset.dir)));
  const KEYS = { ArrowUp: 'N', ArrowDown: 'S', ArrowLeft: 'W', ArrowRight: 'E', w: 'N', s: 'S', a: 'W', d: 'E', W: 'N', S: 'S', A: 'W', D: 'E' };
  document.addEventListener('keydown', (e) => {
    if (views.assess.hidden || !A.active || e.defaultPrevented) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'select') return;
    const d = KEYS[e.key];
    if (d) { e.preventDefault(); move(d); }
  });
  // Swipe on the maze for touch screens.
  let touch0 = null;
  asCanvas.addEventListener('pointerdown', (e) => { touch0 = [e.clientX, e.clientY]; });
  asCanvas.addEventListener('pointercancel', () => { touch0 = null; });
  asCanvas.addEventListener('pointerup', (e) => {
    if (!touch0) return;
    const dx = e.clientX - touch0[0], dy = e.clientY - touch0[1];
    touch0 = null;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 18) return;
    move(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'E' : 'W') : (dy > 0 ? 'S' : 'N'));
  });

  // Opening state: a practice maze is visible behind the start card.
  A.t = makeTrial(START_LEVEL);
  header();
  drawAssess();
  overlay(true, {
    title: 'Find the way out',
    text: 'Start at the blue dot in the top-left corner and reach the green exit in the bottom-right. Use the arrow keys, WASD, swipes or the buttons. There are six mazes, and each one adapts to your last result.',
    button: 'Start assessment',
    action: () => { resetSession(); beginTrial(); },
  });

  /* ================================================================== */
  /* 2. Generation                                                       */
  /* ================================================================== */
  const CODE = {
    backtracker: [
      ['', 'push start cell, mark it visited'],
      ['', 'while stack is not empty:'],
      ['', '  cell ← top of stack'],
      ['carve', '  if cell has unvisited neighbours:'],
      ['carve', '    n ← random unvisited neighbour'],
      ['carve', '    remove wall between cell and n'],
      ['carve', '    mark n visited; push n'],
      ['back', '  else:'],
      ['back', '    pop stack            ← backtrack'],
    ],
    prim: [
      ['', 'add start cell to maze; its walls → frontier'],
      ['', 'while frontier is not empty:'],
      ['carve', '  (a, b) ← random wall from frontier'],
      ['carve', '  if b is not in the maze:'],
      ['carve', '    remove wall; add b to maze'],
      ['carve', "    add b's walls to frontier"],
    ],
    kruskal: [
      ['', 'put every cell in its own set'],
      ['', 'shuffle all inner walls'],
      ['', 'for each wall (a, b):'],
      ['carve', '  if find(a) ≠ find(b):'],
      ['carve', '    remove wall; union(a, b)'],
    ],
  };
  const SPEEDS = [0.05, 0.12, 0.25, 0.5, 1, 2, 4, 8, 16, 40, 200];
  const G = { raf: 0, playing: false };
  const genCanvas = $('#gen-canvas');

  function setPlaying(on) {
    G.playing = on;
    $('#gen-pause').textContent = on ? 'Pause' : 'Resume';
  }

  function genPrepare() {
    cancelAnimationFrame(G.raf);
    setPlaying(false);
    G.algo = $('#gen-algo').value;
    G.n = parseInt($('#gen-size').value, 10);
    G.seed = parseInt($('#gen-seed').value, 10) || 1;
    const res = C.GENERATORS[G.algo].fn(G.n, G.n, G.seed, true);
    G.final = res.maze;
    G.steps = res.steps;
    G.k = 0;
    G.acc = 0;
    G.maze = new C.Maze(G.n, G.n);
    G.visited = new Uint8Array(G.maze.size);
    G.stack = [];
    G.cur = null;
    G.back = 0;
    G.maxDepth = 0;
    G.count = 0;
    G.hot = '';
    if (G.algo !== 'kruskal') { G.visited[0] = 1; G.count = 1; G.cur = 0; }
    if (G.algo === 'backtracker') { G.stack = [0]; G.maxDepth = 1; }
    $('#gen-title').textContent = `${C.GENERATORS[G.algo].label} · ${G.n} × ${G.n}`;
    $('#gen-code-title').textContent = `Pseudocode · ${C.GENERATORS[G.algo].label}`;
    $('#gen-result').hidden = true;
    G.view = setupCanvas(genCanvas, G.maze, 560);
    genDraw();
  }

  function genApply(step) {
    if (step[0] === 0) {
      const [, a, b] = step;
      G.maze.removeWall(a, G.maze.dirBetween(a, b));
      for (const c of [a, b]) if (!G.visited[c]) { G.visited[c] = 1; G.count++; }
      if (G.algo === 'backtracker') { G.stack.push(b); G.maxDepth = Math.max(G.maxDepth, G.stack.length); }
      G.cur = b;
      G.hot = 'carve';
    } else {
      G.stack.pop();
      G.back++;
      G.cur = G.stack.length ? G.stack[G.stack.length - 1] : null;
      G.hot = 'back';
    }
  }

  function genDraw() {
    const done = G.k >= G.steps.length;
    const L = { unvisited: G.visited, fills: [], lines: [], markers: done };
    if (G.algo === 'backtracker' && !done) L.fills.push({ cells: G.stack, color: P.stack });
    if (!done && G.cur != null) L.highlight = G.cur;
    if (done) L.lines.push({ cells: C.solveBFS(G.maze, 0, G.maze.size - 1).path, color: P.path, width: 0.22, dash: true });
    render(G.view, G.maze, L);
    $('#gen-step').textContent = `step ${fmt(G.k)} / ${fmt(G.steps.length)}`;
    $('#gen-visited').textContent = `${fmt(G.count)}`;
    $('#gen-depth').textContent = G.algo === 'backtracker' ? `${G.stack.length}` : '–';
    $('#gen-back').textContent = G.algo === 'backtracker' ? fmt(G.back) : '–';
    $('#gen-code').innerHTML = CODE[G.algo].map(([k, txt]) => {
      const cls = !done && k && k === G.hot ? (k === 'back' ? 'hot-back' : 'hot') : '';
      return `<span class="${cls}">${txt.replace(/</g, '&lt;')}</span>`;
    }).join('');
    if (done) genFinish();
  }
  redrawers.generate = () => { if (G.view) { G.view = setupCanvas(genCanvas, G.maze, 560); genDraw(); } };

  function genFinish() {
    const m = C.analyze(G.maze);
    const cells = [
      [fmt(m.deadEndPct, 1) + '%', 'Dead ends'],
      [fmt(m.junctions), 'Junctions'],
      [fmt(m.solutionLength), 'Shortest route (cells)'],
      [fmt(m.difficulty), 'Difficulty L + 3J'],
      [C.isPerfect(G.maze) ? 'Yes' : 'No', 'Perfect maze (one route)'],
    ];
    if (G.algo === 'backtracker') cells.push([fmt(G.maxDepth), 'Max stack depth']);
    $('#gen-metrics').innerHTML = cells.map(([v, k]) => `<div class="readout"><div class="v">${v}</div><div class="k">${k}</div></div>`).join('');
    $('#gen-result').hidden = false;
  }

  function genLoop() {
    if (!G.playing) return;
    G.acc += SPEEDS[parseInt($('#gen-speed').value, 10)];
    while (G.acc >= 1 && G.k < G.steps.length) { genApply(G.steps[G.k++]); G.acc -= 1; }
    genDraw();
    if (G.k >= G.steps.length) { setPlaying(false); return; }
    G.raf = requestAnimationFrame(genLoop);
  }

  $('#gen-run').addEventListener('click', () => { genPrepare(); setPlaying(true); genLoop(); });
  $('#gen-pause').addEventListener('click', () => {
    if (G.k >= G.steps.length) return;
    setPlaying(!G.playing);
    if (G.playing) genLoop();
  });
  $('#gen-stepbtn').addEventListener('click', () => {
    setPlaying(false);
    if (G.k < G.steps.length) genApply(G.steps[G.k++]);
    genDraw();
  });
  $('#gen-instant').addEventListener('click', () => {
    if (!G.steps) genPrepare();
    setPlaying(false);
    while (G.k < G.steps.length) genApply(G.steps[G.k++]);
    genDraw();
  });
  ['#gen-algo', '#gen-size', '#gen-seed'].forEach((s) => $(s).addEventListener('change', genPrepare));

  let genStarted = false;
  onTab.generate = () => {
    if (genStarted) { redrawers.generate(); return; }
    genStarted = true;
    genPrepare();
    // Open part-way through so the stack and backtracking are visible at once.
    const target = Math.floor(G.steps.length * 0.45);
    while (G.k < target) genApply(G.steps[G.k++]);
    genDraw();
  };

  /* ================================================================== */
  /* 3. Solver comparison                                                */
  /* ================================================================== */
  const SV = { raf: 0, maze: null, runs: [] };
  const svOrder = ['dfs', 'bfs', 'astar'];
  $('#sv-trio').innerHTML = svOrder.map((k) => `
    <div class="sheet">
      <div class="sheet-head"><h3>${C.SOLVERS[k].label}</h3></div>
      <div class="canvas-box"><canvas id="sv-c-${k}" role="img" aria-label="${C.SOLVERS[k].label}"></canvas></div>
      <div class="stats">
        <div><b id="sv-e-${k}">–</b>cells explored</div>
        <div><b id="sv-p-${k}">–</b>path length</div>
        <div><b id="sv-t-${k}">–</b>time</div>
      </div>
    </div>`).join('');

  function svNew() {
    cancelAnimationFrame(SV.raf);
    const n = parseInt($('#sv-size').value, 10);
    const frac = parseInt($('#sv-braid').value, 10) / 100;
    const seed = (Math.random() * 4294967295) >>> 0;
    SV.maze = C.braid(C.generateBacktracker(n, n, seed).maze, frac, seed);
    SV.runs = svOrder.map((k) => ({ key: k, res: null, k: 0, state: null, view: setupCanvas($('#sv-c-' + k), SV.maze, 360) }));
    SV.runs.forEach((r) => {
      ['e', 'p', 't'].forEach((x) => { $(`#sv-${x}-${r.key}`).textContent = '–'; });
      render(r.view, SV.maze, {});
    });
  }

  function svDraw(run) {
    const s = run.state;
    const L = { fills: [{ cells: s.seen, color: P.visit }, { cells: s.dead, color: P.dead }], lines: [] };
    const done = run.k >= run.res.events.length;
    if (done) L.lines.push({ cells: run.res.path, color: P.path, width: 0.3 });
    else if (run.key === 'dfs') L.lines.push({ cells: s.stack, color: P.accent, width: 0.2 });
    render(run.view, SV.maze, L);
  }

  function svRun() {
    if (!SV.maze) svNew();
    cancelAnimationFrame(SV.raf);
    const goal = SV.maze.size - 1;
    let shortest = Infinity;
    SV.runs.forEach((run) => {
      const fn = C.SOLVERS[run.key].fn;
      const reps = 30, t0 = performance.now();
      for (let i = 0; i < reps; i++) fn(SV.maze, 0, goal);
      run.ms = (performance.now() - t0) / reps;
      run.res = fn(SV.maze, 0, goal);
      run.k = 0;
      run.state = { seen: [], dead: [], stack: [] };
      shortest = Math.min(shortest, run.res.path.length);
    });
    const rate = Math.max(1, Math.ceil(SV.maze.size / 240));
    const frame = () => {
      let busy = false;
      SV.runs.forEach((run) => {
        const ev = run.res.events;
        for (let j = 0; j < rate && run.k < ev.length; j++) {
          const [type, cell] = ev[run.k++];
          if (type === 0) { run.state.seen.push(cell); run.state.stack.push(cell); } else { run.state.dead.push(cell); run.state.stack.pop(); }
        }
        if (run.k < ev.length) busy = true;
        $(`#sv-e-${run.key}`).textContent = fmt(run.state.seen.length);
        if (run.k >= ev.length) {
          const extra = run.res.path.length - shortest;
          $(`#sv-p-${run.key}`).textContent = fmt(run.res.path.length) + (extra > 0 ? ` (+${extra})` : '');
          $(`#sv-t-${run.key}`).textContent = fmt(run.ms, 3) + ' ms';
        }
        svDraw(run);
      });
      if (busy) SV.raf = requestAnimationFrame(frame);
    };
    frame();
  }
  redrawers.solve = () => { SV.runs.forEach((r) => { r.view = setupCanvas($('#sv-c-' + r.key), SV.maze, 360); if (r.state) svDraw(r); else render(r.view, SV.maze, {}); }); };

  $('#sv-new').addEventListener('click', () => { svNew(); svRun(); });
  $('#sv-run').addEventListener('click', svRun);
  $('#sv-braid').addEventListener('input', () => { $('#sv-braid-v').textContent = `${$('#sv-braid').value}% of dead ends opened`; });
  $('#sv-braid').addEventListener('change', () => { svNew(); svRun(); });
  $('#sv-size').addEventListener('change', () => { svNew(); svRun(); });
  let svStarted = false;
  onTab.solve = () => { if (!svStarted) { svStarted = true; svNew(); svRun(); } else redrawers.solve(); };

  /* ================================================================== */
  /* 4. Analysis                                                         */
  /* ================================================================== */
  const SIZES = [10, 20, 40, 60, 80, 100, 140, 200];
  const REPS = 5;
  const ALGOS = ['backtracker', 'prim', 'kruskal'];
  const SHORT = { backtracker: 'Backtracker', prim: "Prim's", kruskal: "Kruskal's", dfs: 'DFS', bfs: 'BFS', astar: 'A*' };
  const SERIES = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)'];
  let anRunning = false;

  async function runBenchmark() {
    if (anRunning) return;
    anRunning = true;
    $('#an-run').disabled = true;
    $('#an-recursion').textContent = 'Running…';
    try {
      await benchmarkBody();
    } finally {
      $('#an-run').disabled = false;
      anRunning = false;
    }
  }

  async function benchmarkBody() {
    const rows = [];
    $('#an-raw').innerHTML = '';
    for (const a of ALGOS) for (let r = 0; r < 5; r++) C.GENERATORS[a].fn(60, 60, r); // JIT warm-up
    for (const n of SIZES) {
      const row = { n, cells: n * n };
      for (const a of ALGOS) {
        const fn = C.GENERATORS[a].fn;
        // Repeat until at least 30 ms has passed so timer resolution doesn't dominate.
        let reps = 0;
        const t0 = performance.now();
        while (reps < 3 || (performance.now() - t0 < 30 && reps < 200)) fn(n, n, 100 + reps++);
        row[a] = (performance.now() - t0) / reps;
      }
      const ex = { dfs: 0, bfs: 0, astar: 0 };
      let ratio = 0;
      for (let r = 0; r < REPS; r++) {
        const m = C.braid(C.generateBacktracker(n, n, 500 + r).maze, 0.3, 500 + r);
        const res = {};
        for (const k of svOrder) { res[k] = C.SOLVERS[k].fn(m, 0, m.size - 1); ex[k] += res[k].explored; }
        ratio += res.dfs.path.length / res.bfs.path.length;
      }
      for (const k of svOrder) row[k] = ex[k] / REPS;
      row.ratio = ratio / REPS;
      rows.push(row);
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${n} × ${n}</td><td>${fmt(row.cells)}</td><td>${fmt(row.backtracker, 2)}</td><td>${fmt(row.prim, 2)}</td><td>${fmt(row.kruskal, 2)}</td>` +
        `<td>${fmt(row.dfs)}</td><td>${fmt(row.bfs)}</td><td>${fmt(row.astar)}</td><td>${fmt(row.ratio, 2)}×</td>`;
      $('#an-raw').appendChild(tr);
      drawAnalysisCharts(rows);
      await sleep(10);
    }

    // Character of each algorithm at 40 x 40.
    const charRows = [];
    for (const a of ALGOS) {
      let de = 0, jn = 0, sol = 0, diff = 0, ok = 0;
      const K = 20;
      for (let s = 0; s < K; s++) {
        const m = C.GENERATORS[a].fn(40, 40, 900 + s).maze;
        const z = C.analyze(m);
        de += z.deadEndPct; jn += (100 * z.junctions) / z.cells; sol += z.solutionLength / z.cells; diff += z.difficulty;
        if (C.isPerfect(m)) ok++;
      }
      charRows.push(`<tr><td>${C.GENERATORS[a].label}</td><td>${fmt(de / K, 1)}%</td><td>${fmt(jn / K, 1)}%</td><td>${fmt((100 * sol) / K, 1)}%</td><td>${fmt(diff / K)}</td><td>${ok} / ${K} passed</td></tr>`);
      await sleep(5);
    }
    $('#an-char').innerHTML = charRows.join('');

    // Recursion depth experiment.
    let lastOk = null, failedAt = null;
    for (const n of [25, 50, 75, 100, 125, 150, 200, 250]) {
      try {
        const r = C.generateRecursive(n, n, 7);
        lastOk = { n, depth: r.stats.maxDepth };
      } catch (e) {
        failedAt = n;
        break;
      }
      await sleep(5);
    }
    const t0 = performance.now();
    C.generateBacktracker(300, 300, 7);
    const big = performance.now() - t0;
    $('#an-recursion').textContent =
      (lastOk ? `The truly recursive version worked up to ${lastOk.n} × ${lastOk.n} (deepest call chain ${fmt(lastOk.depth)} calls). ` : '') +
      (failedAt ? `At ${failedAt} × ${failedAt} it crashed with a stack overflow, because the recursion depth can reach the number of cells. ` : 'It did not overflow on this browser up to 250 × 250. ') +
      `The explicit-stack version has no such limit and built a 300 × 300 maze (90,000 cells) in ${fmt(big, 1)} ms.`;
  }

  function drawAnalysisCharts(rows) {
    lineChart($('#an-chart-time'), {
      series: ALGOS.map((a, i) => ({ name: SHORT[a], color: SERIES[i], pts: rows.map((r) => [r.cells, r[a]]) })),
      xLabel: 'Cells (rows × cols)', yLabel: 'ms', yFmt: (v) => fmt(v, v < 1 ? 2 : 1),
      tip: (p, s) => `${s.name}: ${fmt(p[1], 2)} ms at ${fmt(p[0])} cells`,
    });
    legend($('#an-legend-time'), ALGOS.map((a, i) => [SHORT[a], SERIES[i]]));
    lineChart($('#an-chart-explore'), {
      series: svOrder.map((k, i) => ({ name: SHORT[k], color: SERIES[i], pts: rows.map((r) => [r.cells, r[k]]) })),
      xLabel: 'Cells (30% of dead ends opened)', yLabel: 'cells explored',
      tip: (p, s) => `${s.name}: ${fmt(p[1])} explored of ${fmt(p[0])}`,
    });
    legend($('#an-legend-explore'), svOrder.map((k, i) => [SHORT[k], SERIES[i]]));
  }
  redrawers.analyse = () => {};

  function legend(el, items) {
    el.innerHTML = items.map(([n, c]) => `<span><i class="line" style="background:${c}"></i>${n}</span>`).join('');
  }

  let anStarted = false;
  onTab.analyse = () => { if (!anStarted) { anStarted = true; runBenchmark(); } };
  $('#an-run').addEventListener('click', runBenchmark);

  /* ---------- Small SVG line chart ---------- */
  function niceTicks(min, max, count) {
    const span = max - min || 1;
    const step0 = span / count;
    const mag = Math.pow(10, Math.floor(Math.log10(step0)));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= count) || 10 * mag;
    const ticks = [];
    const top = Math.ceil(max / step - 1e-9) * step;
    for (let v = Math.ceil(min / step) * step; v <= top + 1e-9; v += step) ticks.push(+v.toFixed(10));
    return ticks;
  }

  function lineChart(el, o) {
    const W = 520, H = o.height || 280, m = { l: 56, r: 84, t: 26, b: 42 };
    const all = o.series.flatMap((s) => s.pts);
    const xMin = o.xMin ?? 0, xMax = o.xMax ?? Math.max(...all.map((p) => p[0]));
    const yMin = o.yMin ?? 0;
    const yTicks = niceTicks(yMin, o.yMax ?? Math.max(...all.map((p) => p[1])) * 1.05, 5);
    const yMax = o.yMax ?? yTicks[yTicks.length - 1];
    const xTicks = o.xTicks || niceTicks(xMin, xMax, 5);
    const X = (v) => m.l + ((v - xMin) / (xMax - xMin || 1)) * (W - m.l - m.r);
    const Y = (v) => H - m.b - ((v - yMin) / (yMax - yMin || 1)) * (H - m.t - m.b);
    const yf = o.yFmt || ((v) => fmt(v));
    let svg = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${o.yLabel} by ${o.xLabel}">`;
    for (const t of (o.yMax ? niceTicks(yMin, yMax, 5) : yTicks)) {
      svg += `<line class="grid" x1="${m.l}" x2="${W - m.r}" y1="${Y(t)}" y2="${Y(t)}"/><text x="${m.l - 8}" y="${Y(t) + 4}" text-anchor="end">${yf(t)}</text>`;
    }
    for (const t of xTicks) svg += `<text x="${X(t)}" y="${H - m.b + 18}" text-anchor="middle">${fmt(t)}</text>`;
    svg += `<line class="axis" x1="${m.l}" x2="${W - m.r}" y1="${H - m.b}" y2="${H - m.b}"/>`;
    svg += `<text x="${(m.l + W - m.r) / 2}" y="${H - 6}" text-anchor="middle">${o.xLabel}</text>`;
    svg += `<text x="${m.l}" y="12" text-anchor="start">${o.yLabel}</text>`;
    o.series.forEach((s, si) => {
      let d = '';
      s.pts.forEach((p, i) => {
        if (s.step && i) d += `H${X(p[0])}V${Y(p[1])}`;
        else d += `${i ? 'L' : 'M'}${X(p[0])},${Y(p[1])}`;
      });
      svg += `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round"/>`;
      s.pts.forEach((p, i) => {
        svg += `<circle cx="${X(p[0])}" cy="${Y(p[1])}" r="4" fill="${s.color}" stroke="var(--surface)" stroke-width="2"/>`;
        svg += `<circle class="hit" data-s="${si}" data-i="${i}" cx="${X(p[0])}" cy="${Y(p[1])}" r="12" fill="transparent"/>`;
      });
      if (o.series.length > 1 && s.pts.length) {
        const last = s.pts[s.pts.length - 1];
        svg += `<text x="${X(last[0]) + 10}" y="${Y(last[1]) + 4 + (si - 1) * 0}" style="fill:var(--ink)">${s.name}</text>`;
      }
    });
    svg += '</svg>';
    el.innerHTML = svg;
    $('#tip').hidden = true;
    // De-overlap direct labels.
    const labels = Array.from(el.querySelectorAll('svg > text[style]'));
    labels.sort((a, b) => a.getAttribute('y') - b.getAttribute('y'));
    for (let i = 1; i < labels.length; i++) {
      const prev = +labels[i - 1].getAttribute('y'), cur = +labels[i].getAttribute('y');
      if (cur - prev < 13) labels[i].setAttribute('y', prev + 13);
    }
    const tip = $('#tip');
    el.querySelectorAll('.hit').forEach((c) => {
      c.addEventListener('pointerenter', (e) => {
        const s = o.series[+c.dataset.s], p = s.pts[+c.dataset.i];
        tip.textContent = o.tip ? o.tip(p, s) : `${p[0]}, ${p[1]}`;
        tip.hidden = false;
        tip.style.left = e.clientX + 12 + 'px';
        tip.style.top = e.clientY - 30 + 'px';
      });
      c.addEventListener('pointerleave', () => { tip.hidden = true; });
    });
  }

  /* ---------- Start ---------- */
  let saved = null;
  try { saved = localStorage.getItem('mazemind-tab'); } catch (e) { /* storage unavailable */ }
  const hash = (location.hash || '').slice(1);
  showTab(views[hash] ? hash : views[saved] ? saved : 'assess');
  let rz = 0;
  window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(redrawAll, 150); });
})();
