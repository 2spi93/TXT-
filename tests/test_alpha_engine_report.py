from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "alpha_engine_report.py"


def _load_module():
    spec = importlib.util.spec_from_file_location("alpha_engine_report", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    assert spec is not None
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


class AlphaEngineReportTests(unittest.TestCase):
    def test_public_simulation_is_excluded_from_alpha(self) -> None:
        mod = _load_module()
        report = mod.build_report(
            [
                {"venue": "bybit-public", "requested_notional_usd": 0.0, "pnl_usd_5m": 10.0},
                {"venue": "binance-public", "requested_notional_usd": 0.0, "pnl_usd_5m": 8.0},
            ],
            min_trades=1,
        )

        self.assertEqual(report["status"], "ALPHA_NOT_PROVEN")
        self.assertEqual(report["real_money"]["trade_count"], 0)
        self.assertEqual(report["excluded"]["simulated_or_public_rows"], 2)

    def test_alpha_candidate_requires_real_sample_profit_factor_and_expectancy(self) -> None:
        mod = _load_module()
        rows = [
            {"venue": "mt5", "strategy_id": "alpha-v2", "requested_notional_usd": 100.0, "pnl_usd_5m": 2.0},
            {"venue": "mt5", "strategy_id": "alpha-v2", "requested_notional_usd": 100.0, "pnl_usd_5m": 1.0},
            {"venue": "mt5", "strategy_id": "alpha-v2", "requested_notional_usd": 100.0, "pnl_usd_5m": -1.0},
        ]

        report = mod.build_report(rows, min_trades=3, min_profit_factor=1.0, min_expectancy_usd=0.0, max_drawdown_usd=2.0)

        self.assertEqual(report["status"], "ALPHA_CANDIDATE")
        self.assertEqual(report["real_money"]["trade_count"], 3)
        self.assertAlmostEqual(report["real_money"]["profit_factor"], 3.0)
        self.assertAlmostEqual(report["real_money"]["expectancy_usd"], 0.66666667)

    def test_negative_expectancy_fails_alpha(self) -> None:
        mod = _load_module()
        rows = [
            {"venue": "mt5", "strategy_id": "alpha-v2", "requested_notional_usd": 100.0, "pnl_usd_5m": 1.0},
            {"venue": "mt5", "strategy_id": "alpha-v2", "requested_notional_usd": 100.0, "pnl_usd_5m": -2.0},
        ]

        report = mod.build_report(rows, min_trades=2)

        self.assertEqual(report["status"], "ALPHA_NOT_PROVEN")
        self.assertFalse(report["checks"]["profit_factor_gt_threshold"])
        self.assertFalse(report["checks"]["expectancy_gt_threshold"])

    def test_cli_alpha_check_fails_without_real_trades(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            labels = Path(tmpdir) / "labels.jsonl"
            labels.write_text(json.dumps({"venue": "bybit-public", "requested_notional_usd": 0.0, "pnl_usd_5m": 1.0}), encoding="utf-8")

            result = subprocess.run(
                [
                    "python3",
                    str(SCRIPT),
                    str(labels),
                    "--days",
                    "0",
                    "--text",
                    "--check",
                    "alpha",
                ],
                cwd=ROOT,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
            )

        self.assertEqual(result.returncode, 2)
        self.assertIn("status=ALPHA_NOT_PROVEN", result.stdout)
        self.assertIn("failed_checks=alpha", result.stdout)
        self.assertEqual(result.stderr, "")


if __name__ == "__main__":
    unittest.main()
