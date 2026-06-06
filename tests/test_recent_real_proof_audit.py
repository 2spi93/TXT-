from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "recent_real_proof_audit.py"


def _load_module():
    spec = importlib.util.spec_from_file_location("recent_real_proof_audit", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    assert spec is not None
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


class RecentRealProofAuditTests(unittest.TestCase):
    def test_complete_linked_loop_passes_when_ids_match(self) -> None:
        audit_mod = _load_module()
        payload = {
            "ack": [{"broker_ticket": "mt5-1", "created_at": "2026-06-05T10:00:00+00:00"}],
            "fill": [{"decision_id": "mt5-1", "venue": "mt5", "notional_usd": 5, "filled_at": "2026-06-05T10:00:01+00:00"}],
            "outcome": [{"decision_id": "mt5-1", "created_at": "2026-06-05T10:00:02+00:00"}],
            "gap": [{"decision_id": "mt5-1", "created_at": "2026-06-05T10:00:03+00:00"}],
        }

        audit = audit_mod.build_audit(payload, hours=24, now=audit_mod.parse_time("2026-06-05T12:00:00+00:00"))

        self.assertEqual(audit["status"], "REAL_PROOF_REACTIVATED")
        self.assertEqual(audit["counts"]["complete_linked_loop"], 1)
        self.assertEqual(audit["complete_decision_ids"], ["mt5-1"])

    def test_public_fill_does_not_count_as_real_fill(self) -> None:
        audit_mod = _load_module()
        payload = {
            "ack": [{"broker_ticket": "sim-1", "created_at": "2026-06-05T10:00:00+00:00"}],
            "fill": [{"decision_id": "sim-1", "venue": "binance-public", "notional_usd": 5, "filled_at": "2026-06-05T10:00:01+00:00"}],
            "outcome": [{"decision_id": "sim-1", "created_at": "2026-06-05T10:00:02+00:00"}],
            "gap": [{"decision_id": "sim-1", "created_at": "2026-06-05T10:00:03+00:00"}],
        }

        audit = audit_mod.build_audit(payload, hours=24, now=audit_mod.parse_time("2026-06-05T12:00:00+00:00"))

        self.assertEqual(audit["status"], "REAL_PROOF_STALE")
        self.assertFalse(audit["checks"]["recent_fill"])
        self.assertEqual(audit["counts"]["real_fill"], 0)

    def test_unlinked_events_do_not_claim_complete_loop(self) -> None:
        audit_mod = _load_module()
        payload = {
            "ack": [{"broker_ticket": "ack-1", "created_at": "2026-06-05T10:00:00+00:00"}],
            "fill": [{"decision_id": "fill-1", "venue": "mt5", "notional_usd": 5, "filled_at": "2026-06-05T10:00:01+00:00"}],
            "outcome": [{"decision_id": "outcome-1", "created_at": "2026-06-05T10:00:02+00:00"}],
            "gap": [{"decision_id": "gap-1", "created_at": "2026-06-05T10:00:03+00:00"}],
        }

        audit = audit_mod.build_audit(payload, hours=24, now=audit_mod.parse_time("2026-06-05T12:00:00+00:00"))

        self.assertEqual(audit["status"], "REAL_PROOF_STALE")
        self.assertTrue(audit["checks"]["recent_ack"])
        self.assertTrue(audit["checks"]["recent_fill"])
        self.assertFalse(audit["checks"]["complete_linked_loop"])

    def test_cli_check_fails_when_gap_missing(self) -> None:
        payload = {
            "ack": [{"broker_ticket": "mt5-1", "created_at": "2026-06-05T10:00:00+00:00"}],
            "fill": [{"decision_id": "mt5-1", "venue": "mt5", "notional_usd": 5, "filled_at": "2026-06-05T10:00:01+00:00"}],
            "outcome": [{"decision_id": "mt5-1", "created_at": "2026-06-05T10:00:02+00:00"}],
            "gap": [],
        }
        with tempfile.TemporaryDirectory() as tmpdir:
            input_path = Path(tmpdir) / "proof.json"
            input_path.write_text(json.dumps(payload), encoding="utf-8")

            result = subprocess.run(
                [
                    "python3",
                    str(SCRIPT),
                    "--input-json",
                    str(input_path),
                    "--hours",
                    "0",
                    "--text",
                    "--check",
                    "gap",
                    "--check",
                    "linked-loop",
                ],
                cwd=ROOT,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
            )

        self.assertEqual(result.returncode, 2)
        self.assertIn("status=REAL_PROOF_STALE", result.stdout)
        self.assertIn("failed_checks=gap,linked-loop", result.stdout)
        self.assertEqual(result.stderr, "")


if __name__ == "__main__":
    unittest.main()
