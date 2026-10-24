"""
Benchmark for the project report.

Measures, for n x n grids:
  * generation time of the three generators (should grow linearly in cells)
  * cells explored and path length of DFS (backtracking), BFS and A* on mazes
    where 30% of dead ends were opened (so several routes exist)
  * maze character (dead ends, junctions, difficulty) of each generator
  * how far the truly recursive generator gets before Python's recursion limit

Writes CSV files and PNG charts to ../results/.
Usage: python benchmark.py
"""

import csv
import os
import sys
import time

import maze as M

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "results")
SIZES = [10, 20, 40, 60, 80, 100, 140, 200]
SOLVE_REPS = 5
COLORS = {"backtracker": "#2a78d6", "prim": "#eb6834", "kruskal": "#1baf7a",
          "dfs": "#2a78d6", "bfs": "#eb6834", "astar": "#1baf7a"}
LABELS = {"backtracker": "Recursive backtracker", "prim": "Randomised Prim's",
          "kruskal": "Randomised Kruskal's", "dfs": "Backtracking (DFS)",
          "bfs": "Breadth-first search", "astar": "A* search"}


def time_generator(fn, n):
    """Mean seconds per maze, repeating until at least 0.2 s of work."""
    reps, start = 0, time.perf_counter()
    while reps < 3 or time.perf_counter() - start < 0.2:
        fn(n, n, 100 + reps)
        reps += 1
    return (time.perf_counter() - start) / reps


def run():
    os.makedirs(OUT, exist_ok=True)
    rows = []
    for n in SIZES:
        row = {"n": n, "cells": n * n}
        for name, fn in M.GENERATORS.items():
            row[f"{name}_ms"] = 1000 * time_generator(fn, n)
        explored = {k: 0 for k in M.SOLVERS}
        ratio = 0.0
        for r in range(SOLVE_REPS):
            base, _ = M.generate_backtracker(n, n, 500 + r)
            m = M.braid(base, 0.3, 500 + r)
            lengths = {}
            for k, solver in M.SOLVERS.items():
                path, ex = solver(m, 0, m.size - 1)
                explored[k] += ex
                lengths[k] = len(path)
            ratio += lengths["dfs"] / lengths["bfs"]
        for k in M.SOLVERS:
            row[f"{k}_explored"] = explored[k] / SOLVE_REPS
        row["dfs_path_over_shortest"] = ratio / SOLVE_REPS
        rows.append(row)
        print(f"{n:>4} x {n:<4} backtracker {row['backtracker_ms']:8.2f} ms   "
              f"prim {row['prim_ms']:8.2f} ms   kruskal {row['kruskal_ms']:8.2f} ms   "
              f"explored dfs/bfs/a* {row['dfs_explored']:.0f}/{row['bfs_explored']:.0f}/{row['astar_explored']:.0f}   "
              f"dfs path {row['dfs_path_over_shortest']:.2f}x shortest")

    with open(os.path.join(OUT, "benchmark.csv"), "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0]))
        w.writeheader()
        w.writerows(rows)

    # Maze character at 40 x 40, 20 seeds each.
    character = []
    for name, fn in M.GENERATORS.items():
        stats = [M.analyze(fn(40, 40, 900 + s)) for s in range(20)]
        perfect = sum(M.is_perfect(fn(40, 40, 900 + s)) for s in range(20))
        k = len(stats)
        character.append({
            "algorithm": LABELS[name],
            "dead_end_pct": round(sum(s["dead_end_pct"] for s in stats) / k, 1),
            "junction_pct": round(sum(100 * s["junctions"] / 1600 for s in stats) / k, 1),
            "solution_pct_of_cells": round(sum(100 * s["solution_length"] / 1600 for s in stats) / k, 1),
            "mean_difficulty": round(sum(s["difficulty"] for s in stats) / k),
            "perfect_mazes": f"{perfect}/20",
        })
    with open(os.path.join(OUT, "maze_character.csv"), "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(character[0]))
        w.writeheader()
        w.writerows(character)
    print("\nMaze character (40 x 40, 20 mazes each)")
    for c in character:
        print(f"  {c['algorithm']:<24} dead ends {c['dead_end_pct']:5.1f}%  junctions {c['junction_pct']:5.1f}%  "
              f"solution {c['solution_pct_of_cells']:5.1f}% of cells  difficulty {c['mean_difficulty']:4}  "
              f"perfect {c['perfect_mazes']}")

    # Recursion limit experiment.
    limit = sys.getrecursionlimit()
    last_ok, failed = None, None
    for n in [10, 20, 30, 40, 50, 60]:
        try:
            M.generate_recursive(n, n, 7)
            last_ok = n
        except RecursionError:
            failed = n
            break
    print(f"\nRecursive version (Python recursion limit {limit}): worked up to {last_ok} x {last_ok}, "
          f"RecursionError at {failed} x {failed}.")
    _, st = M.generate_backtracker(300, 300, 7)
    print(f"Explicit-stack version built 300 x 300 fine (max stack depth {st['max_depth']}).")

    charts(rows)


def charts(rows):
    try:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
    except ImportError:
        print("matplotlib not installed: skipped charts (pip install matplotlib)")
        return

    plt.rcParams.update({"font.size": 10, "axes.spines.top": False, "axes.spines.right": False,
                         "axes.grid": True, "grid.color": "#e3e3e0", "grid.linewidth": 0.8})
    cells = [r["cells"] for r in rows]

    def save(fig, name):
        fig.tight_layout()
        fig.savefig(os.path.join(OUT, name), dpi=160)
        plt.close(fig)

    fig, ax = plt.subplots(figsize=(6.4, 4))
    for k in M.GENERATORS:
        ax.plot(cells, [r[f"{k}_ms"] for r in rows], marker="o", ms=4, lw=2, color=COLORS[k], label=LABELS[k])
    ax.set_xlabel("Cells (rows x cols)")
    ax.set_ylabel("Generation time (ms)")
    ax.set_title("Generation time grows linearly with the number of cells")
    ax.legend(frameon=False)
    save(fig, "generation_time.png")

    fig, ax = plt.subplots(figsize=(6.4, 4))
    for k in M.SOLVERS:
        ax.plot(cells, [r[f"{k}_explored"] for r in rows], marker="o", ms=4, lw=2, color=COLORS[k], label=LABELS[k])
    ax.set_xlabel("Cells (30% of dead ends opened)")
    ax.set_ylabel("Cells explored")
    ax.set_title("Search effort of each solver")
    ax.legend(frameon=False)
    save(fig, "solver_explored.png")

    fig, ax = plt.subplots(figsize=(6.4, 4))
    ax.plot(cells, [r["dfs_path_over_shortest"] for r in rows], marker="o", ms=4, lw=2, color=COLORS["dfs"])
    ax.axhline(1.0, color="#52514e", lw=1, ls="--")
    ax.text(cells[-1], 1.04, "BFS and A* (shortest)", ha="right", color="#52514e")
    ax.set_xlabel("Cells (30% of dead ends opened)")
    ax.set_ylabel("DFS path length / shortest")
    ax.set_title("Backtracking finds a path, not the shortest one")
    save(fig, "dfs_vs_shortest.png")
    print(f"\nCharts written to {os.path.relpath(OUT)}")


if __name__ == "__main__":
    run()
