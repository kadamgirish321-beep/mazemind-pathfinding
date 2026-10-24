/* Unit tests for core.js. Run: node test_core.js (Node 16+, no packages needed). */
'use strict';
const assert = require('node:assert/strict');
const C = require('./core.js');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('ok   ' + name); } catch (e) { console.log('FAIL ' + name); throw e; }
}
const goalOf = (m) => m.size - 1;
const isWalk = (m, path) => path.slice(1).every((c, k) => m.open(path[k]).includes(c));

test('every generator makes a perfect maze on 30 grid shapes', () => {
  for (const [name, g] of Object.entries(C.GENERATORS)) {
    for (let seed = 0; seed < 30; seed++) {
      const rows = 1 + (seed % 17), cols = 1 + ((seed * 7) % 13);
      assert.ok(C.isPerfect(g.fn(rows, cols, seed).maze), `${name} ${rows}x${cols} seed ${seed}`);
    }
  }
});

test('recursive and explicit-stack backtrackers both make perfect mazes', () => {
  assert.ok(C.isPerfect(C.generateRecursive(20, 20, 3).maze));
  assert.ok(C.isPerfect(C.generateBacktracker(20, 20, 3).maze));
});

test('same seed gives the same maze', () => {
  const a = C.generateBacktracker(15, 15, 42).maze, b = C.generateBacktracker(15, 15, 42).maze;
  assert.deepEqual(Array.from(a.walls), Array.from(b.walls));
});

test('backtracker stats: V backtracks, stack depth within bounds', () => {
  const r = C.generateBacktracker(12, 9, 5);
  assert.equal(r.stats.backtracks, 12 * 9);
  assert.ok(r.stats.maxDepth >= 1 && r.stats.maxDepth <= 12 * 9);
});

test('recorded steps replay to the final maze', () => {
  for (const g of Object.values(C.GENERATORS)) {
    const r = g.fn(10, 10, 9, true);
    const m = new C.Maze(10, 10);
    for (const s of r.steps) if (s[0] === 0) m.removeWall(s[1], m.dirBetween(s[1], s[2]));
    assert.deepEqual(Array.from(m.walls), Array.from(r.maze.walls));
  }
});

test('all solvers agree on a perfect maze', () => {
  for (let seed = 0; seed < 20; seed++) {
    const m = C.generateBacktracker(18, 18, seed).maze;
    const lens = Object.values(C.SOLVERS).map((s) => s.fn(m, 0, goalOf(m)).path.length);
    assert.equal(new Set(lens).size, 1);
  }
});

test('BFS and A* find the shortest route when the maze has loops', () => {
  for (let seed = 0; seed < 20; seed++) {
    const m = C.braid(C.generateBacktracker(20, 20, seed).maze, 0.5, seed);
    const d = C.solveDFS(m, 0, goalOf(m)), b = C.solveBFS(m, 0, goalOf(m)), a = C.solveAStar(m, 0, goalOf(m));
    assert.equal(a.path.length, b.path.length);
    assert.ok(b.path.length <= d.path.length);
    for (const p of [d.path, b.path, a.path]) {
      assert.equal(p[0], 0); assert.equal(p[p.length - 1], goalOf(m)); assert.ok(isWalk(m, p));
    }
  }
});

test('unreachable goal gives an empty path; start = goal gives one cell', () => {
  const closed = new C.Maze(3, 3);
  for (const s of Object.values(C.SOLVERS)) {
    assert.deepEqual(s.fn(closed, 0, 8).path, []);
    assert.deepEqual(s.fn(closed, 4, 4).path, [4]);
  }
});

test('braid leaves the original maze untouched', () => {
  const m = C.generateBacktracker(10, 10, 4).maze, before = Array.from(m.walls);
  assert.deepEqual(Array.from(C.braid(m, 0, 4).walls), before);
  assert.ok(C.braid(m, 1, 4).passages() > m.passages());
  assert.deepEqual(Array.from(m.walls), before);
});

