"""Correctness tests. Run: python -m unittest test_maze.py"""

import contextlib
import io
import unittest

import maze as M


class TestGenerators(unittest.TestCase):
    def test_every_generator_makes_a_perfect_maze(self):
        for name, fn in M.GENERATORS.items():
            for seed in range(30):
                rows, cols = 3 + seed % 17, 4 + seed % 13
                with self.subTest(algo=name, seed=seed):
                    self.assertTrue(M.is_perfect(fn(rows, cols, seed)))

    def test_recursive_and_iterative_both_perfect(self):
        self.assertTrue(M.is_perfect(M.generate_recursive(20, 20, 3)))
        self.assertTrue(M.is_perfect(M.generate_backtracker(20, 20, 3)[0]))

    def test_same_seed_same_maze(self):
        a, _ = M.generate_backtracker(15, 15, 42)
        b, _ = M.generate_backtracker(15, 15, 42)
        self.assertEqual(a.walls, b.walls)

    def test_outer_border_stays_closed(self):
        m, _ = M.generate_backtracker(12, 9, 5)
        for c in range(m.cols):
            self.assertTrue(m.walls[c] & M.N)
            self.assertTrue(m.walls[(m.rows - 1) * m.cols + c] & M.S)
        for r in range(m.rows):
            self.assertTrue(m.walls[r * m.cols] & M.W)
            self.assertTrue(m.walls[r * m.cols + m.cols - 1] & M.E)

    def test_one_by_one_grid(self):
        m, st = M.generate_backtracker(1, 1, 0)
        self.assertTrue(M.is_perfect(m))
        self.assertEqual(st["backtracks"], 1)


class TestSolvers(unittest.TestCase):
    def test_all_solvers_agree_on_perfect_maze(self):
        for seed in range(20):
            m, _ = M.generate_backtracker(18, 18, seed)
            lengths = {k: len(fn(m, 0, m.size - 1)[0]) for k, fn in M.SOLVERS.items()}
            self.assertEqual(len(set(lengths.values())), 1, lengths)

    def test_bfs_and_astar_are_shortest_with_loops(self):
        for seed in range(20):
            m = M.braid(M.generate_backtracker(20, 20, seed)[0], 0.5, seed)
            dfs = len(M.solve_dfs(m, 0, m.size - 1)[0])
            bfs = len(M.solve_bfs(m, 0, m.size - 1)[0])
            astar = len(M.solve_astar(m, 0, m.size - 1)[0])
            self.assertEqual(bfs, astar)
            self.assertLessEqual(bfs, dfs)

    def test_paths_are_valid_walks(self):
        m = M.braid(M.generate_backtracker(15, 15, 9)[0], 0.4, 9)
        for fn in M.SOLVERS.values():
            path, _ = fn(m, 0, m.size - 1)
            self.assertEqual(path[0], 0)
            self.assertEqual(path[-1], m.size - 1)
            for a, b in zip(path, path[1:]):
                self.assertIn(b, m.open(a))


class TestAssessment(unittest.TestCase):
    def test_perfect_run_scores_100_and_levels_up(self):
        m = M.build_trial_maze(3, 11)
        sol = M.analyze(m)["path"]
        r = M.score_trial(m, sol, sol)
        self.assertEqual(r["score"], 100)
        self.assertEqual(r["wrong_turns"], 0)
        self.assertEqual(M.next_level(3, r), 4)

    def test_poor_run_levels_down(self):
        self.assertEqual(M.next_level(5, {"wrong_turns": 4, "efficiency": 0.4}), 4)
        self.assertEqual(M.next_level(1, {"wrong_turns": 4, "efficiency": 0.4}), 1)

    def test_wrong_turn_is_counted(self):
        m = M.build_trial_maze(4, 3)
        sol = M.analyze(m)["path"]
        on = set(sol)
        # find a solution cell with an exit off the path, step in and back out
        for k, cell in enumerate(sol):
            off = [n for n in m.open(cell) if n not in on]
            if off:
                trail = sol[:k + 1] + [off[0], cell] + sol[k + 1:]
                r = M.score_trial(m, sol, trail)
                self.assertEqual(r["wrong_turns"], 1)
                self.assertLess(r["efficiency"], 1)
                return
        self.skipTest("maze has no side branches")

    def test_score_rounds_half_up_like_the_web_app(self):
        # 1 optimal move in 8 moves gives 12.5; JavaScript's Math.round gives 13, Python's round() gives 12.
        m = M.generate_backtracker(1, 2, 0)[0]
        r = M.score_trial(m, [0, 1], [0, 1, 0, 1, 0, 1, 0, 1, 0])
        self.assertEqual(r["score"], 13)

    def test_wall_bumps_cost_two_points_each(self):
        m = M.build_trial_maze(2, 5)
        sol = M.analyze(m)["path"]
        self.assertEqual(M.score_trial(m, sol, sol, wall_bumps=3)["score"], 94)
        self.assertEqual(M.score_trial(m, sol, sol, wall_bumps=80)["score"], 0)


class TestEdgeCases(unittest.TestCase):
    def test_unreachable_goal_gives_empty_path(self):
        m = M.Maze(3, 3)                      # every wall still standing
        for fn in M.SOLVERS.values():
            self.assertEqual(fn(m, 0, 8)[0], [])

    def test_start_equals_goal(self):
        m = M.generate_backtracker(4, 4, 1)[0]
        for fn in M.SOLVERS.values():
            self.assertEqual(fn(m, 5, 5)[0], [5])

    def test_braid_zero_changes_nothing_and_keeps_original(self):
        m = M.generate_backtracker(10, 10, 4)[0]
        before = m.walls[:]
        self.assertEqual(M.braid(m, 0.0, 4).walls, before)
        self.assertGreater(M.braid(m, 1.0, 4).passages(), m.passages())
        self.assertEqual(m.walls, before)

    def test_cli_rejects_sizes_below_one(self):
        for bad in ["0", "-3"]:
            with self.assertRaises(SystemExit), contextlib.redirect_stderr(io.StringIO()):
                M.main(["--size", bad])

    def test_cli_prints_a_maze(self):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            M.main(["--size", "6", "--seed", "3", "--algo", "kruskal"])
        self.assertIn("perfect maze: True", out.getvalue())


if __name__ == "__main__":
    unittest.main()
