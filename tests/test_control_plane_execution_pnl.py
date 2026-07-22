from __future__ import annotations

import json
import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

from apps.control_plane import main as control_plane


class ControlPlaneExecutionPnlAnalyzerTests(unittest.TestCase):
    def test_build_execution_pnl_analyzer_groups_and_flags_high_confidence_losses(self) -> None:
        now = datetime(2026, 4, 11, 12, 0, tzinfo=timezone.utc)
        rows = [
            {
                "decision_id": "dec-1",
                "symbol": "BTCUSDT",
                "provider": "bingx",
                "regime": "TREND",
                "score_pre_trade": 0.74,
                "slippage_real_bps": 1.2,
                "latency_ms": 82,
                "fees_usd": 1.4,
                "net_result_usd": 22.5,
                "status": "finalized",
                "created_at": now.isoformat(),
                "route_chosen": "bingx",
                "expected_slippage_bps": 1.0,
                "realized_slippage_bps": 1.2,
                "latency_e2e_ms": 90,
                "payload": {
                    "router_execution": {
                        "execution_mode": "live",
                        "route": {
                            "execution_context": {
                                "confidence": 0.81,
                                "fallback_mode": "normal",
                                "no_trade_dominance": False,
                            }
                        },
                    }
                },
            },
            {
                "decision_id": "dec-2",
                "symbol": "ETHUSDT",
                "provider": "bitget",
                "regime": "CHOP",
                "score_pre_trade": 0.69,
                "slippage_real_bps": 3.8,
                "latency_ms": 128,
                "fees_usd": 1.0,
                "net_result_usd": -18.0,
                "status": "finalized",
                "created_at": now.replace(minute=1).isoformat(),
                "route_chosen": "bitget",
                "expected_slippage_bps": 2.4,
                "realized_slippage_bps": 3.8,
                "latency_e2e_ms": 140,
                "payload": {
                    "router_execution": {
                        "execution_mode": "simulated",
                        "route": {
                            "execution_context": {
                                "confidence": 0.76,
                                "fallback_mode": "degraded",
                                "no_trade_dominance": True,
                                "no_trade_state": "dominant_block",
                                "no_trade_reasons": ["dominance_environment_stack"],
                                "dominant_reasons": ["dominance_environment_stack"],
                            }
                        },
                    }
                },
            },
            {
                "decision_id": "dec-3",
                "symbol": "BTCUSDT",
                "provider": "bingx",
                "regime": "TREND",
                "score_pre_trade": 0.42,
                "slippage_real_bps": 2.0,
                "latency_ms": 96,
                "fees_usd": 1.1,
                "net_result_usd": -4.0,
                "status": "finalized",
                "created_at": now.replace(minute=2).isoformat(),
                "route_chosen": "bingx",
                "expected_slippage_bps": 1.8,
                "realized_slippage_bps": 2.0,
                "latency_e2e_ms": 102,
                "payload": {
                    "router_execution": {
                        "execution_mode": "live",
                        "route": {
                            "execution_context": {
                                "confidence": 0.41,
                                "fallback_mode": "normal",
                                "no_trade_dominance": False,
                            }
                        },
                    }
                },
            },
        ]

        payload = control_plane._build_execution_pnl_analyzer_payload(
            rows,
            scope_type="strategy",
            scope_id="mt5-live",
            start=now,
            end=now,
            confidence_flag_threshold=0.7,
            trade_limit=20,
        )

        self.assertEqual(payload["summary"]["trade_count"], 3)
        self.assertEqual(payload["summary"]["high_confidence_loss_count"], 1)
        self.assertEqual(payload["summary"]["no_trade_dominance_count"], 1)
        self.assertAlmostEqual(payload["summary"]["net_pnl_usd"], 0.5)
        self.assertAlmostEqual(payload["summary"]["net_after_costs_usd"], 0.5)
        self.assertAlmostEqual(payload["summary"]["net_after_costs_per_truth_regime"]["TREND"], 18.5)
        self.assertEqual(len(payload["bad_model_flags"]), 1)
        self.assertEqual(payload["bad_model_flags"][0]["decision_id"], "dec-2")

        by_regime = {row["regime"]: row for row in payload["by_regime"]}
        self.assertIn("TREND", by_regime)
        self.assertIn("CHOP", by_regime)
        self.assertEqual(by_regime["TREND"]["trade_count"], 2)
        self.assertAlmostEqual(by_regime["TREND"]["net_pnl_usd"], 18.5)
        self.assertAlmostEqual(by_regime["TREND"]["net_after_costs_usd"], 18.5)
        self.assertAlmostEqual(by_regime["CHOP"]["fees_usd"], 1.0)

        by_execution_mode = {row["execution_mode"]: row for row in payload["by_execution_mode"]}
        self.assertEqual(by_execution_mode["live"]["trade_count"], 2)
        self.assertEqual(by_execution_mode["simulated"]["high_confidence_losses"], 1)

    def test_build_ops_copilot_desk_brief_summarizes_live_truth(self) -> None:
        payload = control_plane._build_ops_copilot_desk_brief(
            pnl_payload={
                "summary": {
                    "trade_count": 6,
                    "net_pnl_usd": -9.5,
                    "avg_pnl_usd": -1.58,
                    "win_rate_pct": 33.3,
                    "avg_latency_ms": 128,
                    "avg_slippage_bps": 3.4,
                    "high_confidence_loss_count": 1,
                    "no_trade_dominance_count": 0,
                }
            },
            readiness_payload={
                "drift": {
                    "suspended_strategies": [
                        {"strategy_id": "trend-v6"},
                    ]
                }
            },
            incidents_payload={"items": [{"ticket_key": "INC-1"}]},
            strategies_payload=[
                {"strategy_id": "trend-v6", "current_level": 2, "status": "shadow", "updated_at": "2026-04-11T12:00:00+00:00"},
            ],
            execution_ai_v6_payload={
                "snapshot": {
                    "reward_ema": -0.21,
                    "guardrails": {
                        "learning_frozen": True,
                    },
                }
            },
        )

        self.assertEqual(payload["status"], "ok")
        self.assertIn("Desk truth BLOCK", payload["reply"])
        self.assertIn("Calibration semi-auto", payload["reply"])
        self.assertIn("open_live_ops", payload["actions"])
        self.assertIn("open_terminal_truth", payload["actions"])

    def test_build_ops_copilot_command_brief_returns_directive_decision(self) -> None:
        payload = control_plane._build_ops_copilot_command_brief(
            pnl_payload={
                "summary": {
                    "trade_count": 6,
                    "net_pnl_usd": -11.0,
                    "avg_latency_ms": 146,
                    "avg_slippage_bps": 3.9,
                    "win_rate_pct": 33.0,
                    "high_confidence_loss_count": 2,
                    "no_trade_dominance_count": 4,
                },
                "trades": [
                    {"net_result_usd": -6.0},
                    {"net_result_usd": -2.0},
                ],
            },
            readiness_payload={"drift": {"suspended_strategies": []}},
            incidents_payload={"items": []},
            strategies_payload=[],
            execution_ai_v6_payload={"snapshot": {"guardrails": {"persistence_available": True, "learning_frozen": False}}},
        )

        self.assertEqual(payload["status"], "ok")
        self.assertIn("DECISION: STOP", payload["reply"])
        self.assertIn("RISQUE: eleve", payload["reply"])
        self.assertIn("OVERRIDE: possible mais visible", payload["reply"])


