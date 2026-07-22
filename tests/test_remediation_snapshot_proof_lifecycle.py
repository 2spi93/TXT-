from __future__ import annotations

import ast
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "remediation_snapshot_daily.sh"
LIFECYCLE_SCRIPT = ROOT / "scripts" / "proof_lifecycle_snapshot.py"


def _load_embedded_report_helpers() -> dict:
    text = SCRIPT.read_text(encoding="utf-8")
    marker = "report_json=\"$(python3 - <<'PY'"
    start = text.index(marker)
    start = text.index("\n", start) + 1
    end = text.index("\nPY\n)\"", start)
    module = ast.parse(text[start:end])
    helper_names = {
        "proof_age_state",
        "worst_proof_state",
        "proof_renewal_lag_days",
        "proof_days_until",
        "proof_signal",
    }
    helper_defs = [node for node in module.body if isinstance(node, ast.FunctionDef) and node.name in helper_names]
    isolated = ast.Module(body=helper_defs, type_ignores=[])
    ast.fix_missing_locations(isolated)
    namespace: dict = {}
    exec(compile(isolated, str(SCRIPT), "exec"), namespace)
    return namespace


def _load_lifecycle_module():
    spec = importlib.util.spec_from_file_location("proof_lifecycle_snapshot", LIFECYCLE_SCRIPT)
    module = importlib.util.module_from_spec(spec)
    assert spec is not None
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


