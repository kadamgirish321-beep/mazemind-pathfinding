"""
MazeMind: maze generation using backtracking, with solvers, metrics and
the adaptive assessment rules. Python reference implementation of the web app.

Grid model
    rows x cols cells, cell id i = r * cols + c.
    Each cell keeps its walls as a bitmask: N=1, E=2, S=4, W=8.
    A maze is a graph: cells are vertices, removed walls are edges.

Run `python maze.py --size 12 --seed 7` to print a maze and its solution.
"""

import argparse
import heapq
import math
import random
import sys
from collections import deque

N, E, S, W = 1, 2, 4, 8
# (bit, row step, col step, opposite bit)
DIRS = [(N, -1, 0, S), (E, 0, 1, W), (S, 1, 0, N), (W, 0, -1, E)]


class Maze:
    def __init__(self, rows, cols):
        self.rows, self.cols = rows, cols
        self.size = rows * cols
        self.walls = [N | E | S | W] * self.size

    def neighbor(self, i, d):
        _, dr, dc, _ = d
        r, c = divmod(i, self.cols)
        r, c = r + dr, c + dc
        if 0 <= r < self.rows and 0 <= c < self.cols:
            return r * self.cols + c
        return -1

    def remove_wall(self, a, d):
        b = self.neighbor(a, d)
        self.walls[a] &= ~d[0]
        self.walls[b] &= ~d[3]
        return b

    def open(self, i):
        """Cells reachable from i in one step."""
        return [self.neighbor(i, d) for d in DIRS if not self.walls[i] & d[0]]

    def degree(self, i):
        return len(self.open(i))

    def passages(self):
        count = 0
        for i in range(self.size):
            r, c = divmod(i, self.cols)
            if c < self.cols - 1 and not self.walls[i] & E:
                count += 1
            if r < self.rows - 1 and not self.walls[i] & S:
                count += 1
        return count

    def copy(self):
        m = Maze(self.rows, self.cols)
        m.walls = self.walls[:]
        return m

    def to_text(self, path=()):
        """ASCII drawing. Cells on `path` are marked with a dot."""
        on_path = set(path)
        lines = ["+" + "---+" * self.cols]
        for r in range(self.rows):
            row, below = "|", "+"
            for c in range(self.cols):
                i = r * self.cols + c
                mark = " o " if i in on_path else "   "
                row += mark + ("|" if self.walls[i] & E else " ")
                below += ("---" if self.walls[i] & S else "   ") + "+"
            lines += [row, below]
        return "\n".join(lines)


# --------------------------------------------------------------------------
# Generators
# --------------------------------------------------------------------------

def generate_recursive(rows, cols, seed=None):
    """Recursive backtracker written with real recursion.
    Recursion depth can reach rows*cols, so big grids hit the recursion limit."""
    rng = random.Random(seed)
    m = Maze(rows, cols)
    visited = [False] * m.size

    def carve(cur):
        visited[cur] = True
        dirs = DIRS[:]
        rng.shuffle(dirs)
        for d in dirs:
            n = m.neighbor(cur, d)
            if n != -1 and not visited[n]:
                m.remove_wall(cur, d)
                carve(n)

    carve(0)
    return m


def generate_backtracker(rows, cols, seed=None):
    """Recursive backtracker (randomised DFS) using an explicit stack.
    Returns (maze, stats) where stats has the number of backtracks and max stack depth."""
    rng = random.Random(seed)
    m = Maze(rows, cols)
    visited = [False] * m.size
    visited[0] = True
    stack = [0]
    backtracks, max_depth = 0, 1
    while stack:
        cur = stack[-1]
        options = [d for d in DIRS
                   if (n := m.neighbor(cur, d)) != -1 and not visited[n]]
        if options:
            d = rng.choice(options)              # pick a random unvisited neighbour
            nxt = m.remove_wall(cur, d)          # carve the passage
            visited[nxt] = True
            stack.append(nxt)
            max_depth = max(max_depth, len(stack))
        else:
            stack.pop()                          # dead end: backtrack
            backtracks += 1
    return m, {"backtracks": backtracks, "max_depth": max_depth}