class ControlPlaneTradeIntelligenceTests(unittest.TestCase):
    def test_bingx_income_history_events_normalize_realized_funding_and_transfer(self) -> None:
        rows = control_plane._bingx_normalize_income_history_events(
            [
                {
                    "symbol": "BTC-USDT",
                    "asset": "USDT",
                    "incomeType": "REALIZED_PNL",
                    "income": "12.5",
                    "time": 1775953990000,
                    "tranId": "pnl-1",
                    "info": "Sell to Close",
                },
                {
                    "symbol": "BTC-USDT",
                    "asset": "USDT",
                    "incomeType": "FUNDING_FEE",
                    "income": "-0.42",
                    "time": 1775954990000,
                    "tranId": "funding-1",
                    "info": "Funding Fee",
                },
                {
                    "symbol": "",
                    "asset": "USDT",
                    "incomeType": "TRANSFER",
                    "income": "11.0",
                    "time": 1775955990000,
                    "tranId": "transfer-1",
                    "info": "From Fund Account to Perpetual Futures Account",
                },
            ]
        )

        self.assertEqual([row["event_type"] for row in rows], ["realized_pnl", "funding_fee", "internal_transfer"])
        self.assertEqual(rows[0]["external_event_id"], "pnl-1")
        self.assertEqual(rows[0]["amount_usd"], 12.5)
        self.assertEqual(rows[1]["flow_direction"], "debit")
        self.assertEqual(rows[2]["pocket"], "fund")
        self.assertEqual(rows[2]["counterparty"], "futures")

    def test_filter_capital_ledger_rows_prefers_bingx_income_history_over_snapshot_deltas(self) -> None:
        rows = [
            {"source": "bingx-sync-ledger", "event_type": "funding_fee", "amount_usd": 1.0},
            {"source": "bingx-sync-ledger", "event_type": "realized_pnl", "amount_usd": 2.0},
            {"source": control_plane.BINGX_INCOME_HISTORY_SOURCE, "event_type": "funding_fee", "amount_usd": 1.1},
            {"source": control_plane.BINGX_INCOME_HISTORY_SOURCE, "event_type": "realized_pnl", "amount_usd": 2.2},
            {"source": "bingx-sync-ledger", "event_type": "internal_transfer", "amount_usd": 3.0},
        ]

        filtered = control_plane._filter_capital_ledger_rows(rows)

        self.assertEqual(
            [(row["source"], row["event_type"]) for row in filtered],
            [
                (control_plane.BINGX_INCOME_HISTORY_SOURCE, "funding_fee"),
                (control_plane.BINGX_INCOME_HISTORY_SOURCE, "realized_pnl"),
                ("bingx-sync-ledger", "internal_transfer"),
            ],
        )

    def test_binance_income_history_events_normalize_commission_and_realized_pnl(self) -> None:
        rows = control_plane._normalize_binance_income_history_events(
            [
                {
                    "symbol": "BTCUSDT",
                    "asset": "USDT",
                    "incomeType": "REALIZED_PNL",
                    "income": "4.25",
                    "time": 1775953990000,
                    "tranId": "pnl-1",
                    "info": "REALIZED_PNL",
                },
                {
                    "symbol": "BTCUSDT",
                    "asset": "USDT",
                    "incomeType": "COMMISSION",
                    "income": "-0.12",
                    "time": 1775954990000,
                    "tranId": "fee-1",
                    "tradeId": "trade-1",
                    "info": "COMMISSION",
                },
                {
                    "symbol": "",
                    "asset": "USDT",
                    "incomeType": "TRANSFER",
                    "income": "3.0",
                    "time": 1775955990000,
                    "tranId": "transfer-1",
                    "info": "spot to futures",
                },
            ],
            market_type="usdm",
            asset_prices={"USDT": 1.0},
        )

        self.assertEqual([row["event_type"] for row in rows], ["realized_pnl", "trading_fee", "internal_transfer"])
        self.assertEqual(rows[0]["external_event_id"], "usdm:REALIZED_PNL:pnl-1")
        self.assertEqual(rows[1]["amount_usd"], -0.12)
        self.assertEqual(rows[2]["pocket"], "spot")
        self.assertEqual(rows[2]["counterparty"], "futures")

    def test_okx_bill_history_events_split_fee_and_pnl(self) -> None:
        rows = control_plane._normalize_okx_bill_history_events(
            [
                {
                    "billId": "1",
                    "instId": "BTC-USDT-SWAP",
                    "ccy": "USDT",
                    "fee": "-0.08",
                    "pnl": "0.42",
                    "balChg": "0.34",
                    "type": "2",
                    "subType": "1",
                    "ts": "1775953990000",
                },
                {
                    "billId": "2",
                    "instId": "BTC-USDT-SWAP",
                    "ccy": "USDT",
                    "fee": "0",
                    "pnl": "-0.01",
                    "balChg": "-0.01",
                    "type": "8",
                    "subType": "173",
                    "ts": "1775954990000",
                },
            ],
            asset_prices={"USDT": 1.0},
        )

        self.assertEqual([row["event_type"] for row in rows], ["trading_fee", "realized_pnl", "funding_fee"])
        self.assertEqual(rows[0]["amount_usd"], -0.08)
        self.assertEqual(rows[1]["amount_usd"], 0.42)
        self.assertEqual(rows[2]["description"], "OKX funding fee")

    def test_okx_response_error_50119_includes_auth_troubleshooting_hint(self) -> None:
        error = control_plane._okx_response_error(
            "/api/v5/account/balance",
            {"code": "50119", "msg": "API key doesn't exist"},
            http_status=401,
        )

        self.assertIn("API key doesn't exist", str(error))
        self.assertIn("production/demo environment mismatch", str(error))
        self.assertIn("timestamp + method + requestPath + body", str(error))

    def test_okx_auth_debug_report_formats_latest_failure_readably(self) -> None:
        report = control_plane._okx_auth_debug_report(
            {
                "category": "okx_auth_request_failed",
                "timestamp": "2026-05-14T11:22:33+00:00",
                "payload": {
                    "path": "/api/v5/account/balance",
                    "request_path": "/api/v5/account/balance",
                    "http_status": 401,
                    "code": "50119",
                    "detail": "API key doesn't exist",
                    "hint": "Likely causes: missing or wrong production API key.",
                    "base_url": "https://www.okx.com",
                    "has_passphrase": True,
                    "api_key_length": 36,
                    "api_secret_length": 32,
                    "timestamp_format": "iso8601-utc-millis-z",
                    "prehash_shape": "timestamp + method + requestPath + body",
                    "method": "GET",
                },
            }
        )

        self.assertEqual(report["provider"], "okx")
        self.assertEqual(report["status"], "ok")
        self.assertEqual(report["target_environment"], "production")
        self.assertEqual(report["latest_failure"]["code"], "50119")
        self.assertEqual(report["latest_failure"]["api_key_length"], 36)
        self.assertEqual(report["diagnosis"]["classification"], "key_not_recognized_or_environment_mismatch")
        self.assertIn("TXT already attempted a V5-style authenticated request", report["diagnosis"]["summary"])

    def test_recent_okx_auth_debug_report_groups_codes_and_marks_stable_patterns(self) -> None:
        rows = [
            {
                "category": "okx_auth_request_failed",
                "timestamp": "2026-05-14T11:22:33+00:00",
                "payload": {
                    "path": "/api/v5/account/balance",
                    "request_path": "/api/v5/account/balance",
                    "http_status": 401,
                    "code": "50119",
                    "detail": "API key doesn't exist",
                    "hint": "Likely causes: missing or wrong production API key.",
                    "base_url": "https://www.okx.com",
                    "has_passphrase": True,
                    "api_key_length": 36,
                    "api_secret_length": 32,
                    "timestamp_format": "iso8601-utc-millis-z",
                    "prehash_shape": "timestamp + method + requestPath + body",
                    "method": "GET",
                },
            },
            {
                "category": "okx_auth_request_failed",
                "timestamp": "2026-05-14T11:20:01+00:00",
                "payload": {
                    "path": "/api/v5/account/balance",
                    "request_path": "/api/v5/account/balance",
                    "http_status": 401,
                    "code": "50119",
                    "detail": "API key doesn't exist",
                    "hint": "Likely causes: missing or wrong production API key.",
                    "base_url": "https://www.okx.com",
                    "has_passphrase": True,
                    "api_key_length": 36,
                    "api_secret_length": 32,
                    "timestamp_format": "iso8601-utc-millis-z",
                    "prehash_shape": "timestamp + method + requestPath + body",
                    "method": "GET",
                },
            },
        ]

        with patch.object(control_plane, "fetch_all", return_value=rows):
            report = control_plane._recent_okx_auth_debug_report(limit=5)

        self.assertEqual(report["status"], "ok")
        self.assertEqual(len(report["recent_failures"]), 2)
        self.assertEqual(report["frequency"]["by_code"][0], {"code": "50119", "count": 2})
        self.assertEqual(report["frequency"]["by_classification"][0]["classification"], "key_not_recognized_or_environment_mismatch")
        self.assertTrue(report["pattern"]["is_stable"])
        self.assertIn("same code 50119", report["pattern"]["summary"])

    def test_filter_capital_ledger_rows_prefers_binance_income_history_over_snapshot_deltas(self) -> None:
        rows = [
            {"source": "binance-sync-ledger", "event_type": "funding_fee", "amount_usd": 1.0},
            {"source": "binance-sync-ledger", "event_type": "realized_pnl", "amount_usd": 2.0},
            {"source": control_plane.BINANCE_INCOME_HISTORY_SOURCE, "event_type": "funding_fee", "amount_usd": 1.1},
            {"source": control_plane.BINANCE_INCOME_HISTORY_SOURCE, "event_type": "trading_fee", "amount_usd": -0.2},
        ]

        filtered = control_plane._filter_capital_ledger_rows(rows)

        self.assertEqual(
            [(row["source"], row["event_type"]) for row in filtered],
            [
                (control_plane.BINANCE_INCOME_HISTORY_SOURCE, "funding_fee"),
                (control_plane.BINANCE_INCOME_HISTORY_SOURCE, "trading_fee"),
            ],
        )

    def test_performance_ledger_summary_from_rows_computes_true_net(self) -> None:
        now = datetime(2026, 5, 14, 10, 0, tzinfo=timezone.utc)
        rows = [
            {"event_type": "realized_pnl", "amount_usd": 1.5, "occurred_at": now.isoformat()},
            {"event_type": "realized_pnl", "amount_usd": -0.5, "occurred_at": now.isoformat()},
            {"event_type": "funding_fee", "amount_usd": 0.1, "occurred_at": now.isoformat()},
            {"event_type": "trading_fee", "amount_usd": -0.4, "occurred_at": now.isoformat()},
        ]

        summary = control_plane._performance_ledger_summary_from_rows("provider", "bingx", now, now, rows)

        self.assertIsNotNone(summary)
        self.assertEqual(summary["trade_count"], 2)
        self.assertAlmostEqual(summary["realized_pnl_usd"], 1.0)
        self.assertAlmostEqual(summary["net_after_costs_usd"], 0.7)
        self.assertAlmostEqual(summary["win_rate_pct"], 50.0)
        self.assertAlmostEqual(summary["profit_factor"], 3.0)

    def test_performance_summary_falls_back_to_capital_ledger_when_decision_outcomes_empty(self) -> None:
        now = datetime(2026, 5, 14, 10, 0, tzinfo=timezone.utc)
        ledger_rows = [
            {"event_type": "realized_pnl", "amount_usd": 0.8, "occurred_at": now.isoformat(), "source": control_plane.BINGX_INCOME_HISTORY_SOURCE},
            {"event_type": "trading_fee", "amount_usd": -0.3, "occurred_at": now.isoformat(), "source": control_plane.BINGX_INCOME_HISTORY_SOURCE},
        ]

        with patch.object(control_plane, "fetch_one", return_value={"trade_count": 0, "realized_pnl_usd": 0.0, "fees_usd": 0.0, "avg_slippage_bps": 0.0, "avg_latency_ms": 0.0, "wins": 0}), \
             patch.object(control_plane, "fetch_all", return_value=[]), \
             patch.object(control_plane, "_performance_sharpe_ratio", return_value=None), \
             patch.object(control_plane, "_performance_capital_flow_rows", return_value=ledger_rows):
            summary = control_plane._performance_summary("provider", "bingx", now, now)

        self.assertEqual(summary["data_source"], "capital_ledger")
        self.assertEqual(summary["trade_count"], 1)
        self.assertAlmostEqual(summary["realized_pnl_usd"], 0.8)
        self.assertAlmostEqual(summary["net_after_costs_usd"], 0.5)

    def test_performance_summary_prefers_capital_ledger_when_decision_outcomes_are_zeroed(self) -> None:
        now = datetime(2026, 5, 14, 10, 0, tzinfo=timezone.utc)
        ledger_rows = [
            {"event_type": "realized_pnl", "amount_usd": 0.8, "occurred_at": now.isoformat(), "source": control_plane.BINGX_INCOME_HISTORY_SOURCE},
            {"event_type": "trading_fee", "amount_usd": -0.3, "occurred_at": now.isoformat(), "source": control_plane.BINGX_INCOME_HISTORY_SOURCE},
        ]

        with patch.object(control_plane, "fetch_one", return_value={"trade_count": 8, "realized_pnl_usd": 0.0, "fees_usd": 0.0, "avg_slippage_bps": 0.0, "avg_latency_ms": 0.0, "wins": 0}), \
             patch.object(control_plane, "fetch_all", return_value=[]), \
             patch.object(control_plane, "_performance_sharpe_ratio", return_value=None), \
             patch.object(control_plane, "_performance_capital_flow_rows", return_value=ledger_rows):
            summary = control_plane._performance_summary("provider", "bingx", now, now)

        self.assertEqual(summary["data_source"], "capital_ledger")
        self.assertEqual(summary["trade_count"], 1)
        self.assertAlmostEqual(summary["realized_pnl_usd"], 0.8)
        self.assertAlmostEqual(summary["net_after_costs_usd"], 0.5)

    def test_performance_attribution_falls_back_to_capital_ledger_when_decision_rows_are_zeroed(self) -> None:
        now = datetime(2026, 5, 14, 10, 0, tzinfo=timezone.utc)
        ledger_rows = [
            {
                "event_type": "realized_pnl",
                "amount_usd": 0.8,
                "occurred_at": now.isoformat(),
                "source": control_plane.BINGX_INCOME_HISTORY_SOURCE,
                "provider": "bingx",
                "account_id": "acct-1",
                "metadata_json": json.dumps({"symbol": "BTCUSDT"}),
            },
            {
                "event_type": "trading_fee",
                "amount_usd": -0.3,
                "occurred_at": now.isoformat(),
                "source": control_plane.BINGX_INCOME_HISTORY_SOURCE,
                "provider": "bingx",
                "account_id": "acct-1",
                "metadata_json": json.dumps({"symbol": "BTCUSDT"}),
            },
        ]

        with patch.object(control_plane, "fetch_all", return_value=[{"symbol": "BTCUSDT", "realized_pnl_usd": 0.0, "fees_usd": 0.0, "win_rate_pct": 0.0}]), \
             patch.object(control_plane, "_performance_capital_flow_rows", return_value=ledger_rows):
            rows = control_plane._performance_attribution("provider", "bingx", now, now, group_by="symbol")

        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["data_source"], "capital_ledger")
        self.assertEqual(rows[0]["symbol"], "BTCUSDT")
        self.assertAlmostEqual(rows[0]["realized_pnl_usd"], 0.8)
        self.assertAlmostEqual(rows[0]["trading_fee_usd"], -0.3)
        self.assertAlmostEqual(rows[0]["net_after_costs_usd"], 0.5)

    def test_build_trade_intelligence_payload_flags_missing_tp_and_sizing_adjustments(self) -> None:
        now = datetime(2026, 4, 20, 12, 0, tzinfo=timezone.utc)
        rows = [
            {
                "decision_id": "dec-1",
                "strategy_id": "smart-live-v1",
                "symbol": "BTCUSDT",
                "provider": "bingx",
                "regime": "TREND",
                "score_pre_trade": 0.82,
                "slippage_real_bps": 8.2,
                "latency_ms": 640,
                "fees_usd": 0.8,
                "net_result_usd": -7.5,
                "status": "finalized",
                "created_at": now.isoformat(),
                "route_chosen": "bingx",
                "realized_slippage_bps": 8.2,
                "latency_e2e_ms": 640,
                "telemetry_payload": {
                    "router_execution": {
                        "execution_mode": "live-intent",
                        "protection_status": "not_requested",
                    }
                },
                "explainability": {
                    "live_execution": {
                        "enabled": True,
                        "auto_protection": True,
                        "requested_notional_usd": 2.5,
                        "effective_notional_usd": 7.5,
                        "auto_adjustment": {
                            "applied": True,
                            "reason": "venue_min_notional",
                        },
                    }
                },
                "target_notional_usd": 7.5,
                "intent_status": "executed",
                "order_id": "ord-1",
                "requested_notional_usd": 7.5,
                "filled_notional_usd": 7.5,
                "avg_fill_price": 70100.0,
                "execution_mode": "live-intent",
                "order_status": "filled",
            },
            {
                "decision_id": "dec-2",
                "strategy_id": "smart-live-v1",
                "symbol": "BTCUSDT",
                "provider": "bingx",
                "regime": "TREND",
                "score_pre_trade": 0.79,
                "slippage_real_bps": 2.4,
                "latency_ms": 110,
                "fees_usd": 0.6,
                "net_result_usd": 5.0,
                "status": "finalized",
                "created_at": now.replace(minute=1).isoformat(),
                "route_chosen": "bingx",
                "realized_slippage_bps": 2.4,
                "latency_e2e_ms": 110,
                "telemetry_payload": {
                    "router_execution": {
                        "execution_mode": "live-intent",
                        "protection_status": "armed",
                        "protection": {
                            "take_profit": {"trigger_price": 71000.0},
                            "stop_loss": {"trigger_price": 69500.0},
                        },
                    }
                },
                "explainability": {
                    "live_execution": {
                        "enabled": True,
                        "auto_protection": True,
                        "requested_notional_usd": 7.5,
                        "effective_notional_usd": 7.5,
                    }
                },
                "target_notional_usd": 7.5,
                "intent_status": "executed",
                "order_id": "ord-2",
                "requested_notional_usd": 7.5,
                "filled_notional_usd": 7.5,
                "avg_fill_price": 70200.0,
                "execution_mode": "live-intent",
                "order_status": "filled",
            },
        ]

        payload = control_plane._build_trade_intelligence_payload(
            rows,
            scope_type="strategy",
            scope_id="smart-live-v1",
            start=now,
            end=now,
            intent_summary={
                "total_intents": 8,
                "executed_intents": 6,
                "rejected_intents": 2,
                "rejected_preflight_count": 1,
                "rejected_by_risk_count": 1,
                "rejected_by_memory_count": 0,
                "blocked_memory_count": 0,
                "pending_approval_count": 0,
                "pending_opportunity_gate_count": 0,
            },
            trade_limit=50,
        )

        self.assertEqual(payload["status"], "ok")
        self.assertEqual(payload["analysis_mode"], "controlled_read_only")
        self.assertEqual(payload["summary"]["trade_count"], 2)
        self.assertEqual(payload["summary"]["intent_count"], 8)
        self.assertAlmostEqual(payload["summary"]["rejection_rate"], 0.25)
        self.assertEqual(payload["issue_counts"]["tp_missing"], 1)
        self.assertEqual(payload["issue_counts"]["size_adjustment"], 1)
        self.assertIn("tp_missing", payload["issues"])
        self.assertIn("size_adjustment", payload["issues"])
        self.assertIn("rejection_pressure", payload["issues"])
        self.assertGreaterEqual(payload["summary"]["execution_quality"], 0.0)
        self.assertLessEqual(payload["summary"]["execution_quality"], 1.0)
        self.assertEqual(payload["trades"][0]["decision_id"], "dec-2")

    def test_trade_intelligence_trade_from_row_treats_dry_run_as_full_fill(self) -> None:
        trade = control_plane._trade_intelligence_trade_from_row(
            {
                "decision_id": "dry-run-1",
                "symbol": "BTCUSDT",
                "provider": "bingx",
                "regime": "TREND",
                "status": "finalized",
                "slippage_real_bps": 1.1,
                "latency_ms": 90,
                "net_result_usd": 0.0,
                "fees_usd": 0.0,
                "telemetry_payload": {
                    "router_execution": {
                        "execution_mode": "live-intent",
                        "dry_run": True,
                        "protection_status": "armed",
                        "protection": {
                            "take_profit": {"trigger_price": 71000.0},
                        },
                    }
                },
                "explainability": {
                    "live_execution": {
                        "enabled": True,
                        "auto_protection": True,
                        "requested_notional_usd": 7.5,
                        "effective_notional_usd": 7.5,
                    }
                },
                "requested_notional_usd": 7.5,
                "filled_notional_usd": 0.0,
                "execution_mode": "live-intent",
                "order_status": "dry_run",
            }
        )

        self.assertEqual(trade["order_status"], "dry_run")
        self.assertEqual(trade["fill_ratio"], 1.0)
        self.assertNotIn("tp_missing", trade["issues"])


