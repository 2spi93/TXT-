from __future__ import annotations

from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
ONE_SHOT_SCRIPT = ROOT / "scripts" / "mt5_spread_gated_one_shot.sh"
SMOKE_SCRIPT = ROOT / "scripts" / "mt5_live_operator_smoke.sh"


class Mt5SpreadGatedOneShotContractTests(unittest.TestCase):
    def test_precheck_accepts_risk_gateway_accept_decision(self) -> None:
        body = ONE_SHOT_SCRIPT.read_text(encoding="utf-8")

        self.assertIn('if [ "$DECISION" != "accept" ]; then', body)
        self.assertNotIn('if [ "$DECISION" != "approve" ]; then', body)
        self.assertIn("If decision=accept: submit live request.", body)

    def test_live_smoke_sends_confidence_for_go_live_hardening(self) -> None:
        body = SMOKE_SCRIPT.read_text(encoding="utf-8")

        self.assertIn('CONFIDENCE="${CONFIDENCE:-0.8}"', body)
        self.assertIn('"confidence": float(os.environ["CONFIDENCE"])', body)
        self.assertIn('"confidence": float(os.environ["CONFIDENCE"])', body)
        self.assertIn("hardening_effective_confidence=", body)

    def test_one_shot_forwards_confidence_to_live_smoke(self) -> None:
        body = ONE_SHOT_SCRIPT.read_text(encoding="utf-8")

        self.assertIn('CONFIDENCE="${CONFIDENCE:-0.8}"', body)
        self.assertIn("--confidence \"$CONFIDENCE\"", body)

    def test_one_shot_precheck_is_dry_run(self) -> None:
        body = ONE_SHOT_SCRIPT.read_text(encoding="utf-8")

        self.assertIn('"dry_run": True', body)

    def test_one_shot_aborts_if_runtime_dry_run_contract_is_missing(self) -> None:
        body = ONE_SHOT_SCRIPT.read_text(encoding="utf-8")

        self.assertIn("risk_gateway_dry_run_contract_missing", body)
        self.assertIn('if [ "$DRY_RUN_SUPPORTED" != "1" ]; then', body)

    def test_one_shot_requires_distinct_second_operator(self) -> None:
        body = ONE_SHOT_SCRIPT.read_text(encoding="utf-8")

        self.assertIn("--second-username VALUE", body)
        self.assertIn("second_operator_missing", body)
        self.assertIn("second_operator_same_as_first", body)
        self.assertIn('if [ "$SECOND_USERNAME" = "$USERNAME" ]; then', body)


if __name__ == "__main__":
    unittest.main()