def generate_prim(rows, cols, seed=None):
    """Randomised Prim's algorithm: grow a tree from a random frontier wall."""
    rng = random.Random(seed)
    m = Maze(rows, cols)
    in_maze = [False] * m.size
    frontier = []

    def add(i):
        in_maze[i] = True
        for d in DIRS:
            n = m.neighbor(i, d)
            if n != -1 and not in_maze[n]:
                frontier.append((i, d))

    add(0)
    while frontier:
        k = rng.randrange(len(frontier))
        frontier[k], frontier[-1] = frontier[-1], frontier[k]
        i, d = frontier.pop()
        n = m.neighbor(i, d)
        if not in_maze[n]:
            m.remove_wall(i, d)
            add(n)
    return m


def generate_kruskal(rows, cols, seed=None):
    """Randomised Kruskal's algorithm with union-find (path compression + union by rank)."""
    rng = random.Random(seed)
    m = Maze(rows, cols)
    parent = list(range(m.size))
    rank = [0] * m.size

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    edges = []
    for i in range(m.size):
        r, c = divmod(i, cols)
        if c < cols - 1:
            edges.append((i, DIRS[1]))
        if r < rows - 1:
            edges.append((i, DIRS[2]))
    rng.shuffle(edges)
    for i, d in edges:
        a, b = find(i), find(m.neighbor(i, d))
        if a == b:
            continue
        if rank[a] < rank[b]:
            a, b = b, a
        parent[b] = a
        if rank[a] == rank[b]:
            rank[a] += 1
        m.remove_wall(i, d)
    return m


GENERATORS = {
    "backtracker": lambda r, c, s=None: generate_backtracker(r, c, s)[0],
    "prim": generate_prim,
    "kruskal": generate_kruskal,
}


def braid(maze, fraction, seed=None):
    """Open a fraction of dead ends to create loops (more than one route)."""
    rng = random.Random(seed)
    m = maze.copy()
    dead = [i for i in range(m.size) if m.degree(i) == 1]
    rng.shuffle(dead)
    target, removed = round(len(dead) * fraction), 0
    for i in dead:
        if removed >= target:
            break
        if m.degree(i) != 1:
            continue
        closed = [d for d in DIRS if m.walls[i] & d[0] and m.neighbor(i, d) != -1]
        if closed:
            m.remove_wall(i, rng.choice(closed))
            removed += 1
    return m


def is_perfect(m):
    """A perfect maze is a spanning tree: exactly V-1 passages and connected."""
    if m.passages() != m.size - 1:
        return False
    seen, q = {0}, deque([0])
    while q:
        for n in m.open(q.popleft()):
            if n not in seen:
                seen.add(n)
                q.append(n)
    return len(seen) == m.size


# --------------------------------------------------------------------------
# Solvers: each returns (path, cells_explored)
# --------------------------------------------------------------------------

def solve_dfs(m, start, goal):
    """Backtracking search: go forward while possible, step back at dead ends."""
    visited = [False] * m.size
    visited[start] = True
    stack, explored = [start], 1
    while stack and stack[-1] != goal:
        cur = stack[-1]
        nxt = next((n for n in m.open(cur) if not visited[n]), None)
        if nxt is None:
            stack.pop()
        else:
            visited[nxt] = True
            stack.append(nxt)
            explored += 1
    return stack, explored


def _trace(parent, start, goal):
    if goal != start and parent[goal] == -1:
        return []
    path = [goal]
    while path[-1] != start:
        path.append(parent[path[-1]])
    return path[::-1]


def solve_bfs(m, start, goal):
    parent = [-1] * m.size
    seen = [False] * m.size
    seen[start] = True
    q, explored = deque([start]), 0
    while q:
        cur = q.popleft()
        explored += 1
        if cur == goal:
            break
        for n in m.open(cur):
            if not seen[n]:
                seen[n] = True
                parent[n] = cur
                q.append(n)
    return _trace(parent, start, goal), explored


def solve_astar(m, start, goal):
    gr, gc = divmod(goal, m.cols)

    def h(i):
        r, c = divmod(i, m.cols)
        return abs(r - gr) + abs(c - gc)

    g = [float("inf")] * m.size
    parent = [-1] * m.size
    closed = [False] * m.size
    g[start] = 0
    heap = [(h(start), h(start), start)]
    explored = 0
    while heap:
        _, _, cur = heapq.heappop(heap)
        if closed[cur]:
            continue
        closed[cur] = True
        explored += 1
        if cur == goal:
            break
        for n in m.open(cur):
            if g[cur] + 1 < g[n]:
                g[n] = g[cur] + 1
                parent[n] = cur
                heapq.heappush(heap, (g[n] + h(n), h(n), n))
    return _trace(parent, start, goal), explored