test('difficulty is L + 3J and trial maze is the median candidate', () => {
  const t = C.buildTrialMaze(4, 123);
  assert.equal(t.metrics.difficulty, t.metrics.solutionLength + 3 * t.metrics.decisions);
  assert.ok(t.metrics.difficulty >= t.difficultyRange[0] && t.metrics.difficulty <= t.difficultyRange[1]);
  assert.equal(t.size, C.LEVEL_SIZES[3]);
});

test('score formula: 100 x efficiency - 8 x wrong turns - 2 x bumps, floored at 0', () => {
  const t = C.buildTrialMaze(3, 11), sol = t.metrics.path;
  assert.equal(C.scoreTrial(t.maze, sol, sol, { wallBumps: 0 }).score, 100);
  assert.equal(C.scoreTrial(t.maze, sol, sol, { wallBumps: 3 }).score, 94);
  assert.equal(C.scoreTrial(t.maze, sol, sol, { wallBumps: 80 }).score, 0);
  const m = C.generateBacktracker(1, 2, 0).maze;      // 12.5 rounds half up, same as Python
  assert.equal(C.scoreTrial(m, [0, 1], [0, 1, 0, 1, 0, 1, 0, 1, 0], {}).score, 13);
});

test('a detour into a side branch counts one wrong turn', () => {
  const t = C.buildTrialMaze(4, 3), sol = t.metrics.path, on = new Set(sol);
  const k = sol.findIndex((c) => t.maze.open(c).some((n) => !on.has(n)));
  assert.ok(k >= 0);
  const off = t.maze.open(sol[k]).find((n) => !on.has(n));
  const trail = [...sol.slice(0, k + 1), off, sol[k], ...sol.slice(k + 1)];
  const r = C.scoreTrial(t.maze, sol, trail, {});
  assert.equal(r.wrongTurns, 1);
  assert.deepEqual(r.offPath, [off]);
  assert.ok(r.efficiency < 1);
});

test('staircase rule moves up, stays and moves down within 1..10', () => {
  assert.equal(C.nextLevel(3, { wrongTurns: 0, efficiency: 0.9 }), 4);
  assert.equal(C.nextLevel(10, { wrongTurns: 0, efficiency: 1 }), 10);
  assert.equal(C.nextLevel(5, { wrongTurns: 1, efficiency: 0.7 }), 5);
  assert.equal(C.nextLevel(5, { wrongTurns: 3, efficiency: 0.9 }), 4);
  assert.equal(C.nextLevel(1, { wrongTurns: 0, efficiency: 0.4 }), 1);
});

test('summary bands follow final level and mean efficiency', () => {
  const trial = (level, efficiency, wrongTurns) => ({ level, efficiency, wrongTurns, planningMs: 1000, score: 80 });
  assert.equal(C.summarize([trial(7, 0.9, 0)]).band, 'Strong planning');   // final level 8
  assert.equal(C.summarize([trial(4, 0.6, 1)]).band, 'Typical planning');
  assert.equal(C.summarize([trial(2, 0.4, 4)]).band, 'Needs practice');
  assert.equal(C.summarize([trial(3, 0.9, 0), trial(4, 0.5, 2)]).errors, 2);
});

test('simulated participant always reaches the exit by legal moves', () => {
  for (let seed = 0; seed < 30; seed++) {
    const t = C.buildTrialMaze(1 + (seed % 10), seed * 31);
    const s = C.simulateParticipant(t.maze, t.metrics.path, 0.4 + (seed % 7) * 0.09, seed);
    assert.equal(s.trail[0], 0);
    assert.equal(s.trail[s.trail.length - 1], goalOf(t.maze));
    assert.ok(isWalk(t.maze, s.trail));
    assert.ok(s.totalMs > s.planningMs);
  }
});

test('deep recursion overflows with a catchable error, explicit stack does not', () => {
  assert.throws(() => C.generateRecursive(400, 400, 7), RangeError);
  assert.ok(C.isPerfect(C.generateBacktracker(300, 300, 7).maze));
});

console.log(`\n${passed} tests passed`);
