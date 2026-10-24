# MazeMind: Adaptive Maze Generation using Backtracking for Cognitive Skill Assessment

CS3101 Design and Analysis of Algorithms course project (syllabus topic: *Creation of Maze using backtracking*).

Every test maze is generated fresh by a recursive backtracker. Its difficulty is measured with BFS, and the next maze adapts to how well the person solved the last one. That gives a maze-based planning test that can't be memorised.

## How to run

**Web app (main demo).** Open `web/index.html` in Chrome, Edge or Firefox. There's nothing to install, and it works offline (fonts fall back to system fonts).

**Python version** (Python 3.8+):

```
cd python
python maze.py --size 12 --seed 7      # print a maze and its shortest route
python -m unittest test_maze.py        # 18 correctness tests
pip install matplotlib                 # only needed for charts
python benchmark.py                    # regenerate results/ (about 15 s)
```

**JavaScript tests** (Node 16+, nothing to install): `cd web` then `node test_core.js` runs 16 tests on the algorithms in `core.js`.

## What's in the folder

| Path | Contents |
|---|---|
| `web/index.html` | The app: page layout and styles |
| `web/core.js` | All algorithms: backtracker (recursive and stack), Prim's, Kruskal's, DFS, BFS, A*, difficulty metric, scoring, staircase rule |
| `web/app.js` | User interface: assessment, animation, solver race, live benchmark |
| `web/test_core.js` | Unit tests for `core.js` (run with Node) |
| `python/maze.py` | The same algorithms in Python, with an ASCII command-line demo |
| `python/benchmark.py` | Experiments behind the report's tables and charts |
| `python/test_maze.py` | Unit tests (perfect-maze property, solver correctness, scoring, edge cases) |
| `results/` | Benchmark CSVs, console output and charts |
| `REPORT.md` | Project report: problem, algorithms, proof, complexity, results, viva questions |

## The app's four screens

1. **Assessment.** Six adaptive maze trials, solved with the arrow keys, WASD, swipes or the on-screen buttons. After a trial, press Enter for the next maze. After each trial, the shortest route is shown in green and wrong turns in orange. The examiner's record table and the session summary fill in as you go. *Run simulated participant* plays all six trials automatically.
2. **How mazes are built.** An animation of the backtracker, showing the stack (yellow), the current cell (blue), the live pseudocode line, and counters for stack depth and backtracks. You can switch to Prim's or Kruskal's for comparison.
3. **Solver comparison.** Backtracking (DFS), BFS and A* run side by side on the same maze with adjustable loops. Each shows the cells it explored and the path length it found.
4. **Complexity analysis.** A live benchmark: generation time vs cells, cells explored per solver, maze character per algorithm, and the recursion-depth experiment.

## Suggested 5-minute presentation

1. **Problem (30 s).** Maze tests measure planning ability, but printed tests are fixed and can be memorised.
2. **Generation (90 s).** On screen 2, press *Animate* at a slow speed and point out the stack growing and the backtracking. Show the pseudocode highlight, then the finished maze's "Perfect maze: Yes".
3. **Correctness and complexity (60 s).** The output is a spanning tree (no cycles, all cells reached), and the algorithm runs in Θ(R·C). Show the straight line on screen 4 and the recursion overflow result.
4. **Assessment (90 s).** Let a faculty member solve one maze on screen 1, then run the simulated participant to show the level adapting.
5. **Solvers (30 s).** On screen 3, backtracking finds *a* path, while BFS and A* find the shortest one.

The report's Appendix A lists likely viva questions with answers.