SOLVERS = {"dfs": solve_dfs, "bfs": solve_bfs, "astar": solve_astar}


# --------------------------------------------------------------------------
# Metrics and adaptive assessment
# --------------------------------------------------------------------------

def analyze(m):
    """Difficulty = L + 3J: L = shortest route length, J = decision points on it."""
    degrees = [m.degree(i) for i in range(m.size)]
    path, _ = solve_bfs(m, 0, m.size - 1)
    decisions = sum(
        1 for k, cell in enumerate(path[:-1])
        if degrees[cell] - (0 if k == 0 else 1) >= 2
    )
    return {
        "dead_ends": degrees.count(1),
        "dead_end_pct": 100 * degrees.count(1) / m.size,
        "junctions": sum(1 for d in degrees if d >= 3),
        "solution_length": len(path),
        "decisions": decisions,
        "difficulty": len(path) + 3 * decisions,
        "path": path,
    }


LEVEL_SIZES = [5, 7, 9, 11, 13, 15, 17, 20, 23, 26]
CANDIDATES = 9


def build_trial_maze(level, seed):
    """Generate several mazes for the level and keep the median-difficulty one."""
    n = LEVEL_SIZES[level - 1]
    pool = []
    for k in range(CANDIDATES):
        m, _ = generate_backtracker(n, n, seed + k * 7919)
        pool.append((analyze(m)["difficulty"], k, m))
    pool.sort(key=lambda t: (t[0], t[1]))
    return pool[len(pool) // 2][2]


def score_trial(m, solution, trail, wall_bumps=0):
    """trail: list of cells the person stepped on, starting at 0.
    Score = 100 x efficiency - 8 x wrong turns - 2 x wall bumps, floored at 0,
    rounded half up like the web app's Math.round (Python's round() rounds half to even)."""
    on_path = set(solution)
    wrong_turns = sum(1 for a, b in zip(trail, trail[1:]) if a in on_path and b not in on_path)
    moves, optimal = len(trail) - 1, len(solution) - 1
    efficiency = min(1.0, optimal / moves) if moves else 0.0
    raw = 100 * efficiency - 8 * wrong_turns - 2 * wall_bumps
    return {"moves": moves, "optimal": optimal, "efficiency": efficiency,
            "wrong_turns": wrong_turns, "wall_bumps": wall_bumps,
            "score": max(0, math.floor(raw + 0.5))}


def next_level(level, result, max_level=len(LEVEL_SIZES)):
    """Staircase rule used by the app."""
    if result["wrong_turns"] == 0 and result["efficiency"] >= 0.85:
        return min(max_level, level + 1)
    if result["wrong_turns"] >= 3 or result["efficiency"] < 0.5:
        return max(1, level - 1)
    return level


def grid_size(text):
    """argparse type for --size: a whole number of at least 1."""
    n = int(text)
    if n < 1:
        raise argparse.ArgumentTypeError(f"size must be at least 1, got {n}")
    return n


def main(argv=None):
    ap = argparse.ArgumentParser(description="Generate and solve a maze.")
    ap.add_argument("--size", type=grid_size, default=10)
    ap.add_argument("--seed", type=int, default=2026)
    ap.add_argument("--algo", choices=GENERATORS, default="backtracker")
    args = ap.parse_args(argv)
    m = GENERATORS[args.algo](args.size, args.size, args.seed)
    info = analyze(m)
    print(m.to_text(info["path"]))
    print(f"\n{args.algo}, {args.size}x{args.size}, seed {args.seed}")
    print(f"perfect maze: {is_perfect(m)}")
    print(f"dead ends: {info['dead_ends']} ({info['dead_end_pct']:.1f}%), junctions: {info['junctions']}")
    print(f"shortest route: {info['solution_length']} cells, decision points: {info['decisions']}, "
          f"difficulty L+3J = {info['difficulty']}")


if __name__ == "__main__":
    sys.exit(main())
