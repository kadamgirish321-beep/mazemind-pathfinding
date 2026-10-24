# MazeMind — Maze Generation & Pathfinding Visualizer

MazeMind is an interactive project for exploring maze generation algorithms and pathfinding techniques. It combines a browser-based visualization with a Python implementation for algorithm experiments and benchmarking.

## Features

- **Maze generation:** Recursive Backtracking, Randomized Prim's, and Randomized Kruskal's.
- **Pathfinding:** Depth-First Search (DFS), Breadth-First Search (BFS), and A* Search.
- **Visualization:** Explore maze generation and compare pathfinding behavior.
- **Benchmarking:** Review recorded performance results and visualizations.
- **Testing:** Includes Python and JavaScript test files.

## Technologies

- HTML, CSS, and JavaScript
- Python
- Graph traversal and pathfinding algorithms
- CSV-based benchmark results

## Project Structure

- `maze-project/web/` — Browser application and JavaScript logic
- `maze-project/python/` — Python implementation, benchmarks, and tests
- `maze-project/results/` — Benchmark data and charts
- `maze-project/REPORT.md` — Project report

## Run the Web Application

1. Open the `maze-project/web/` folder.
2. Open `index.html` in a modern browser.
3. Follow the application interface to explore the available features.

## Run the Python Tests

From the repository root, run:

```bash
python -m unittest discover -s maze-project/python -p "test_*.py"
```

## Purpose

MazeMind demonstrates maze generation, graph traversal, pathfinding, visualization, and performance analysis in an educational software project.

## Limitations

Benchmark results depend on the test conditions and environment. Refer to `maze-project/REPORT.md` for the project's recorded experiments and findings.