class RemediationSnapshotProofLifecycleTests(unittest.TestCase):
    def test_snapshot_script_supports_non_publishing_mode(self) -> None:
        text = SCRIPT.read_text(encoding="utf-8")

        self.assertIn("REMEDIATION_SNAPSHOT_PUBLISH", text)
        self.assertIn("publish_enabled = sys.argv[33] != '0'", text)
        self.assertIn("""if [[ "$REMEDIATION_SNAPSHOT_PUBLISH" != '0' ]]; then""", text)

    def test_renewal_velocity_prioritizes_largest_freshness_lag(self) -> None:
        helpers = _load_embedded_report_helpers()
        thresholds = {
            "ack": {"fresh_days": 7.0, "stale_days": 30.0, "expired_days": 60.0},
            "fill": {"fresh_days": 7.0, "stale_days": 30.0, "expired_days": 60.0},
            "outcome": {"fresh_days": 14.0, "stale_days": 45.0, "expired_days": 90.0},
            "gap_sample": {"fresh_days": 7.0, "stale_days": 30.0, "expired_days": 60.0},
        }
        ages = {
            "ack": 46.309522,
            "fill": 46.309522,
            "outcome": 66.042444,
            "gap_sample": 18.474548,
        }

        signals = {
            name: helpers["proof_signal"](age, thresholds[name], f"2026-01-01T00:00:00+00:00")
            for name, age in ages.items()
        }
        priority = sorted(
            [
                {
                    "signal": name,
                    "state": item["state"],
                    "renewal_lag_days": item["renewal_lag_days"],
                }
                for name, item in signals.items()
            ],
            key=lambda item: (
                0 if item.get("renewal_lag_days") is None else 1,
                0.0 if item.get("renewal_lag_days") is None else -float(item.get("renewal_lag_days") or 0.0),
                str(item.get("signal") or ""),
            ),
        )
        expiration_priority = sorted(
            [
                {
                    "signal": name,
                    "state": item["state"],
                    "days_until_expired": item["days_until_expired"],
                }
                for name, item in signals.items()
            ],
            key=lambda item: (
                0 if item.get("days_until_expired") is None else 1,
                0.0 if item.get("days_until_expired") is None else float(item.get("days_until_expired") or 0.0),
                str(item.get("signal") or ""),
            ),
        )

        self.assertEqual(helpers["worst_proof_state"]([item["state"] for item in signals.values()]), "STALE")
        self.assertEqual(priority[0]["signal"], "outcome")
        self.assertAlmostEqual(priority[0]["renewal_lag_days"], 52.042444)
        self.assertEqual(expiration_priority[0]["signal"], "ack")
        self.assertAlmostEqual(expiration_priority[0]["days_until_expired"], 13.690478)
        self.assertEqual(signals["gap_sample"]["state"], "AGING")
        self.assertAlmostEqual(signals["gap_sample"]["days_until_stale"], 11.525452)

    def test_missing_signal_is_invalidating_priority(self) -> None:
        helpers = _load_embedded_report_helpers()
        thresholds = {"fresh_days": 7.0, "stale_days": 30.0, "expired_days": 60.0}

        self.assertEqual(helpers["proof_age_state"](None, thresholds), "EXPIRED")
        self.assertIsNone(helpers["proof_renewal_lag_days"](None, thresholds))
        self.assertIsNone(helpers["proof_days_until"](None, 60.0))
        self.assertIsNone(helpers["proof_signal"](None, thresholds, None)["days_until_expired"])

    def test_offline_lifecycle_renderer_computes_current_priorities(self) -> None:
        lifecycle_module = _load_lifecycle_module()
        snapshot = {
            "strict_v1_proof": {
                "strict_v1_proven": False,
                "operational_v1_proven": False,
                "decision_reality_observed": False,
                "broker_reality_validated": True,
                "execution_gap_validated": True,
                "metrics": {
                    "coverage_pct": 0.0,
                    "proof_coverage_pct": 0.0,
                    "unknown_conditions_count": 7,
                    "elimination_coverage_pct": 0.0,
                },
                "thresholds": {
                    "decision_mc_dc_target_pct": 80.0,
                    "proof_coverage_min_pct": 60.0,
                    "unknown_conditions_max": 2,
                    "elimination_coverage_min_pct": 50.0,
                },
            },
            "proof_regression": {
                "days_since_last_ack": 46.309522,
                "days_since_last_fill": 46.309522,
                "days_since_last_outcome": 66.042444,
                "days_since_last_gap_sample": 18.474548,
                "proof_staleness": {"missing_signals": []},
                "proof_renewal": {
                    "signals": {
                        "ack": {"thresholds": {"fresh_days": 7.0, "stale_days": 30.0, "expired_days": 60.0}},
                        "fill": {"thresholds": {"fresh_days": 7.0, "stale_days": 30.0, "expired_days": 60.0}},
                        "outcome": {"thresholds": {"fresh_days": 14.0, "stale_days": 45.0, "expired_days": 90.0}},
                        "gap_sample": {"thresholds": {"fresh_days": 7.0, "stale_days": 30.0, "expired_days": 60.0}},
                    }
                },
            }
        }

        lifecycle = lifecycle_module.build_lifecycle(snapshot)
        closure = lifecycle_module.build_v1_closure(snapshot, lifecycle)

        self.assertEqual(lifecycle["state"], "STALE")
        self.assertFalse(lifecycle["fresh_proven"])
        self.assertTrue(lifecycle["proof_decay_detected"])
        self.assertFalse(lifecycle["proof_invalidated"])
        self.assertEqual(lifecycle["next_signal_to_renew"], "outcome")
        self.assertEqual(lifecycle["next_signal_to_expire"], "ack")
        self.assertAlmostEqual(lifecycle["max_lag_days"], 52.042444)
        self.assertFalse(closure["strict_v1_proven"])
        self.assertFalse(closure["operational_v1_proven"])
        self.assertEqual(closure["strict_remaining"]["unknown_conditions_to_target"], 5)
        self.assertAlmostEqual(closure["strict_remaining"]["coverage_pct_to_target"], 80.0)

    def test_offline_lifecycle_cli_text_mode_is_read_only_summary(self) -> None:
        snapshot = {
            "strict_v1_proof": {
                "strict_v1_proven": False,
                "operational_v1_proven": False,
                "metrics": {
                    "coverage_pct": 0.0,
                    "proof_coverage_pct": 0.0,
                    "unknown_conditions_count": 7,
                    "elimination_coverage_pct": 0.0,
                },
                "thresholds": {
                    "decision_mc_dc_target_pct": 80.0,
                    "proof_coverage_min_pct": 60.0,
                    "unknown_conditions_max": 2,
                    "elimination_coverage_min_pct": 50.0,
                },
            },
            "proof_regression": {
                "days_since_last_ack": 46.309522,
                "days_since_last_fill": 46.309522,
                "days_since_last_outcome": 66.042444,
                "days_since_last_gap_sample": 18.474548,
                "proof_staleness": {"missing_signals": []},
                "proof_renewal": {
                    "signals": {
                        "ack": {"thresholds": {"fresh_days": 7.0, "stale_days": 30.0, "expired_days": 60.0}},
                        "fill": {"thresholds": {"fresh_days": 7.0, "stale_days": 30.0, "expired_days": 60.0}},
                        "outcome": {"thresholds": {"fresh_days": 14.0, "stale_days": 45.0, "expired_days": 90.0}},
                        "gap_sample": {"thresholds": {"fresh_days": 7.0, "stale_days": 30.0, "expired_days": 60.0}},
                    }
                },
            }
        }
        with tempfile.TemporaryDirectory() as tmpdir:
            snapshot_path = Path(tmpdir) / "snapshot.json"
            snapshot_path.write_text(json.dumps(snapshot), encoding="utf-8")

            result = subprocess.run(
                ["python3", str(LIFECYCLE_SCRIPT), str(snapshot_path), "--text"],
                check=True,
                cwd=ROOT,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
            )

        self.assertEqual(
            result.stdout.strip(),
            "Proof Lifecycle: state=STALE fresh=no renew_next=outcome expire_next=ack max_lag=52.04d decay=yes invalidated=no",
        )
        self.assertEqual(result.stderr, "")

    def test_offline_lifecycle_cli_audit_mode_reports_v1_gaps(self) -> None:
        snapshot = {
            "strict_v1_proof": {
                "strict_v1_proven": False,
                "operational_v1_proven": False,
                "metrics": {
                    "coverage_pct": 0.0,
                    "proof_coverage_pct": 0.0,
                    "unknown_conditions_count": 7,
                    "elimination_coverage_pct": 0.0,
                },
                "thresholds": {
                    "decision_mc_dc_target_pct": 80.0,
                    "proof_coverage_min_pct": 60.0,
                    "unknown_conditions_max": 2,
                    "elimination_coverage_min_pct": 50.0,
                },
            },
            "proof_regression": {
                "days_since_last_ack": 46.309522,
                "days_since_last_fill": 46.309522,
                "days_since_last_outcome": 66.042444,
                "days_since_last_gap_sample": 18.474548,
                "proof_staleness": {"missing_signals": []},
                "proof_renewal": {
                    "signals": {
                        "ack": {"thresholds": {"fresh_days": 7.0, "stale_days": 30.0, "expired_days": 60.0}},
                        "fill": {"thresholds": {"fresh_days": 7.0, "stale_days": 30.0, "expired_days": 60.0}},
                        "outcome": {"thresholds": {"fresh_days": 14.0, "stale_days": 45.0, "expired_days": 90.0}},
                        "gap_sample": {"thresholds": {"fresh_days": 7.0, "stale_days": 30.0, "expired_days": 60.0}},
                    }
                },
            },
        }
        with tempfile.TemporaryDirectory() as tmpdir:
            snapshot_path = Path(tmpdir) / "snapshot.json"
            snapshot_path.write_text(json.dumps(snapshot), encoding="utf-8")

            result = subprocess.run(
                ["python3", str(LIFECYCLE_SCRIPT), str(snapshot_path), "--audit"],
                check=True,
                cwd=ROOT,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
            )

        self.assertEqual(
            result.stdout.strip(),
            "V1 Closure: fresh=no strict=no operational=no renew_next=outcome expire_next=ack coverage_gap=80.00pts proof_gap=60.00pts unknown_gap=5 elimination_gap=50.00pts",
        )
        self.assertEqual(result.stderr, "")

    def test_offline_lifecycle_check_mode_returns_nonzero_for_failed_gate(self) -> None:
        snapshot = {
            "strict_v1_proof": {
                "strict_v1_proven": False,
                "operational_v1_proven": False,
                "metrics": {},
                "thresholds": {},
            },
            "proof_regression": {
                "proof_staleness": {"missing_signals": []},
                "proof_renewal": {
                    "signals": {
                        "ack": {"age_days": 46.0, "thresholds": {"fresh_days": 7.0, "stale_days": 30.0, "expired_days": 60.0}},
                        "fill": {"age_days": 46.0, "thresholds": {"fresh_days": 7.0, "stale_days": 30.0, "expired_days": 60.0}},
                        "outcome": {"age_days": 66.0, "thresholds": {"fresh_days": 14.0, "stale_days": 45.0, "expired_days": 90.0}},
                        "gap_sample": {"age_days": 18.0, "thresholds": {"fresh_days": 7.0, "stale_days": 30.0, "expired_days": 60.0}},
                    }
                },
            },
        }
        with tempfile.TemporaryDirectory() as tmpdir:
            snapshot_path = Path(tmpdir) / "snapshot.json"
            snapshot_path.write_text(json.dumps(snapshot), encoding="utf-8")

            result = subprocess.run(
                ["python3", str(LIFECYCLE_SCRIPT), str(snapshot_path), "--audit", "--check", "fresh"],
                cwd=ROOT,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
            )

        self.assertEqual(result.returncode, 2)
        self.assertIn("failed_checks=fresh", result.stdout)
        self.assertEqual(result.stderr, "")

    def test_offline_lifecycle_check_mode_passes_for_not_invalidated_gate(self) -> None:
        snapshot = {
            "strict_v1_proof": {"metrics": {}, "thresholds": {}},
            "proof_regression": {
                "proof_staleness": {"missing_signals": []},
                "proof_renewal": {
                    "signals": {
                        "ack": {"age_days": 46.0, "thresholds": {"fresh_days": 7.0, "stale_days": 30.0, "expired_days": 60.0}},
                        "fill": {"age_days": 46.0, "thresholds": {"fresh_days": 7.0, "stale_days": 30.0, "expired_days": 60.0}},
                        "outcome": {"age_days": 66.0, "thresholds": {"fresh_days": 14.0, "stale_days": 45.0, "expired_days": 90.0}},
                        "gap_sample": {"age_days": 18.0, "thresholds": {"fresh_days": 7.0, "stale_days": 30.0, "expired_days": 60.0}},
                    }
                },
            },
        }
        with tempfile.TemporaryDirectory() as tmpdir:
            snapshot_path = Path(tmpdir) / "snapshot.json"
            snapshot_path.write_text(json.dumps(snapshot), encoding="utf-8")

            result = subprocess.run(
                ["python3", str(LIFECYCLE_SCRIPT), str(snapshot_path), "--text", "--check", "not-invalidated"],
                cwd=ROOT,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
            )

        self.assertEqual(result.returncode, 0)
        self.assertIn("invalidated=no", result.stdout)
        self.assertEqual(result.stderr, "")

    def test_offline_lifecycle_recommend_mode_reports_next_observation_actions(self) -> None:
        snapshot = {
            "strict_v1_proof": {
                "strict_v1_proven": False,
                "operational_v1_proven": False,
                "metrics": {
                    "coverage_pct": 0.0,
                    "proof_coverage_pct": 0.0,
                    "unknown_conditions_count": 7,
                    "elimination_coverage_pct": 0.0,
                },
                "thresholds": {
                    "decision_mc_dc_target_pct": 80.0,
                    "proof_coverage_min_pct": 60.0,
                    "unknown_conditions_max": 2,
                    "elimination_coverage_min_pct": 50.0,
                },
            },
            "proof_regression": {
                "proof_staleness": {"missing_signals": []},
                "proof_renewal": {
                    "signals": {
                        "ack": {"age_days": 46.0, "thresholds": {"fresh_days": 7.0, "stale_days": 30.0, "expired_days": 60.0}},
                        "fill": {"age_days": 46.0, "thresholds": {"fresh_days": 7.0, "stale_days": 30.0, "expired_days": 60.0}},
                        "outcome": {"age_days": 66.0, "thresholds": {"fresh_days": 14.0, "stale_days": 45.0, "expired_days": 90.0}},
                        "gap_sample": {"age_days": 18.0, "thresholds": {"fresh_days": 7.0, "stale_days": 30.0, "expired_days": 60.0}},
                    }
                },
            },
        }
        with tempfile.TemporaryDirectory() as tmpdir:
            snapshot_path = Path(tmpdir) / "snapshot.json"
            snapshot_path.write_text(json.dumps(snapshot), encoding="utf-8")

            result = subprocess.run(
                ["python3", str(LIFECYCLE_SCRIPT), str(snapshot_path), "--recommend"],
                check=True,
                cwd=ROOT,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
            )

        self.assertEqual(
            result.stdout.splitlines(),
            [
                "RENEW: prioritize outcome proof renewal.",
                "WATCH: ack is closest to expiration.",
                "OBSERVE: wait for decision rows before claiming operational v1 closure.",
                "MAP: close strict v1 gaps coverage=80.0 proof=60.0 unknown=5 elimination=50.0.",
            ],
        )
        self.assertEqual(result.stderr, "")


if __name__ == "__main__":
    unittest.main()