class ControlPlaneImprovementLoopTests(unittest.TestCase):
    def test_build_improvement_proposals_returns_controlled_bundle(self) -> None:
        analytics = {
            "scope_type": "strategy",
            "scope_id": "smart-live-v1",
            "period_start": "2026-04-20T12:00:00+00:00",
            "period_end": "2026-04-20T12:30:00+00:00",
            "summary": {
                "execution_quality": 0.58,
                "slippage_avg_bps": 8.1,
                "latency_avg_ms": 620.0,
                "rejection_rate": 0.24,
                "protection_coverage_pct": 80.0,
                "size_adjustment_rate": 0.75,
            },
            "issue_counts": {
                "tp_missing": 2,
                "size_adjustment": 3,
                "rejected_preflight": 1,
                "rejected_by_risk": 1,
                "rejected_by_memory": 0,
            },
            "issue_details": [
                {"code": "high_slippage", "severity": "warn"},
                {"code": "tp_missing", "severity": "critical"},
            ],
            "by_venue": [
                {
                    "provider": "bingx",
                    "trade_count": 4,
                    "execution_quality_avg": 0.58,
                    "latency_avg_ms": 620.0,
                },
                {
                    "provider": "okx",
                    "trade_count": 2,
                    "execution_quality_avg": 0.73,
                    "latency_avg_ms": 280.0,
                },
            ],
            "trades": [
                {
                    "size_adjustment": True,
                    "requested_notional_usd": 2.5,
                    "effective_notional_usd": 7.5,
                },
                {
                    "size_adjustment": True,
                    "requested_notional_usd": 2.5,
                    "effective_notional_usd": 7.6,
                },
                {
                    "size_adjustment": True,
                    "requested_notional_usd": 3.0,
                    "effective_notional_usd": 7.5,
                },
            ],
        }

        payload = control_plane._build_improvement_proposals(analytics)

        self.assertEqual(payload["status"], "ok")
        self.assertEqual(payload["engine"], "ImprovementProposer")
        self.assertEqual(payload["analysis_mode"], "controlled_proposal_only")
        self.assertEqual(payload["scope_id"], "smart-live-v1")
        self.assertGreaterEqual(payload["proposal_count"], 5)
        action_ids = {proposal["proposal_id"] for proposal in payload["proposals"]}
        self.assertIn("execution_optimization:reduce_max_slippage", action_ids)
        self.assertIn("routing_optimization:prefer_low_latency_venue", action_ids)
        self.assertIn("risk_adjustment:adjust_order_constraints", action_ids)
        self.assertIn("protection_improvement:enforce_tp_sl_generation", action_ids)
        self.assertIn("sizing_optimization:increase_default_notional", action_ids)

    def test_simulate_improvement_proposal_impact_replays_trade_sample_contextually(self) -> None:
        analytics = {
            "summary": {
                "rejection_rate": 0.18,
                "execution_quality": 0.58,
                "slippage_avg_bps": 7.0,
                "latency_avg_ms": 410.0,
                "protection_coverage_pct": 75.0,
                "size_adjustment_rate": 0.33,
            },
            "by_venue": [
                {
                    "provider": "okx",
                    "trade_count": 4,
                    "execution_quality_avg": 0.74,
                    "latency_avg_ms": 160.0,
                }
            ],
            "trades": [
                {
                    "decision_id": "dec-1",
                    "provider": "bingx",
                    "regime": "TREND",
                    "net_result_usd": -8.0,
                    "slippage_bps": 9.2,
                    "latency_ms": 640.0,
                    "fill_ratio": 1.0,
                    "effective_notional_usd": 7.5,
                    "requested_notional_usd": 2.5,
                    "execution_quality": 0.42,
                    "issues": ["high_slippage", "high_latency"],
                    "protection_expected": True,
                    "size_adjustment": True,
                },
                {
                    "decision_id": "dec-2",
                    "provider": "bingx",
                    "regime": "CHOP",
                    "net_result_usd": 4.0,
                    "slippage_bps": 4.4,
                    "latency_ms": 210.0,
                    "fill_ratio": 0.94,
                    "effective_notional_usd": 7.5,
                    "requested_notional_usd": 7.5,
                    "execution_quality": 0.68,
                    "issues": [],
                    "protection_expected": True,
                    "size_adjustment": False,
                },
                {
                    "decision_id": "dec-3",
                    "provider": "bingx",
                    "regime": "TREND",
                    "net_result_usd": 2.2,
                    "slippage_bps": 7.1,
                    "latency_ms": 380.0,
                    "fill_ratio": 0.96,
                    "effective_notional_usd": 7.5,
                    "requested_notional_usd": 7.5,
                    "execution_quality": 0.59,
                    "issues": ["high_slippage"],
                    "protection_expected": True,
                    "size_adjustment": False,
                },
            ],
        }

        simulation = control_plane._simulate_improvement_proposal_impact(
            {
                "proposal_id": "routing_optimization:prefer_low_latency_venue",
                "type": "routing_optimization",
                "action": "prefer_low_latency_venue",
                "current_value": "bingx",
                "suggested_value": "okx",
                "confidence": 0.79,
            },
            context={
                "system_mode": "managed_live",
                "kill_switch_active": False,
                "rejection_rate": 0.18,
                "execution_quality": 0.58,
                "slippage_avg_bps": 7.0,
                "latency_avg_ms": 410.0,
                "protection_coverage": 0.75,
                "size_adjustment_rate": 0.33,
            },
            analytics=analytics,
        )

        self.assertEqual(simulation["simulation_mode"], "contextual_replay")
        self.assertEqual(simulation["sample_size"], 3)
        self.assertLess(simulation["slippage_change_bps"], 0.0)
        self.assertLess(simulation["latency_change_ms"], 0.0)
        self.assertGreater(simulation["expected_gain"], 0.0)
        scenario_names = {row["scenario"] for row in simulation["scenario_results"]}
        self.assertIn("trend", scenario_names)
        self.assertIn("high_volatility", scenario_names)

    def test_simulate_improvement_proposals_returns_engine_payload(self) -> None:
        analytics = {
            "summary": {
                "rejection_rate": 0.08,
                "execution_quality": 0.74,
                "slippage_avg_bps": 3.0,
                "latency_avg_ms": 140.0,
                "protection_coverage_pct": 82.0,
                "size_adjustment_rate": 0.2,
            },
            "trades": [
                {
                    "decision_id": "dec-1",
                    "provider": "bingx",
                    "regime": "TREND",
                    "net_result_usd": -9.0,
                    "slippage_bps": 3.4,
                    "latency_ms": 150.0,
                    "fill_ratio": 1.0,
                    "effective_notional_usd": 7.5,
                    "requested_notional_usd": 7.5,
                    "execution_quality": 0.7,
                    "issues": ["tp_missing"],
                    "protection_expected": True,
                    "size_adjustment": False,
                }
            ],
        }

        payload = control_plane._simulate_improvement_proposals(
            [
                {
                    "proposal_id": "protection_improvement:enforce_tp_sl_generation",
                    "type": "protection_improvement",
                    "action": "enforce_tp_sl_generation",
                    "current_value": 0.82,
                    "suggested_value": 0.98,
                    "confidence": 0.9,
                }
            ],
            analytics=analytics,
        )

        self.assertEqual(payload["status"], "ok")
        self.assertEqual(payload["engine"], "SimulationEngine")
        self.assertEqual(payload["result_count"], 1)
        self.assertEqual(payload["results"][0]["simulation"]["simulation_mode"], "contextual_replay")
        self.assertGreater(payload["results"][0]["simulation"]["delta_pnl_usd"], 0.0)

    def test_build_controlled_deployment_records_keeps_accept_only(self) -> None:
        analytics = {
            "scope_type": "provider",
            "scope_id": "bingx",
            "summary": {
                "trade_count": 8,
                "rejection_rate": 0.08,
                "execution_quality": 0.74,
                "slippage_avg_bps": 3.2,
                "latency_avg_ms": 145.0,
                "pnl_net_usd": 18.5,
            },
        }
        validation = {
            "context": {
                "system_mode": "managed_live",
                "kill_switch_active": False,
            },
            "results": [
                {
                    "decision": "ACCEPT",
                    "confidence_score": 0.88,
                    "reasons": ["expected_gain_supportive"],
                    "proposal": {
                        "proposal_id": "execution_optimization:reduce_max_slippage",
                        "type": "execution_optimization",
                        "action": "reduce_max_slippage",
                        "current_value": 8.0,
                        "suggested_value": 5.0,
                    },
                    "simulation": {
                        "delta_pnl_usd": 4.2,
                        "drawdown_change_usd": 1.0,
                        "slippage_change_bps": -1.8,
                        "latency_change_ms": -60.0,
                        "candidate_drawdown_usd": 6.0,
                    },
                },
                {
                    "decision": "TEST",
                    "proposal": {
                        "proposal_id": "routing_optimization:prefer_low_latency_venue",
                        "type": "routing_optimization",
                    },
                },
            ],
        }

        deployments = control_plane._build_controlled_deployment_records(
            validation,
            analytics,
            deployed_by="operator",
            canary_trade_share_pct=5.0,
            monitoring_window_minutes=90,
            auto_rollback=True,
        )

        self.assertEqual(len(deployments), 1)
        self.assertEqual(deployments[0]["status"], "CANARY")
        self.assertEqual(deployments[0]["proposal_id"], "execution_optimization:reduce_max_slippage")
        self.assertEqual(deployments[0]["rollout"]["canary_trade_share_pct"], 5.0)
        self.assertTrue(deployments[0]["monitoring"]["auto_rollback"])
        self.assertTrue(deployments[0]["monitoring"]["auto_confirm"])
        self.assertEqual(deployments[0]["monitoring"]["min_promotion_trade_samples"], 50)
        self.assertEqual(deployments[0]["promotion"]["decision"], "WATCH")

    def test_evaluate_controlled_deployment_monitoring_recommends_rollback_on_regression(self) -> None:
        deployment = {
            "deployment_id": "deploy_1",
            "status": "CANARY",
            "baseline_metrics": {
                "pnl_net_usd": 12.0,
                "slippage_avg_bps": 3.0,
                "latency_avg_ms": 120.0,
                "rejection_rate": 0.05,
                "drawdown_proxy_usd": 4.0,
            },
            "monitoring": {
                "min_trade_samples": 3,
                "thresholds": {
                    "max_slippage_increase_bps": 1.5,
                    "max_latency_increase_ms": 40.0,
                    "max_rejection_rate_increase": 0.03,
                    "max_drawdown_increase_usd": 3.0,
                    "min_pnl_delta_usd": -5.0,
                },
            },
        }
        analytics = {
            "summary": {
                "trade_count": 5,
                "pnl_net_usd": 2.0,
                "slippage_avg_bps": 5.2,
                "latency_avg_ms": 190.0,
                "rejection_rate": 0.11,
            },
        }

        observation = control_plane._evaluate_controlled_deployment_monitoring_record(
            deployment,
            analytics,
            context={
                "kill_switch_active": False,
            },
        )

        self.assertEqual(observation["status"], "rollback_recommended")
        self.assertTrue(observation["should_rollback"])
        self.assertIn("slippage_regressed", observation["reasons"])
        self.assertIn("latency_regressed", observation["reasons"])
        self.assertIn("pnl_regressed", observation["reasons"])
        self.assertEqual(observation["promotion"]["decision"], "ROLLBACK")

    def test_evaluate_controlled_deployment_monitoring_recommends_scale_down_on_mild_regression(self) -> None:
        deployment = {
            "deployment_id": "deploy_scale_down",
            "status": "CANARY",
            "baseline_metrics": {
                "pnl_net_usd": 12.0,
                "slippage_avg_bps": 3.0,
                "latency_avg_ms": 120.0,
                "rejection_rate": 0.04,
                "drawdown_proxy_usd": 4.0,
                "execution_quality": 0.72,
            },
            "monitoring": {
                "min_trade_samples": 3,
                "thresholds": {
                    "max_slippage_increase_bps": 1.5,
                    "max_latency_increase_ms": 40.0,
                    "max_rejection_rate_increase": 0.03,
                    "max_drawdown_increase_usd": 3.0,
                    "min_pnl_delta_usd": -5.0,
                    "min_execution_quality": 0.62,
                    "min_promotion_score": 0.72,
                    "scale_down_on_score_below": 0.58,
                    "severe_regression_ratio": 1.35,
                },
            },
            "rollout": {
                "phase": "CANARY",
                "canary_trade_share_pct": 10.0,
                "remaining_trade_share_pct": 90.0,
                "minimum_canary_trade_share_pct": 2.0,
                "scale_down_step_pct": 5.0,
            },
        }
        analytics = {
            "summary": {
                "trade_count": 6,
                "pnl_net_usd": 18.0,
                "slippage_avg_bps": 4.6,
                "latency_avg_ms": 130.0,
                "rejection_rate": 0.04,
                "execution_quality": 0.86,
            },
        }

        observation = control_plane._evaluate_controlled_deployment_monitoring_record(
            deployment,
            analytics,
            context={
                "kill_switch_active": False,
            },
        )

        self.assertEqual(observation["status"], "scale_down_recommended")
        self.assertFalse(observation["should_rollback"])
        self.assertTrue(observation["should_scale_down"])
        self.assertEqual(observation["promotion"]["decision"], "SCALE_DOWN")
        self.assertEqual(observation["promotion"]["promotion_mode"], "SCALE_DOWN")
        self.assertEqual(observation["promotion"]["suggested_canary_trade_share_pct"], 5.0)

    def test_evaluate_controlled_deployment_monitoring_uses_fast_promotion_ramp_when_signal_is_strong(self) -> None:
        deployment = {
            "deployment_id": "deploy_fast_promote",
            "status": "CANARY",
            "baseline_metrics": {
                "pnl_net_usd": 12.0,
                "slippage_avg_bps": 3.0,
                "latency_avg_ms": 120.0,
                "rejection_rate": 0.04,
                "drawdown_proxy_usd": 4.0,
                "execution_quality": 0.8,
            },
            "validation": {
                "confidence_score": 0.94,
            },
            "monitoring": {
                "window_minutes": 90,
                "started_at": (datetime.now(timezone.utc) - timedelta(minutes=20)).isoformat(),
                "min_trade_samples": 3,
                "min_promotion_trade_samples": 8,
                "thresholds": {
                    "max_slippage_increase_bps": 1.5,
                    "max_latency_increase_ms": 40.0,
                    "max_rejection_rate_increase": 0.03,
                    "max_drawdown_increase_usd": 3.0,
                    "min_pnl_delta_usd": -5.0,
                    "min_execution_quality": 0.62,
                    "min_promotion_score": 0.72,
                    "scale_down_on_score_below": 0.58,
                    "severe_regression_ratio": 1.35,
                },
            },
            "rollout": {
                "phase": "CANARY",
                "canary_trade_share_pct": 5.0,
                "remaining_trade_share_pct": 95.0,
                "minimum_canary_trade_share_pct": 2.0,
                "scale_down_step_pct": 2.5,
            },
        }
        analytics = {
            "summary": {
                "trade_count": 8,
                "pnl_net_usd": 25.0,
                "slippage_avg_bps": 2.8,
                "latency_avg_ms": 110.0,
                "rejection_rate": 0.03,
                "execution_quality": 0.91,
            },
        }

        observation = control_plane._evaluate_controlled_deployment_monitoring_record(
            deployment,
            analytics,
            context={
                "kill_switch_active": False,
            },
        )

        self.assertEqual(observation["status"], "promotion_ready")
        self.assertTrue(observation["should_promote"])
        self.assertEqual(observation["promotion"]["promotion_mode"], "PROMOTE_FAST")
        self.assertEqual(observation["promotion"]["score_zone"], "PROMOTE")
        self.assertEqual(observation["promotion"]["suggested_promotion_trade_share_pct"], 25.0)

    def test_evaluate_controlled_deployment_monitoring_blocks_promotion_below_50_trades(self) -> None:
        deployment = {
            "deployment_id": "deploy_insufficient_data",
            "status": "CANARY",
            "baseline_metrics": {
                "pnl_net_usd": 12.0,
                "slippage_avg_bps": 3.0,
                "latency_avg_ms": 120.0,
                "rejection_rate": 0.04,
                "drawdown_proxy_usd": 4.0,
                "execution_quality": 0.8,
            },
            "validation": {
                "confidence_score": 0.92,
            },
            "monitoring": {
                "window_minutes": 90,
                "started_at": (datetime.now(timezone.utc) - timedelta(minutes=120)).isoformat(),
                "min_trade_samples": 3,
                "min_promotion_trade_samples": 50,
                "thresholds": {
                    "max_slippage_increase_bps": 1.5,
                    "max_latency_increase_ms": 40.0,
                    "max_rejection_rate_increase": 0.03,
                    "max_drawdown_increase_usd": 3.0,
                    "min_pnl_delta_usd": -5.0,
                    "min_execution_quality": 0.62,
                    "min_promotion_score": 0.72,
                    "scale_down_on_score_below": 0.58,
                    "severe_regression_ratio": 1.35,
                },
            },
            "rollout": {
                "phase": "CANARY",
                "canary_trade_share_pct": 5.0,
                "remaining_trade_share_pct": 95.0,
                "minimum_canary_trade_share_pct": 2.0,
                "scale_down_step_pct": 2.5,
            },
        }
        analytics = {
            "summary": {
                "trade_count": 32,
                "pnl_net_usd": 24.0,
                "slippage_avg_bps": 2.8,
                "latency_avg_ms": 110.0,
                "rejection_rate": 0.03,
                "execution_quality": 0.9,
            },
        }

        observation = control_plane._evaluate_controlled_deployment_monitoring_record(
            deployment,
            analytics,
            context={
                "kill_switch_active": False,
            },
        )

        self.assertEqual(observation["status"], "insufficient_data")
        self.assertFalse(observation["should_promote"])
        self.assertEqual(observation["promotion"]["decision"], "INSUFFICIENT_DATA")
        self.assertTrue(observation["promotion"]["insufficient_data"])
        self.assertEqual(observation["promotion"]["trade_count"], 32)
        self.assertEqual(observation["promotion"]["min_promotion_trade_samples"], 50)
        self.assertIn("Observation valid but insufficient for promotion", observation["promotion"]["operator_message"])

    def test_evaluate_controlled_deployment_monitoring_applies_confidence_decay_after_window_expiry(self) -> None:
        deployment = {
            "deployment_id": "deploy_decay",
            "status": "CANARY",
            "baseline_metrics": {
                "pnl_net_usd": 12.0,
                "slippage_avg_bps": 3.0,
                "latency_avg_ms": 120.0,
                "rejection_rate": 0.04,
                "drawdown_proxy_usd": 4.0,
                "execution_quality": 0.76,
            },
            "validation": {
                "confidence_score": 0.88,
            },
            "monitoring": {
                "window_minutes": 60,
                "started_at": (datetime.now(timezone.utc) - timedelta(hours=6)).isoformat(),
                "min_trade_samples": 3,
                "thresholds": {
                    "max_slippage_increase_bps": 1.5,
                    "max_latency_increase_ms": 40.0,
                    "max_rejection_rate_increase": 0.03,
                    "max_drawdown_increase_usd": 3.0,
                    "min_pnl_delta_usd": -5.0,
                    "min_execution_quality": 0.62,
                    "min_promotion_score": 0.72,
                    "scale_down_on_score_below": 0.58,
                    "severe_regression_ratio": 1.35,
                },
            },
            "rollout": {
                "phase": "CANARY",
                "canary_trade_share_pct": 10.0,
                "remaining_trade_share_pct": 90.0,
                "minimum_canary_trade_share_pct": 2.0,
                "scale_down_step_pct": 5.0,
            },
        }
        analytics = {
            "summary": {
                "trade_count": 6,
                "pnl_net_usd": 18.0,
                "slippage_avg_bps": 3.1,
                "latency_avg_ms": 122.0,
                "rejection_rate": 0.04,
                "execution_quality": 0.84,
            },
        }

        observation = control_plane._evaluate_controlled_deployment_monitoring_record(
            deployment,
            analytics,
            context={
                "kill_switch_active": False,
            },
        )

        self.assertLess(observation["promotion"]["confidence_decay"], 1.0)
        self.assertLess(observation["promotion"]["effective_score"], observation["promotion"]["score"])

    def test_apply_controlled_deployment_promotion_scales_up_canary_before_full_rollout(self) -> None:
        deployment = {
            "deployment_id": "deploy_promote",
            "status": "CANARY",
            "monitoring": {
                "status": "active",
                "window_minutes": 90,
                "min_trade_samples": 3,
                "auto_rollback": True,
                "auto_confirm": True,
            },
            "rollout": {
                "phase": "CANARY",
                "canary_trade_share_pct": 5.0,
                "remaining_trade_share_pct": 95.0,
                "minimum_canary_trade_share_pct": 1.0,
                "scale_down_step_pct": 2.5,
            },
            "promotion": {
                "decision": "PROMOTE",
            },
        }

        promoted = control_plane._apply_controlled_deployment_promotion(
            deployment,
            promoted_by="operator",
            score=0.84,
            score_breakdown={"pnl_score": 0.9, "risk_score": 0.8, "execution_score": 0.82},
            reason="score_gate_passed",
            mode="automatic",
            target_canary_trade_share_pct=10.0,
            promotion_mode="PROMOTE_SLOW",
        )

        self.assertEqual(promoted["status"], "CANARY")
        self.assertEqual(promoted["rollout"]["phase"], "PROMOTED_STEP")
        self.assertEqual(promoted["rollout"]["canary_trade_share_pct"], 10.0)
        self.assertEqual(promoted["rollout"]["remaining_trade_share_pct"], 90.0)
        self.assertEqual(promoted["promotion"]["decision"], "PROMOTE")
        self.assertEqual(promoted["promotion"]["status"], "scaled_up")
        self.assertEqual(promoted["promotion"]["target_canary_trade_share_pct"], 10.0)
        self.assertEqual(promoted["promotion"]["promotion_mode"], "PROMOTE_SLOW")

    def test_apply_controlled_deployment_promotion_confirms_full_rollout(self) -> None:
        deployment = {
            "deployment_id": "deploy_confirm",
            "status": "CANARY",
            "monitoring": {
                "status": "active",
                "window_minutes": 90,
                "min_trade_samples": 3,
                "auto_rollback": True,
                "auto_confirm": True,
            },
            "rollout": {
                "phase": "PROMOTED_STEP",
                "canary_trade_share_pct": 50.0,
                "remaining_trade_share_pct": 50.0,
                "minimum_canary_trade_share_pct": 5.0,
                "scale_down_step_pct": 10.0,
            },
            "promotion": {
                "decision": "PROMOTE",
            },
        }

        promoted = control_plane._apply_controlled_deployment_promotion(
            deployment,
            promoted_by="operator",
            score=0.92,
            score_breakdown={"pnl_score": 0.95, "risk_score": 0.9, "execution_score": 0.91},
            reason="score_gate_passed",
            mode="automatic",
            target_canary_trade_share_pct=100.0,
            promotion_mode="PROMOTE_FAST",
        )

        self.assertEqual(promoted["status"], "CONFIRMED")
        self.assertEqual(promoted["rollout"]["phase"], "CONFIRMED")
        self.assertEqual(promoted["rollout"]["canary_trade_share_pct"], 100.0)
        self.assertEqual(promoted["rollout"]["remaining_trade_share_pct"], 0.0)
        self.assertEqual(promoted["promotion"]["decision"], "PROMOTE")
        self.assertEqual(promoted["promotion"]["status"], "auto_confirmed")
        self.assertEqual(promoted["promotion"]["promotion_mode"], "PROMOTE_FAST")

    def test_normalize_controlled_deployment_record_keeps_adaptive_promotion_signals(self) -> None:
        deployment = control_plane._normalize_controlled_deployment_record(
            {
                "deployment_id": "deploy_signals",
                "status": "CANARY",
                "rollout": {
                    "phase": "CANARY",
                    "canary_trade_share_pct": 10.0,
                    "remaining_trade_share_pct": 90.0,
                },
                "promotion": {
                    "decision": "PROMOTE",
                    "status": "watch",
                    "score": 0.88,
                    "effective_score": 0.81,
                    "risk_adjustment": 0.92,
                    "confidence_decay": 0.96,
                    "confidence_adjustment": 0.9,
                    "validation_confidence": 0.93,
                    "risk_pressure": 0.21,
                    "target_canary_trade_share_pct": 25.0,
                    "suggested_canary_trade_share_pct": 25.0,
                    "suggested_promotion_trade_share_pct": 25.0,
                    "suggested_scale_down_trade_share_pct": 5.0,
                    "promotion_mode": "PROMOTE_FAST",
                },
            }
        )

        self.assertEqual(deployment["promotion"]["promotion_mode"], "PROMOTE_FAST")
        self.assertAlmostEqual(deployment["promotion"]["effective_score"], 0.81)
        self.assertAlmostEqual(deployment["promotion"]["risk_adjustment"], 0.92)
        self.assertAlmostEqual(deployment["promotion"]["confidence_decay"], 0.96)
        self.assertEqual(deployment["promotion"]["suggested_promotion_trade_share_pct"], 25.0)

    def test_controlled_deployment_portfolio_governor_allocates_and_caps_concentration(self) -> None:
        state = {
            "deployments": [
                {
                    "deployment_id": "deploy_fast",
                    "scope_type": "strategy",
                    "scope_id": "alpha",
                    "status": "CANARY",
                    "rollout": {
                        "phase": "PROMOTED_STEP",
                        "canary_trade_share_pct": 25.0,
                        "remaining_trade_share_pct": 75.0,
                        "minimum_canary_trade_share_pct": 5.0,
                        "scale_down_step_pct": 10.0,
                    },
                    "promotion": {
                        "decision": "PROMOTE",
                        "promotion_mode": "PROMOTE_FAST",
                        "score": 0.93,
                        "effective_score": 0.89,
                        "risk_adjustment": 0.98,
                        "confidence_decay": 0.97,
                        "target_canary_trade_share_pct": 50.0,
                    },
                },
                {
                    "deployment_id": "deploy_reduce",
                    "scope_type": "strategy",
                    "scope_id": "beta",
                    "status": "CANARY",
                    "rollout": {
                        "phase": "SCALED_DOWN",
                        "canary_trade_share_pct": 10.0,
                        "remaining_trade_share_pct": 90.0,
                        "minimum_canary_trade_share_pct": 2.0,
                        "scale_down_step_pct": 5.0,
                    },
                    "promotion": {
                        "decision": "SCALE_DOWN",
                        "promotion_mode": "SCALE_DOWN",
                        "score": 0.7,
                        "effective_score": 0.64,
                        "risk_adjustment": 0.82,
                        "confidence_decay": 0.94,
                        "target_canary_trade_share_pct": 5.0,
                        "reasons": ["slippage_regressed"],
                    },
                },
            ]
        }
        monitoring_results = [
            {
                "deployment": state["deployments"][0],
                "observation": {
                    "should_promote": True,
                    "promotion": {
                        "decision": "PROMOTE",
                        "promotion_mode": "PROMOTE_FAST",
                        "score": 0.93,
                        "effective_score": 0.89,
                        "risk_adjustment": 0.98,
                        "confidence_decay": 0.97,
                        "target_canary_trade_share_pct": 50.0,
                    },
                },
            },
            {
                "deployment": state["deployments"][1],
                "observation": {
                    "should_scale_down": True,
                    "reasons": ["slippage_regressed"],
                    "promotion": {
                        "decision": "SCALE_DOWN",
                        "promotion_mode": "SCALE_DOWN",
                        "score": 0.7,
                        "effective_score": 0.64,
                        "risk_adjustment": 0.82,
                        "confidence_decay": 0.94,
                        "target_canary_trade_share_pct": 5.0,
                        "reasons": ["slippage_regressed"],
                    },
                },
            },
        ]

        governor = control_plane._controlled_deployment_portfolio_governor(state, monitoring_results)

        self.assertEqual(governor["engine"], "ControlledDeploymentPortfolioGovernor")
        self.assertEqual(governor["portfolio_action"], "REDUCE")
        self.assertEqual(len(governor["strategies"]), 2)
        self.assertLessEqual(governor["summary"]["largest_allocation_pct"], 55.0)
        self.assertTrue(governor["summary"]["concentration_capped"])
        self.assertEqual(governor["strategies"][0]["scope_id"], "alpha")
        self.assertEqual(governor["strategies"][0]["recommended_action"], "PROMOTE_FAST")

    def test_validate_improvement_proposals_accepts_safe_protection_change_in_managed_live(self) -> None:
        analytics = {
            "summary": {
                "protection_coverage_pct": 82.0,
                "rejection_rate": 0.08,
                "execution_quality": 0.74,
                "slippage_avg_bps": 3.0,
                "latency_avg_ms": 140.0,
                "size_adjustment_rate": 0.2,
            },
            "issue_counts": {
                "rejected_preflight": 1,
                "rejected_by_risk": 0,
            },
        }
        proposals = [
            {
                "proposal_id": "protection_improvement:enforce_tp_sl_generation",
                "type": "protection_improvement",
                "action": "enforce_tp_sl_generation",
                "current_value": 0.82,
                "suggested_value": 0.98,
                "confidence": 0.9,
            }
        ]

        payload = control_plane._validate_improvement_proposals(
            proposals,
            context={
                "system_mode": "managed_live",
                "kill_switch_active": False,
                "rejection_rate": 0.08,
                "execution_quality": 0.74,
                "slippage_avg_bps": 3.0,
                "latency_avg_ms": 140.0,
                "protection_coverage": 0.82,
                "size_adjustment_rate": 0.2,
            },
            analytics=analytics,
        )

        self.assertEqual(payload["status"], "ok")
        self.assertEqual(payload["engine"], "ValidationEngine")
        self.assertEqual(payload["decision_counts"]["ACCEPT"], 1)
        self.assertEqual(payload["results"][0]["decision"], "ACCEPT")
        self.assertIn("expected_gain_supportive", payload["results"][0]["reasons"])

    def test_validate_improvement_proposals_rejects_when_kill_switch_active(self) -> None:
        proposals = [
            {
                "proposal_id": "execution_optimization:reduce_max_slippage",
                "type": "execution_optimization",
                "action": "reduce_max_slippage",
                "current_value": 9.0,
                "suggested_value": 6.0,
                "confidence": 0.82,
            }
        ]

        payload = control_plane._validate_improvement_proposals(
            proposals,
            context={
                "system_mode": "managed_live",
                "kill_switch_active": True,
                "rejection_rate": 0.05,
                "execution_quality": 0.7,
                "slippage_avg_bps": 9.0,
                "latency_avg_ms": 180.0,
                "protection_coverage": 0.95,
                "size_adjustment_rate": 0.1,
            },
            analytics={"summary": {}},
        )

        self.assertEqual(payload["decision_counts"]["REJECT"], 1)
        self.assertEqual(payload["results"][0]["decision"], "REJECT")
        self.assertIn("kill_switch_active", payload["results"][0]["reasons"])


if __name__ == "__main__":
    unittest.main()