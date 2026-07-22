from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "money_reality_audit.py"


def _load_module():
    spec = importlib.util.spec_from_file_location("money_reality_audit", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    assert spec is not None
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


class MoneyRealityAuditTests(unittest.TestCase):
    def test_public_venue_with_zero_requested_notional_is_not_real_money(self) -> None:
        audit_mod = _load_module()
        row = {
            "venue": "bybit-public",
            "requested_notional_usd": 0.0,
            "filled_notional_usd": 6.0,
            "pnl_usd_5m": 0.02,
        }

        self.assertFalse(audit_mod.is_real_money(row))

    def test_positive_public_simulation_does_not_prove_real_money(self) -> None:
        audit_mod = _load_module()
        audit = audit_mod.build_audit(
            [
                {
                    "venue": "bybit-public",
                    "requested_notional_usd": 0.0,
                    "pnl_usd_5m": 0.02,
                },
                {
                    "venue": "coinbase-public",
                    "requested_notional_usd": 0.0,
                    "pnl_usd_5m": 0.03,
                },
            ]
        )

        self.assertEqual(audit["status"], "REAL_MONEY_NOT_PROVEN")
        self.assertFalse(audit["money_proven_today"])
        self.assertEqual(audit["real_money"]["trade_count"], 0)
        self.assertEqual(audit["simulated_or_public"]["trade_count"], 2)
        self.assertAlmostEqual(audit["simulated_or_public"]["net_pnl_usd"], 0.05)

    def test_single_real_money_positive_pnl_is_not_enough_by_default(self) -> None:
        audit_mod = _load_module()
        audit = audit_mod.build_audit(
            [
                {
                    "venue": "bingx",
                    "strategy_id": "alpha-1",
                    "requested_notional_usd": 10.0,
                    "pnl_usd_5m": 0.4,
                },
            ]
        )

        self.assertEqual(audit["status"], "REAL_MONEY_NOT_PROVEN")
        self.assertTrue(audit["real_money_positive"])
        self.assertFalse(audit["money_proven_today"])
        self.assertEqual(audit["real_money"]["trade_count"], 1)

    def test_real_money_positive_pnl_can_pass_with_explicit_sample_threshold(self) -> None:
        audit_mod = _load_module()
        audit = audit_mod.build_audit(
            [
                {
                    "venue": "bingx",
                    "strategy_id": "alpha-1",
                    "requested_notional_usd": 10.0,
                    "pnl_usd_5m": 0.4,
                },
            ],
            min_real_trades=1,
        )

        self.assertEqual(audit["status"], "REAL_MONEY_PROVEN")
        self.assertTrue(audit["money_proven_today"])

    def test_cli_check_real_money_positive_fails_for_public_simulation(self) -> None:
        rows = [
            {
                "venue": "bybit-public",
                "requested_notional_usd": 0.0,
                "pnl_usd_5m": 0.03,
            }
        ]
        with tempfile.TemporaryDirectory() as tmpdir:
            labels = Path(tmpdir) / "labels.jsonl"
            labels.write_text("\n".join(json.dumps(row) for row in rows), encoding="utf-8")

            result = subprocess.run(
                [
                    "python3",
                    str(SCRIPT),
                    str(labels),
                    "--hours",
                    "0",
                    "--min-real-trades",
                    "1",
                    "--text",
                    "--check",
                    "real-money-positive",
                ],
                cwd=ROOT,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
            )

        self.assertEqual(result.returncode, 2)
        self.assertIn("status=REAL_MONEY_NOT_PROVEN", result.stdout)
        self.assertIn("failed_checks=real-money-positive", result.stdout)
        self.assertEqual(result.stderr, "")

    def test_cli_check_real_money_positive_passes_for_real_profit(self) -> None:
        rows = [
            {
                "venue": "bingx",
                "strategy_id": "alpha-1",
                "requested_notional_usd": 10.0,
                "pnl_usd_5m": 0.12,
            }
        ]
        with tempfile.TemporaryDirectory() as tmpdir:
            labels = Path(tmpdir) / "labels.jsonl"
            labels.write_text("\n".join(json.dumps(row) for row in rows), encoding="utf-8")

            result = subprocess.run(
                [
                    "python3",
                    str(SCRIPT),
                    str(labels),
                    "--hours",
                    "0",
                    "--min-real-trades",
                    "1",
                    "--text",
                    "--check",
                    "real-money-positive",
                ],
                check=True,
                cwd=ROOT,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
            )

        self.assertIn("status=REAL_MONEY_PROVEN", result.stdout)
        self.assertEqual(result.stderr, "")


if __name__ == "__main__":
    unittest.main()
