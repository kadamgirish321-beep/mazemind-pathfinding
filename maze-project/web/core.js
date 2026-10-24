/*
 * MazeMind core: maze generation, solving, metrics and the adaptive assessment logic.
 * Pure functions with no DOM access, so the same file runs in the browser and in Node tests.
 *
 * Grid model: rows x cols cells, cell id i = r * cols + c.
 * Each cell stores its four walls as a bitmask (N=1, E=2, S=4, W=8).
 * A maze is a graph: cells are vertices, removed walls are edges.
 */
(function (global) {
  'use strict';

  const N = 1, E = 2, S = 4, W = 8;
  const DIRS = [
    { name: 'N', bit: N, dr: -1, dc: 0, opp: S },
    { name: 'E', bit: E, dr: 0, dc: 1, opp: W },
    { name: 'S', bit: S, dr: 1, dc: 0, opp: N },
    { name: 'W', bit: W, dr: 0, dc: -1, opp: E },
  ];
  const DIR = { N: DIRS[0], E: DIRS[1], S: DIRS[2], W: DIRS[3] };

  // Seeded PRNG (mulberry32) so every maze can be regenerated from its seed.
  function makeRng(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function shuffle(arr, rand) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  class Maze {
    constructor(rows, cols) {
      this.rows = rows;
      this.cols = cols;
      this.size = rows * cols;
      this.walls = new Uint8Array(this.size).fill(N | E | S | W);
    }
    id(r, c) { return r * this.cols + c; }
    row(i) { return Math.floor(i / this.cols); }
    col(i) { return i % this.cols; }
    neighbor(i, d) {
      const r = this.row(i) + d.dr, c = this.col(i) + d.dc;
      return r >= 0 && r < this.rows && c >= 0 && c < this.cols ? this.id(r, c) : -1;
    }
    dirBetween(a, b) {
      for (const d of DIRS) if (this.neighbor(a, d) === b) return d;
      return null;
    }
    removeWall(a, d) {
      const b = this.neighbor(a, d);
      this.walls[a] &= ~d.bit;
      this.walls[b] &= ~d.opp;
      return b;
    }
    canMove(i, d) { return !(this.walls[i] & d.bit) && this.neighbor(i, d) !== -1; }
    // Cells reachable in one step (open passages).
    open(i) {
      const out = [];
      for (const d of DIRS) if (!(this.walls[i] & d.bit)) out.push(this.neighbor(i, d));
      return out;
    }
    degree(i) { return this.open(i).length; }
    passages() {
      let e = 0;
      for (let i = 0; i < this.size; i++) {
        if (!(this.walls[i] & E) && this.col(i) < this.cols - 1) e++;
        if (!(this.walls[i] & S) && this.row(i) < this.rows - 1) e++;
      }
      return e;
    }
    clone() {
      const m = new Maze(this.rows, this.cols);
      m.walls.set(this.walls);
      return m;
    }
  }

  /* ------------------------------------------------------------------ */
  /* Generators                                                           */
  /* ------------------------------------------------------------------ */

  // Recursive backtracker (randomised DFS), written with real recursion.
  // Depth can reach rows*cols, so large grids overflow the call stack.
  function generateRecursive(rows, cols, seed) {
    const rand = makeRng(seed);
    const m = new Maze(rows, cols);
    const visited = new Uint8Array(m.size);
    let maxDepth = 0;
    function carve(cur, depth) {
      visited[cur] = 1;
      if (depth > maxDepth) maxDepth = depth;
      for (const d of shuffle(DIRS.slice(), rand)) {
        const n = m.neighbor(cur, d);
        if (n !== -1 && !visited[n]) {
          m.removeWall(cur, d);
          carve(n, depth + 1);
        }
      }
    }
    carve(0, 1);
    return { maze: m, stats: { maxDepth } };
  }

  // Recursive backtracker with an explicit stack. Same idea, no recursion limit.
  // steps (when recorded): [0, from, to] = carve forward, [1, cell, backTo] = backtrack.
  function generateBacktracker(rows, cols, seed, record) {
    const rand = makeRng(seed);
    const m = new Maze(rows, cols);
    const visited = new Uint8Array(m.size);
    const steps = record ? [] : null;
    const stack = [0];
    visited[0] = 1;
    let backtracks = 0, maxDepth = 1;
    const options = [];
    while (stack.length) {
      const cur = stack[stack.length - 1];
      options.length = 0;
      for (const d of DIRS) {
        const n = m.neighbor(cur, d);
        if (n !== -1 && !visited[n]) options.push(d);
      }
      if (options.length) {
        const d = options[Math.floor(rand() * options.length)];
        const next = m.removeWall(cur, d);
        visited[next] = 1;
        stack.push(next);
        if (stack.length > maxDepth) maxDepth = stack.length;
        if (steps) steps.push([0, cur, next]);
      } else {
        stack.pop();
        backtracks++;
        if (steps) steps.push([1, cur, stack.length ? stack[stack.length - 1] : -1]);
      }
    }
    return { maze: m, steps, stats: { backtracks, maxDepth } };
  }

  // Randomised Prim's algorithm (greedy MST growth with random weights).
  function generatePrim(rows, cols, seed, record) {
    const rand = makeRng(seed);
    const m = new Maze(rows, cols);
    const inMaze = new Uint8Array(m.size);
    const frontier = [];
    const steps = record ? [] : null;
    function add(i) {
      inMaze[i] = 1;
      for (const d of DIRS) {
        const n = m.neighbor(i, d);
        if (n !== -1 && !inMaze[n]) frontier.push([i, d]);
      }
    }
    add(0);
    while (frontier.length) {
      const k = Math.floor(rand() * frontier.length);
      const [i, d] = frontier[k];
      frontier[k] = frontier[frontier.length - 1];
      frontier.pop();
      const n = m.neighbor(i, d);
      if (inMaze[n]) continue;
      m.removeWall(i, d);
      if (steps) steps.push([0, i, n]);
      add(n);
    }
    return { maze: m, steps, stats: {} };
  }

  // Randomised Kruskal's algorithm with union-find (greedy MST over shuffled edges).
  function generateKruskal(rows, cols, seed, record) {
    const rand = makeRng(seed);
    const m = new Maze(rows, cols);
    const parent = new Int32Array(m.size);
    const rank = new Uint8Array(m.size);
    for (let i = 0; i < m.size; i++) parent[i] = i;
    const find = (x) => {
      while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; }
      return x;
    };
    const edges = [];
    for (let i = 0; i < m.size; i++) {
      if (m.col(i) < cols - 1) edges.push([i, E]);
      if (m.row(i) < rows - 1) edges.push([i, S]);
    }
    shuffle(edges, rand);
    const steps = record ? [] : null;
    let joined = 0;
    for (const [i, bit] of edges) {
      const d = bit === E ? DIR.E : DIR.S;
      const n = m.neighbor(i, d);
      let a = find(i), b = find(n);
      if (a === b) continue;
      if (rank[a] < rank[b]) { const t = a; a = b; b = t; }
      parent[b] = a;
      if (rank[a] === rank[b]) rank[a]++;
      m.removeWall(i, d);
      if (steps) steps.push([0, i, n]);
      if (++joined === m.size - 1) break;
    }
    return { maze: m, steps, stats: {} };
  }

  const GENERATORS = {
    backtracker: { label: 'Recursive backtracker', fn: generateBacktracker },
    prim: { label: "Randomised Prim's", fn: generatePrim },
    kruskal: { label: "Randomised Kruskal's", fn: generateKruskal },
  };

  // Turn some dead ends into loops so the maze has more than one route.
  function braid(maze, fraction, seed) {
    const m = maze.clone();
    const rand = makeRng(seed ^ 0x9e3779b9);
    const dead = [];
    for (let i = 0; i < m.size; i++) if (m.degree(i) === 1) dead.push(i);
    shuffle(dead, rand);
    const target = Math.round(dead.length * fraction);
    let removed = 0;
    for (const i of dead) {
      if (removed >= target) break;
      if (m.degree(i) !== 1) continue;
      const closed = DIRS.filter((d) => (m.walls[i] & d.bit) && m.neighbor(i, d) !== -1);
      if (!closed.length) continue;
      m.removeWall(i, closed[Math.floor(rand() * closed.length)]);
      removed++;
    }
    return m;
  }

  // A perfect maze is a spanning tree: connected, and exactly cells-1 passages.
  function isPerfect(m) {
    if (m.passages() !== m.size - 1) return false;
    return bfs(m, 0, -1).reached === m.size;
  }

  /* ------------------------------------------------------------------ */
  /* Solvers. All return { path, explored, events }                       */
  /* events: [0, cell] = cell explored, [1, cell] = cell abandoned (DFS)  */
  /* ------------------------------------------------------------------ */

  function solveDFS(m, start, goal) {
    const visited = new Uint8Array(m.size);
    const stack = [start];
    const events = [[0, start]];
    visited[start] = 1;
    let explored = 1;
    while (stack.length) {
      const cur = stack[stack.length - 1];
      if (cur === goal) break;
      let next = -1;
      for (const d of DIRS) {
        if (m.walls[cur] & d.bit) continue;
        const n = m.neighbor(cur, d);
        if (!visited[n]) { next = n; break; }
      }
      if (next !== -1) {
        visited[next] = 1;
        stack.push(next);
        explored++;
        events.push([0, next]);
      } else {
        stack.pop();
        events.push([1, cur]);
      }
    }
    return { path: stack.slice(), explored, events };
  }

  function bfs(m, start, goal) {
    const parent = new Int32Array(m.size).fill(-1);
    const seen = new Uint8Array(m.size);
    const queue = new Int32Array(m.size);
    let head = 0, tail = 0;
    queue[tail++] = start;
    seen[start] = 1;
    const events = [];
    while (head < tail) {
      const cur = queue[head++];
      events.push([0, cur]);
      if (cur === goal) break;
      for (const n of m.open(cur)) {
        if (!seen[n]) { seen[n] = 1; parent[n] = cur; queue[tail++] = n; }
      }
    }
    return { parent, events, reached: tail, explored: head };
  }

  function tracePath(parent, start, goal) {
    if (goal !== start && parent[goal] === -1) return [];
    const path = [];
    for (let c = goal; c !== -1; c = c === start ? -1 : parent[c]) path.push(c);
    return path.reverse();
  }

  function solveBFS(m, start, goal) {
    const r = bfs(m, start, goal);
    return { path: tracePath(r.parent, start, goal), explored: r.explored, events: r.events };
  }

  function solveAStar(m, start, goal) {
    const gr = m.row(goal), gc = m.col(goal);
    const h = (i) => Math.abs(m.row(i) - gr) + Math.abs(m.col(i) - gc);
    const g = new Int32Array(m.size).fill(0x7fffffff);
    const parent = new Int32Array(m.size).fill(-1);
    const closed = new Uint8Array(m.size);
    const heap = []; // entries [f, h, cell], ordered by f then h
    const less = (a, b) => a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]);
    const push = (x) => {
      heap.push(x);
      let i = heap.length - 1;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (!less(heap[i], heap[p])) break;
        [heap[i], heap[p]] = [heap[p], heap[i]];
        i = p;
      }
    };
    const pop = () => {
      const top = heap[0], last = heap.pop();
      if (heap.length) {
        heap[0] = last;
        let i = 0;
        for (;;) {
          const l = 2 * i + 1, r = l + 1;
          let s = i;
          if (l < heap.length && less(heap[l], heap[s])) s = l;
          if (r < heap.length && less(heap[r], heap[s])) s = r;
          if (s === i) break;
          [heap[i], heap[s]] = [heap[s], heap[i]];
          i = s;
        }
      }
      return top;
    };
    g[start] = 0;
    push([h(start), h(start), start]);
    const events = [];
    let explored = 0;
    while (heap.length) {
      const [, , cur] = pop();
      if (closed[cur]) continue;
      closed[cur] = 1;
      explored++;
      events.push([0, cur]);
      if (cur === goal) break;
      for (const n of m.open(cur)) {
        const ng = g[cur] + 1;
        if (ng < g[n]) { g[n] = ng; parent[n] = cur; push([ng + h(n), h(n), n]); }
      }
    }
    return { path: tracePath(parent, start, goal), explored, events };
  }

  const SOLVERS = {
    dfs: { label: 'Backtracking (DFS)', fn: solveDFS },
    bfs: { label: 'Breadth-first search', fn: solveBFS },
    astar: { label: 'A* search', fn: solveAStar },
  };

  /* ------------------------------------------------------------------ */
  /* Maze metrics and difficulty                                          */
  /* ------------------------------------------------------------------ */

  // Difficulty = L + 3J, where L is the shortest path length (cells) and
  // J is the number of decision points on it (cells offering 2+ new exits).
  function analyze(m) {
    let deadEnds = 0, junctions = 0;
    for (let i = 0; i < m.size; i++) {
      const d = m.degree(i);
      if (d === 1) deadEnds++;
      else if (d >= 3) junctions++;
    }
    const path = solveBFS(m, 0, m.size - 1).path;
    let decisions = 0, turns = 0;
    for (let k = 0; k < path.length - 1; k++) {
      const exits = m.degree(path[k]) - (k === 0 ? 0 : 1);
      if (exits >= 2) decisions++;
      if (k > 0) {
        const d1 = m.dirBetween(path[k - 1], path[k]);
        const d2 = m.dirBetween(path[k], path[k + 1]);
        if (d1 !== d2) turns++;
      }
    }
    return {
      cells: m.size,
      deadEnds,
      deadEndPct: (100 * deadEnds) / m.size,
      junctions,
      solutionLength: path.length,
      decisions,
      turns,
      difficulty: path.length + 3 * decisions,
      path,
    };
  }

  /* ------------------------------------------------------------------ */
  /* Adaptive assessment                                                  */
  /* ------------------------------------------------------------------ */

  const LEVEL_SIZES = [5, 7, 9, 11, 13, 15, 17, 20, 23, 26];
  const MAX_LEVEL = LEVEL_SIZES.length;
  const CANDIDATES = 9;

  // Build several mazes for the level and keep the median-difficulty one,
  // so two trials at the same level are comparably hard.
  function buildTrialMaze(level, seed) {
    const n = LEVEL_SIZES[level - 1];
    const pool = [];
    for (let k = 0; k < CANDIDATES; k++) {
      const s = (seed + k * 7919) >>> 0;
      const maze = generateBacktracker(n, n, s).maze;
      pool.push({ maze, seed: s, metrics: analyze(maze) });
    }
    pool.sort((a, b) => a.metrics.difficulty - b.metrics.difficulty);
    const pick = pool[Math.floor(pool.length / 2)];
    return {
      level, size: n, ...pick,
      difficultyRange: [pool[0].metrics.difficulty, pool[pool.length - 1].metrics.difficulty],
    };
  }

  // trail: the list of cells the person stepped on, starting at 0.
  function scoreTrial(m, solution, trail, timing) {
    const onPath = new Uint8Array(m.size);
    for (const c of solution) onPath[c] = 1;
    const seen = new Uint8Array(m.size);
    seen[trail[0]] = 1;
    let wrongTurns = 0, revisits = 0;
    const offPath = new Set();
    for (let k = 1; k < trail.length; k++) {
      const prev = trail[k - 1], cur = trail[k];
      if (onPath[prev] && !onPath[cur]) wrongTurns++;
      if (!onPath[cur]) offPath.add(cur);
      if (seen[cur]) revisits++;
      seen[cur] = 1;
    }
    const moves = trail.length - 1;
    const optimal = solution.length - 1;
    const efficiency = moves > 0 ? Math.min(1, optimal / moves) : 0;
    const score = Math.max(0, Math.round(100 * efficiency - 8 * wrongTurns - 2 * (timing.wallBumps || 0)));
    return {
      moves, optimal, efficiency, wrongTurns, revisits,
      wallBumps: timing.wallBumps || 0,
      planningMs: timing.planningMs,
      totalMs: timing.totalMs,
      score,
      offPath: Array.from(offPath),
    };
  }

  // Staircase rule: a clean, efficient solve moves up; a poor one moves down.
  function nextLevel(level, r) {
    if (r.wrongTurns === 0 && r.efficiency >= 0.85) return Math.min(MAX_LEVEL, level + 1);
    if (r.wrongTurns >= 3 || r.efficiency < 0.5) return Math.max(1, level - 1);
    return level;
  }

  function summarize(trials) {
    const n = trials.length;
    const mean = (f) => trials.reduce((s, t) => s + f(t), 0) / n;
    const peak = Math.max(...trials.map((t) => t.level));
    const last = trials[n - 1];
    const finalLevel = nextLevel(last.level, last);
    const meanEff = mean((t) => t.efficiency);
    const errors = trials.reduce((s, t) => s + t.wrongTurns, 0);
    let band;
    if (finalLevel >= 7 && meanEff >= 0.75) band = 'Strong planning';
    else if (finalLevel >= 4 && meanEff >= 0.55) band = 'Typical planning';
    else band = 'Needs practice';
    return {
      trials: n, peak, finalLevel, meanEff, errors,
      meanPlanningMs: mean((t) => t.planningMs),
      meanScore: mean((t) => t.score),
      band,
    };
  }

  // Simulated participant for demos: walks like a person exploring by DFS.
  // At each fork it takes the correct branch with probability `skill`.
  function simulateParticipant(m, solution, skill, seed) {
    const rand = makeRng(seed);
    const nextOnPath = new Int32Array(m.size).fill(-1);
    for (let k = 0; k < solution.length - 1; k++) nextOnPath[solution[k]] = solution[k + 1];
    const goal = m.size - 1;
    const visited = new Uint8Array(m.size);
    const stack = [0];
    const trail = [0];
    visited[0] = 1;
    while (stack[stack.length - 1] !== goal) {
      const cur = stack[stack.length - 1];
      const fresh = m.open(cur).filter((n) => !visited[n]);
      if (!fresh.length) {
        stack.pop();
        trail.push(stack[stack.length - 1]);
        continue;
      }
      const right = nextOnPath[cur];
      let pick;
      if (right !== -1 && !visited[right]) {
        const others = fresh.filter((n) => n !== right);
        pick = !others.length || rand() < skill ? right : others[Math.floor(rand() * others.length)];
      } else {
        pick = fresh[Math.floor(rand() * fresh.length)];
      }
      visited[pick] = 1;
      stack.push(pick);
      trail.push(pick);
    }
    const planningMs = Math.round(700 + rand() * 900 + (1 - skill) * 1200);
    const totalMs = planningMs + Math.round((trail.length - 1) * (170 + rand() * 90));
    return { trail, planningMs, totalMs };
  }

  const api = {
    N, E, S, W, DIRS, DIR, Maze, makeRng, shuffle,
    generateRecursive, generateBacktracker, generatePrim, generateKruskal, GENERATORS,
    braid, isPerfect, solveDFS, solveBFS, solveAStar, SOLVERS, analyze,
    LEVEL_SIZES, MAX_LEVEL, buildTrialMaze, scoreTrial, nextLevel, summarize, simulateParticipant,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.MazeCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
