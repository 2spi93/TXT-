from __future__ import annotations

import asyncio
import json
import unittest
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import HTTPException

from apps.control_plane import main as control_plane
from apps.control_plane.protection_runtime import build_live_position_protection_status, build_position_protection_governor
from apps.mt5_bridge import main as mt5_bridge


class LivePositionProtectionRuntimeTests(unittest.TestCase):
    def test_build_live_position_protection_status_flags_partial_and_governor_recommends_breakeven(self) -> None:
        now = datetime(2026, 5, 15, 12, 0, tzinfo=timezone.utc)
        status = build_live_position_protection_status(
            {
                "position_id": "bingx:acct-1:BTCUSDT:long",
                "account_id": "acct-1",
                "symbol": "BTCUSDT",
                "instrument": "BTCUSDT",
                "side": "long",
                "quantity": 0.01,
                "notional_usd": 720.0,
                "avg_entry_price": 70000.0,
                "mark_price": 70700.0,
                "pnl_unrealized_usd": 7.0,
                "as_of": now.isoformat(),
                "source": "bingx-futures-position",
                "payload": {},
            },
            provider="bingx",
            broker_truth_source="bingx-open-orders+positions",
            requested_protection={
                "stop_loss": {"trigger_price": 69300.0},
                "take_profit": {"trigger_price": 71400.0},
            },
            broker_accepted_protection={
                "stop_loss": {"trigger_price": 69300.0},
                "take_profit": {"trigger_price": 71400.0},
            },
            active_protection={
                "stop_loss": {"trigger_price": 69300.0, "order_type": "STOP_MARKET"},
            },
            stale_after_seconds=300,
            now=now,
        )

        self.assertEqual(status["protection_status"], "protection_partial")
        self.assertEqual(status["missing_legs"], ["take_profit"])
        self.assertTrue(status["live_truth"])
        self.assertGreater(status["pnl_bps"], 90.0)

        governor = build_position_protection_governor(status)

        self.assertEqual(governor["recommended_action"], "MOVE_STOP_TO_BREAKEVEN")
        self.assertEqual(governor["reason"], "breakeven_unlocked")
        self.assertTrue(governor["actionable"])
        self.assertEqual(governor["execution_capability"], "cancel_replace")
        self.assertEqual(governor["suggested_protection"]["stop_loss"]["trigger_price"], 70000.0)


class LiveExposureFreshnessTests(unittest.TestCase):
    def test_account_live_exposure_snapshot_ignores_stale_positions(self) -> None:
        fresh_as_of = datetime.now(timezone.utc).isoformat()
        stale_as_of = (datetime.now(timezone.utc) - timedelta(minutes=20)).isoformat()
        with patch.object(control_plane, "_latest_account_balances", return_value=[{"equity_usd": 1000.0}]), \
             patch.object(
                 control_plane,
                 "_latest_account_positions",
                 return_value=[
                     {
                         "position_id": "fresh",
                         "account_id": "acct-1",
                         "symbol": "BTCUSDT",
                         "instrument": "BTCUSDT",
                         "side": "long",
                         "notional_usd": 100.0,
                         "as_of": fresh_as_of,
                         "source": "bingx-futures-position",
                         "payload": {},
                     },
                     {
                         "position_id": "stale",
                         "account_id": "acct-1",
                         "symbol": "ETHUSDT",
                         "instrument": "ETHUSDT",
                         "side": "long",
                         "notional_usd": 250.0,
                         "as_of": stale_as_of,
                         "source": "bingx-futures-position",
                         "payload": {},
                     },
                 ],
             ), \
             patch.object(control_plane, "_portfolio_ids_for_account", return_value=["pf-1"]):
            snapshot = control_plane._account_live_exposure_snapshot("acct-1", "BTCUSDT", 50.0)

        self.assertEqual(snapshot["positions_count"], 2)
        self.assertEqual(snapshot["live_positions_count"], 1)
        self.assertEqual(snapshot["stale_positions_count"], 1)
        self.assertTrue(snapshot["freshness_locked"])
        self.assertAlmostEqual(snapshot["gross_exposure_usd"], 100.0)
        self.assertAlmostEqual(snapshot["projected_total_exposure_pct"], 15.0)


class Mt5BrokerTruthPreferenceTests(unittest.TestCase):
    def test_merge_mt5_broker_state_metadata_updates_positions_and_protective_orders(self) -> None:
        metadata = mt5_bridge._merge_mt5_broker_state_metadata(
            {
                "currency": "USD",
                "positions": [{"symbol": "OLD", "quantity": 1.0}],
                "protective_orders": [{"order_id": "old"}],
                "broker_session": {"snapshot_url": "http://bridge.local/state", "payload_path": "payload"},
            },
            {
                "positions": [{"symbol": "EURUSD", "quantity": 1.2}],
                "protective_orders": [{"order_id": "sl-1", "symbol": "EURUSD", "trigger_price": 1.075}],
                "balances": [{"asset_symbol": "USD", "equity_usd": 25000.0}],
                "session": {"terminal": "mt5-main", "connected": True},
                "truth_source": "mt5-broker-state",
                "as_of": "2026-05-15T11:55:00+00:00",
            },
        )

        self.assertEqual(metadata["positions"][0]["symbol"], "EURUSD")
        self.assertEqual(metadata["protective_orders"][0]["order_id"], "sl-1")
        self.assertEqual(metadata["balances"][0]["asset_symbol"], "USD")
        self.assertEqual(metadata["broker_session"]["snapshot_url"], "http://bridge.local/state")
        self.assertEqual(metadata["broker_runtime_session"]["terminal"], "mt5-main")
        self.assertEqual(metadata["truth_source"], "mt5-broker-state")
        self.assertEqual(metadata["broker_state_updated_at"], "2026-05-15T11:55:00+00:00")

    def test_account_normalized_state_prefers_broker_positions_and_exposes_protective_orders(self) -> None:
        account_row = {
            "account_id": "mt5-1",
            "mode": "live",
            "status": "connected",
            "metadata": {
                "currency": "USD",
                "equity": 25000.0,
                "positions": [
                    {
                        "position_id": "mt5:mt5-1:EURUSD",
                        "symbol": "EURUSD",
                        "side": "long",
                        "quantity": 1.2,
                        "avg_entry_price": 1.08,
                        "mark_price": 1.0825,
                        "notional_usd": 129900.0,
                        "pnl_unrealized_usd": 300.0,
                        "as_of": "2026-05-15T11:55:00+00:00",
                    }
                ],
                "protective_orders": [
                    {
                        "order_id": "sl-1",
                        "symbol": "EURUSD",
                        "position_side": "LONG",
                        "order_type": "SL",
                        "trigger_price": 1.075,
                        "as_of": "2026-05-15T11:55:00+00:00",
                    },
                    {
                        "order_id": "tp-1",
                        "symbol": "EURUSD",
                        "position_side": "LONG",
                        "order_type": "TP",
                        "trigger_price": 1.09,
                        "as_of": "2026-05-15T11:55:00+00:00",
                    },
                ],
            },
        }
        with patch.object(mt5_bridge, "fetch_one", return_value=account_row):
            payload = asyncio.run(mt5_bridge.account_normalized_state("mt5-1"))

        self.assertEqual(payload["truth_source"], "mt5-broker-state")
        self.assertEqual(payload["positions_source"], "mt5-broker-state")
        self.assertEqual(payload["summary"]["protective_order_count"], 2)
        self.assertEqual(payload["positions"][0]["source"], "mt5-broker-position")
        self.assertEqual(payload["positions"][0]["payload"]["truth_source"], "mt5-broker-state")
        self.assertEqual(payload["protective_orders"][0]["source"], "mt5-broker-protective-order")

    def test_merge_mt5_broker_session_metadata_updates_existing_session(self) -> None:
        metadata = mt5_bridge._merge_mt5_broker_session_metadata(
            {
                "broker_session": {
                    "terminal": "mt5-main",
                    "snapshot_url": "http://old/session",
                }
            },
            {
                "snapshot_url": "http://new/session",
                "payload_path": "payload",
            },
        )

        self.assertEqual(metadata["broker_session"]["terminal"], "mt5-main")
        self.assertEqual(metadata["broker_session"]["snapshot_url"], "http://new/session")
        self.assertEqual(metadata["broker_session"]["payload_path"], "payload")

    def test_filter_order_live_requires_execution_url(self) -> None:
        request = mt5_bridge.Mt5OrderFilterRequest(
            account_id="mt5-live-1",
            symbol="BTCUSD",
            side="buy",
            lots=0.01,
            estimated_notional_usd=5.0,
            max_spread_bps=25,
        )

        with patch.object(
            mt5_bridge,
            "fetch_one",
            return_value={"account_id": "mt5-live-1", "mode": "live", "status": "connected", "metadata": {}},
        ):
            with self.assertRaises(HTTPException) as ctx:
                asyncio.run(mt5_bridge.filter_order(request))

        self.assertEqual(ctx.exception.status_code, 503)
        self.assertEqual(ctx.exception.detail["status"], "mt5_live_execution_unconfigured")

    def test_filter_order_live_uses_external_execution_and_persists_broker_state(self) -> None:
        request = mt5_bridge.Mt5OrderFilterRequest(
            account_id="mt5-live-1",
            symbol="BTCUSD",
            side="buy",
            lots=0.01,
            estimated_notional_usd=5.0,
            max_spread_bps=25,
            rationale="micro smoke",
            risk_gate={"decision": "accept"},
            chosen_route={"venue": "mt5", "last": 69000.0},
        )
        account_row = {
            "account_id": "mt5-live-1",
            "mode": "live",
            "status": "connected",
            "metadata": {
                "broker_session": {
                    "execution_url": "http://executor.local/orders",
                    "truth_source": "mt5-external-session",
                }
            },
        }
        execute_calls: list[tuple[str, tuple | None]] = []

        class FakeResponse:
            status_code = 200

            def json(self) -> dict:
                return {
                    "status": "filled",
                    "broker_ticket": "ftmo-123",
                    "realized_slippage_bps": 1.2,
                    "latency_ms": 91,
                    "broker_state": {
                        "positions": [{"symbol": "BTCUSD", "quantity": 0.01, "side": "long", "mark_price": 69010.0, "avg_entry_price": 69000.0, "notional_usd": 690.1}],
                        "balances": [{"asset_symbol": "USD", "equity_usd": 25000.0}],
                    },
                    "session": {"terminal": "ftmo-live", "connected": True},
                }

        class FakeAsyncClient:
            requests: list[dict] = []

            def __init__(self, *args, **kwargs) -> None:
                del args, kwargs

            async def __aenter__(self) -> "FakeAsyncClient":
                return self

            async def __aexit__(self, exc_type, exc, tb) -> bool:
                del exc_type, exc, tb
                return False

            async def get(self, url: str, params: dict | None = None) -> FakeResponse:
                self.requests.append({"method": "GET", "url": url, "params": params})
                response = FakeResponse()
                response.json = lambda: {"instrument": "BTCUSD", "session": "asia", "source": "market-data"}
                return response

            async def request(self, method: str, url: str, headers: dict | None = None, params: dict | None = None, json: dict | None = None) -> FakeResponse:
                self.requests.append({"method": method, "url": url, "headers": headers, "params": params, "json": json})
                return FakeResponse()

        def record_execute(query: str, params: tuple | None = None) -> None:
            execute_calls.append((query, params))

        with patch.object(mt5_bridge, "fetch_one", return_value=account_row), \
             patch.object(mt5_bridge.httpx, "AsyncClient", FakeAsyncClient), \
             patch.object(mt5_bridge, "execute", side_effect=record_execute):
            payload = asyncio.run(mt5_bridge.filter_order(request))

        self.assertEqual(payload["status"], "filled")
        self.assertEqual(payload["broker_ticket"], "ftmo-123")
        self.assertEqual(payload["tradability"]["market_type"], "crypto")
        update_sql = next(call for call in execute_calls if "UPDATE mt5_accounts" in call[0])
        insert_sql = next(call for call in execute_calls if "INSERT INTO mt5_order_events" in call[0])
        self.assertIn("ftmo-live", str(update_sql[1]))
        self.assertIn("BTCUSD", str(insert_sql[1]))
        self.assertIn("filled", str(insert_sql[1]))

    def test_commands_mql_polls_persisted_order_commands(self) -> None:
        now = datetime(2026, 5, 22, 12, 0, tzinfo=timezone.utc)
        account_row = {"account_id": "541283177", "mode": "live", "status": "connected", "metadata": {}}
        command_row = {
            "command_id": "mt5cmd-1",
            "account_id": "541283177",
            "requested_account_id": "mt5-live-1",
            "client_id": "ftmo-ld6-bridge",
            "command_type": "place_order",
            "status": "inflight",
            "payload": {"symbol": "BTCUSD", "side": "buy", "lots": 0.01},
            "created_at": now,
            "expires_at": now + timedelta(minutes=2),
        }
        execute_calls: list[tuple[str, tuple | None]] = []

        with patch.object(mt5_bridge, "_resolve_runtime_account", return_value=(account_row, "mt5-live-1")), \
             patch.object(mt5_bridge, "fetch_all", return_value=[command_row]) as fetch_all_mock, \
             patch.object(mt5_bridge, "execute", side_effect=lambda query, params=None: execute_calls.append((query, params))):
            payload = asyncio.run(mt5_bridge.account_commands_mql("mt5-live-1", client_id="ftmo-ld6-bridge", limit=5))

        self.assertEqual(payload["status"], "ok")
        self.assertEqual(payload["account_id"], "541283177")
        self.assertEqual(payload["requested_account_id"], "mt5-live-1")
        self.assertEqual(payload["commands"][0]["command_id"], "mt5cmd-1")
        self.assertEqual(payload["commands"][0]["payload"]["symbol"], "BTCUSD")
        self.assertIn("UPDATE mt5_order_commands", fetch_all_mock.call_args[0][0])
        self.assertTrue(any("status = 'expired'" in call[0] for call in execute_calls))

    def test_live_execution_via_mql_queue_requires_real_broker_ticket(self) -> None:
        request = mt5_bridge.Mt5OrderFilterRequest(
            account_id="541283177",
            symbol="BTCUSD",
            side="buy",
            lots=0.01,
            estimated_notional_usd=5.0,
            max_spread_bps=25,
            chosen_route={"venue": "mt5"},
        )
        account_row = {
            "account_id": "541283177",
            "mode": "live",
            "status": "connected",
            "metadata": {
                "broker_session": {"execution_mode": "mql_command_queue", "client_id": "ftmo-ld6-bridge", "execution_timeout_seconds": 3},
                "broker_runtime_session": {"client_id": "ftmo-ld6-bridge", "connected": True},
            },
        }

        async def fake_tradability(account: dict, symbol: str) -> dict:
            del account, symbol
            return {"tradable": True, "reason": "continuous_market", "market_type": "crypto"}

        async def fake_wait(command_id: str, timeout_seconds: float) -> dict:
            del command_id, timeout_seconds
            return {"status": "executed", "result_payload": {"status": "executed"}, "broker_ticket": "", "error_message": ""}

        with patch.object(mt5_bridge, "_evaluate_mt5_market_tradability", side_effect=fake_tradability), \
             patch.object(mt5_bridge, "_enqueue_mt5_order_command", return_value="mt5cmd-2"), \
             patch.object(mt5_bridge, "_wait_for_mt5_command_result", side_effect=fake_wait):
            with self.assertRaises(HTTPException) as ctx:
                asyncio.run(mt5_bridge._execute_live_order_via_mql_command_queue(account_row, request))

        self.assertEqual(ctx.exception.status_code, 409)
        self.assertEqual(ctx.exception.detail["status"], "mt5_ea_execution_rejected")
        self.assertEqual(ctx.exception.detail["command_id"], "mt5cmd-2")

    def test_evaluate_mt5_market_tradability_blocks_eurusd_on_weekend_but_not_btc(self) -> None:
        class SaturdayDateTime(datetime):
            @classmethod
            def now(cls, tz=None):
                return cls(2026, 5, 23, 0, 20, tzinfo=tz or timezone.utc)

        account_row = {"account_id": "mt5-live-1", "mode": "live", "status": "connected", "metadata": {}}

        async def fake_snapshot(symbol: str) -> dict:
            return {"instrument": symbol, "session": "asia", "source": "market-data"}

        with patch.object(mt5_bridge, "datetime", SaturdayDateTime), \
             patch.object(mt5_bridge, "_resolve_market_session_snapshot", side_effect=fake_snapshot):
            eurusd = asyncio.run(mt5_bridge._evaluate_mt5_market_tradability(account_row, "EURUSD"))
            btcusd = asyncio.run(mt5_bridge._evaluate_mt5_market_tradability(account_row, "BTCUSD"))

        self.assertFalse(eurusd["tradable"])
        self.assertEqual(eurusd["reason"], "weekend_market_closed")
        self.assertTrue(btcusd["tradable"])
        self.assertEqual(btcusd["reason"], "continuous_market")


class Mt5ExternalBrokerStateSourceTests(unittest.TestCase):
    def test_extract_mt5_external_broker_state_payload_supports_nested_snapshot(self) -> None:
        payload = {
            "data": {
                "snapshot": {
                    "broker_state": {
                        "positions": [{"symbol": "EURUSD", "quantity": 1.2}],
                        "protective_orders": [{"order_id": "sl-1"}],
                    }
                }
            }
        }

        extracted = control_plane._extract_mt5_external_broker_state_payload(payload, payload_path="data.snapshot")

        self.assertIsNotNone(extracted)
        self.assertEqual(extracted["positions"][0]["symbol"], "EURUSD")
        self.assertEqual(extracted["protective_orders"][0]["order_id"], "sl-1")

    def test_pull_mt5_broker_state_from_external_session_ingests_bridge_payload(self) -> None:
        class FakeResponse:
            def __init__(self, status_code: int, payload: dict, text: str = "") -> None:
                self.status_code = status_code
                self._payload = payload
                self.text = text

            def json(self) -> dict:
                return self._payload

        class FakeAsyncClient:
            requests: list[dict] = []
            posts: list[dict] = []

            def __init__(self, *args, **kwargs) -> None:
                del args, kwargs

            async def __aenter__(self) -> "FakeAsyncClient":
                return self

            async def __aexit__(self, exc_type, exc, tb) -> bool:
                del exc_type, exc, tb
                return False

            async def request(self, method: str, url: str, headers: dict | None = None, params: dict | None = None, json: dict | None = None) -> FakeResponse:
                self.requests.append({"method": method, "url": url, "headers": headers, "params": params, "json": json})
                return FakeResponse(
                    200,
                    {
                        "payload": {
                            "broker_state": {
                                "positions": [{"symbol": "EURUSD", "quantity": 1.2}],
                                "protective_orders": [{"order_id": "sl-1", "symbol": "EURUSD"}],
                            }
                        }
                    },
                )

            async def post(self, url: str, json: dict | None = None) -> FakeResponse:
                self.posts.append({"url": url, "json": json})
                return FakeResponse(200, {"status": "ok"})

        control_plane.MT5_EXTERNAL_BROKER_STATE_LAST_PULL.clear()
        with patch.object(
            control_plane,
            "fetch_one",
            return_value={
                "metadata": {
                    "broker_session": {
                        "snapshot_url": "http://bridge.local/state",
                        "payload_path": "payload",
                        "truth_source": "mt5-external-session",
                    }
                }
            },
        ), patch.object(control_plane, "append_audit"), patch.object(control_plane.httpx, "AsyncClient", FakeAsyncClient):
            result = asyncio.run(control_plane._pull_mt5_broker_state_from_external_session("mt5-1"))

        self.assertEqual(result, {"status": "ok"})
        self.assertEqual(FakeAsyncClient.requests[0]["method"], "GET")
        self.assertEqual(FakeAsyncClient.requests[0]["url"], "http://bridge.local/state")
        self.assertEqual(FakeAsyncClient.posts[0]["json"]["truth_source"], "mt5-external-session")
        self.assertEqual(FakeAsyncClient.posts[0]["json"]["broker_state"]["positions"][0]["symbol"], "EURUSD")

    def test_update_mt5_broker_session_route_proxies_update_and_refreshes_sync(self) -> None:
        class FakeResponse:
            def __init__(self, status_code: int, payload: dict, text: str = "") -> None:
                self.status_code = status_code
                self._payload = payload
                self.text = text

            def json(self) -> dict:
                return self._payload

        class FakeAsyncClient:
            patches: list[dict] = []

            def __init__(self, *args, **kwargs) -> None:
                del args, kwargs

            async def __aenter__(self) -> "FakeAsyncClient":
                return self

            async def __aexit__(self, exc_type, exc, tb) -> bool:
                del exc_type, exc, tb
                return False

            async def patch(self, url: str, json: dict | None = None) -> FakeResponse:
                self.patches.append({"url": url, "json": json})
                return FakeResponse(200, {"status": "updated", "broker_session": json.get("broker_session") if isinstance(json, dict) else {}})

        with patch.object(control_plane, "_assert_account_visible", return_value={"account_id": "mt5-1", "connector_type": "mt5"}), \
             patch.object(control_plane.httpx, "AsyncClient", FakeAsyncClient), \
             patch.object(control_plane, "_sync_accounts_registry_from_mt5"), \
             patch.object(control_plane, "_sync_internal_portfolio_accounts"), \
             patch.object(control_plane, "_sync_mt5_account_state", return_value={"status": "ok", "truth_source": "mt5-broker-state"}), \
             patch.object(control_plane, "append_audit"):
            payload = asyncio.run(
                control_plane.update_mt5_broker_session(
                    "mt5-1",
                    {
                        "broker_session": {
                            "snapshot_url": "http://bridge.local/state",
                            "payload_path": "payload",
                        }
                    },
                    auth=SimpleNamespace(username="operator"),
                )
            )

        self.assertEqual(payload["status"], "ok")
        self.assertEqual(payload["normalized_state"]["truth_source"], "mt5-broker-state")
        self.assertEqual(FakeAsyncClient.patches[0]["url"], f"{control_plane.MT5_BRIDGE_URL}/v1/accounts/mt5-1/broker-session")
        self.assertEqual(FakeAsyncClient.patches[0]["json"]["broker_session"]["snapshot_url"], "http://bridge.local/state")

    def test_update_mt5_broker_session_refresh_preserves_config_in_db(self) -> None:
        class FakeResponse:
            def __init__(self, status_code: int, payload: dict, text: str = "") -> None:
                self.status_code = status_code
                self._payload = payload
                self.text = text

            def json(self) -> dict:
                return self._payload

        store = {
            "mt5_accounts": {
                "mt5-1": {
                    "account_id": "mt5-1",
                    "broker": "metaquotes",
                    "server": "MetaQuotes-Demo",
                    "login": "10001234",
                    "mode": "paper",
                    "status": "connected",
                    "metadata": {},
                }
            }
        }
        external_snapshot = {
            "payload": {
                "broker_state": {
                    "positions": [{"position_id": "mt5:mt5-1:EURUSD", "symbol": "EURUSD", "side": "long", "quantity": 1.2, "avg_entry_price": 1.08, "mark_price": 1.0825, "notional_usd": 129900.0, "pnl_unrealized_usd": 300.0, "as_of": "2026-05-15T12:00:00+00:00"}],
                    "protective_orders": [{"order_id": "sl-1", "symbol": "EURUSD", "position_side": "LONG", "order_type": "SL", "trigger_price": 1.075, "as_of": "2026-05-15T12:00:00+00:00"}],
                    "balances": [{"asset_symbol": "USD", "available_qty": 25000.0, "locked_qty": 0.0, "equity_usd": 25000.0, "as_of": "2026-05-15T12:00:00+00:00"}],
                    "session": {"terminal": "mt5-main-live", "connected": True},
                    "as_of": "2026-05-15T12:00:00+00:00",
                }
            }
        }

        def mt5_fetch_one(query: str, params: tuple | None = None) -> dict | None:
            if "FROM mt5_accounts" in query:
                account_id = str((params or ("",))[0])
                row = store["mt5_accounts"].get(account_id)
                if not row:
                    return None
                return {
                    **row,
                    "metadata": json.loads(json.dumps(row.get("metadata") or {})),
                }
            return None

        def mt5_execute(query: str, params: tuple | None = None) -> None:
            if "UPDATE mt5_accounts" not in query or not params:
                return None
            if "SET status = %s" in query:
                status, metadata_raw, account_id = params
                store["mt5_accounts"][str(account_id)]["status"] = str(status)
                store["mt5_accounts"][str(account_id)]["metadata"] = json.loads(str(metadata_raw))
                return None
            if "SET metadata = %s::jsonb" in query:
                metadata_raw, account_id = params
                store["mt5_accounts"][str(account_id)]["metadata"] = json.loads(str(metadata_raw))
                return None
            return None

        def control_plane_fetch_one(query: str, params: tuple | None = None) -> dict | None:
            if "SELECT metadata FROM mt5_accounts" in query:
                account_id = str((params or ("",))[0])
                row = store["mt5_accounts"].get(account_id)
                return {"metadata": json.loads(json.dumps((row or {}).get("metadata") or {}))}
            if "FROM accounts_registry" in query:
                return {"account_id": "mt5-1", "connector_type": "mt5", "metadata": {}}
            return None

        class StatefulAsyncClient:
            def __init__(self, *args, **kwargs) -> None:
                del args, kwargs

            async def __aenter__(self) -> "StatefulAsyncClient":
                return self

            async def __aexit__(self, exc_type, exc, tb) -> bool:
                del exc_type, exc, tb
                return False

            async def patch(self, url: str, json: dict | None = None) -> FakeResponse:
                if url.endswith("/v1/accounts/mt5-1/broker-session"):
                    payload = await mt5_bridge.update_account_broker_session(
                        "mt5-1",
                        mt5_bridge.Mt5BrokerSessionUpdateRequest(**(json or {})),
                    )
                    return FakeResponse(200, payload)
                return FakeResponse(404, {"detail": "not-found"}, text="not-found")

            async def request(self, method: str, url: str, headers: dict | None = None, params: dict | None = None, json: dict | None = None) -> FakeResponse:
                del method, headers, params, json
                if url == "http://bridge.local/state":
                    return FakeResponse(200, external_snapshot)
                return FakeResponse(404, {"detail": "not-found"}, text="not-found")

            async def post(self, url: str, json: dict | None = None) -> FakeResponse:
                if url.endswith("/v1/accounts/mt5-1/broker-state"):
                    payload = await mt5_bridge.upsert_account_broker_state("mt5-1", json)
                    return FakeResponse(200, payload)
                return FakeResponse(404, {"detail": "not-found"}, text="not-found")

            async def get(self, url: str) -> FakeResponse:
                if url.endswith("/v1/accounts/mt5-1/normalized-state"):
                    payload = await mt5_bridge.account_normalized_state("mt5-1")
                    return FakeResponse(200, payload)
                return FakeResponse(404, {"detail": "not-found"}, text="not-found")

        control_plane.MT5_EXTERNAL_BROKER_STATE_LAST_PULL.clear()
        with patch.object(control_plane, "_assert_account_visible", return_value={"account_id": "mt5-1", "connector_type": "mt5"}), \
             patch.object(control_plane.httpx, "AsyncClient", StatefulAsyncClient), \
             patch.object(control_plane, "fetch_one", side_effect=control_plane_fetch_one), \
             patch.object(control_plane, "_sync_accounts_registry_from_mt5"), \
             patch.object(control_plane, "_sync_internal_portfolio_accounts"), \
             patch.object(control_plane, "_persist_mt5_account_state", side_effect=lambda account_id, payload: payload), \
             patch.object(control_plane, "_refresh_portfolio_risk_snapshots_for_account", return_value=[]), \
             patch.object(control_plane, "_reconcile_live_position_protection", return_value={"status": "ok"}), \
             patch.object(control_plane, "append_audit"), \
             patch.object(mt5_bridge, "fetch_one", side_effect=mt5_fetch_one), \
             patch.object(mt5_bridge, "fetch_all", return_value=[]), \
             patch.object(mt5_bridge, "execute", side_effect=mt5_execute):
            payload = asyncio.run(
                control_plane.update_mt5_broker_session(
                    "mt5-1",
                    {
                        "broker_session": {
                            "snapshot_url": "http://bridge.local/state",
                            "payload_path": "payload",
                            "truth_source": "mt5-external-session",
                        },
                        "merge": False,
                        "refresh": True,
                    },
                    auth=SimpleNamespace(username="operator"),
                )
            )
            persisted_row = mt5_bridge.fetch_one("SELECT * FROM mt5_accounts WHERE account_id = %s", ("mt5-1",))

        metadata = persisted_row["metadata"]
        self.assertEqual(payload["status"], "ok")
        self.assertEqual(payload["normalized_state"]["truth_source"], "mt5-broker-state")
        self.assertEqual(payload["normalized_state"]["summary"]["protective_order_count"], 1)
        self.assertEqual(metadata["broker_session"]["snapshot_url"], "http://bridge.local/state")
        self.assertEqual(metadata["broker_session"]["payload_path"], "payload")
        self.assertEqual(metadata["broker_session"]["truth_source"], "mt5-external-session")
        self.assertEqual(metadata["broker_runtime_session"]["terminal"], "mt5-main-live")


class LivePositionProtectionIntegrationTests(unittest.TestCase):
    def test_persist_live_position_protection_rows_records_audit_on_status_change_and_close(self) -> None:
        partial_row = {
            "position_id": "bingx:acct-1:BTCUSDT:long",
            "account_id": "acct-1",
            "provider": "bingx",
            "symbol": "BTCUSDT",
            "side": "long",
            "snapshot_source": "bingx-futures-position",
            "broker_truth_source": "bingx-open-orders+positions",
            "freshness_status": "live",
            "live_truth": True,
            "snapshot_age_seconds": 12.0,
            "stale_after_seconds": 900,
            "position_as_of": "2026-05-15T12:00:00+00:00",
            "protection_as_of": "2026-05-15T12:00:00+00:00",
            "requested_protection": {"stop_loss": {"trigger_price": 69300.0}, "take_profit": {"trigger_price": 71400.0}},
            "broker_accepted_protection": {"stop_loss": {"trigger_price": 69300.0}, "take_profit": {"trigger_price": 71400.0}},
            "broker_active_protection": {"stop_loss": {"trigger_price": 69300.0}},
            "last_amend_request": {},
            "governor_state": {"recommended_action": "MOVE_STOP_TO_BREAKEVEN", "actionable": True},
            "protection_status": "protection_partial",
            "forced_action": None,
            "payload": {},
        }
        protected_row = {
            **partial_row,
            "broker_active_protection": {
                "stop_loss": {"trigger_price": 70000.0},
                "take_profit": {"trigger_price": 71400.0},
            },
            "governor_state": {"recommended_action": "HOLD", "actionable": False},
            "protection_status": "protected",
        }
        prior_rows = [[], [partial_row], [protected_row]]
        recorded_events: list[dict[str, str]] = []

        def latest_rows(_account_id: str, _provider: str | None = None) -> list[dict]:
            return prior_rows.pop(0) if prior_rows else []

        def record_audit(
            account_id: str,
            provider: str,
            position_id: str | None,
            symbol: str | None,
            event_type: str,
            event_reason: str,
            event_payload: dict[str, object] | None = None,
        ) -> None:
            del account_id, provider, position_id, symbol, event_payload
            recorded_events.append({"event_type": event_type, "event_reason": event_reason})

        with patch.object(control_plane, "_latest_live_position_protection_rows", side_effect=latest_rows), \
             patch.object(control_plane, "_record_live_position_protection_audit", side_effect=record_audit), \
             patch.object(control_plane, "execute") as execute:
            control_plane._persist_live_position_protection_rows("acct-1", "bingx", [partial_row])
            control_plane._persist_live_position_protection_rows("acct-1", "bingx", [protected_row])
            control_plane._persist_live_position_protection_rows("acct-1", "bingx", [])

        event_types = [str(item.get("event_type") or "") for item in recorded_events]
        self.assertIn("observed", event_types)
        self.assertIn("protection_status_changed", event_types)
        self.assertIn("position_closed", event_types)
        executed_sql = "\n".join(str(call.args[0]) for call in execute.call_args_list if call.args)
        self.assertIn("INSERT INTO live_position_protection_status", executed_sql)
        self.assertIn("DELETE FROM live_position_protection_status", executed_sql)

    def test_get_live_position_protection_status_reports_stale_snapshot_and_audit(self) -> None:
        now = datetime.now(timezone.utc)
        stale_as_of = (now - timedelta(hours=1)).isoformat()
        position = {
            "position_id": "bingx:acct-1:BTCUSDT:long",
            "account_id": "acct-1",
            "symbol": "BTCUSDT",
            "instrument": "BTCUSDT",
            "side": "long",
            "quantity": 0.01,
            "notional_usd": 720.0,
            "avg_entry_price": 70000.0,
            "mark_price": 70700.0,
            "pnl_unrealized_usd": 7.0,
            "as_of": stale_as_of,
            "source": "bingx-futures-position",
            "payload": {},
        }
        account = {"account_id": "acct-1", "connector_type": "bingx", "metadata": {}}
        status_row = build_live_position_protection_status(
            position,
            provider="bingx",
            broker_truth_source="bingx-open-orders+positions",
            requested_protection={"stop_loss": {"trigger_price": 69300.0}},
            broker_accepted_protection={"stop_loss": {"trigger_price": 69300.0}},
            active_protection={},
            now=now,
        )
        item = {
            **status_row,
            "last_amend_request": {},
            "governor_state": build_position_protection_governor(status_row),
            "forced_action": None,
            "updated_at": now.isoformat(),
        }

        with patch.object(control_plane, "_latest_live_position_protection_rows", return_value=[item]), \
             patch.object(control_plane, "_latest_live_position_protection_audit", return_value=[{"event_type": "observed"}]), \
             patch.object(control_plane, "_assert_account_visible", return_value=account):
            payload = asyncio.run(
                control_plane.get_live_position_protection_status(
                    "acct-1",
                    refresh=False,
                    audit_limit=10,
                    auth=SimpleNamespace(username="viewer"),
                )
            )

        self.assertEqual(payload["status"], "ok")
        self.assertEqual(payload["summary"]["stale_count"], 1)
        self.assertEqual(payload["items"][0]["protection_status"], "stale_snapshot")
        self.assertEqual(payload["items"][0]["governor_state"]["recommended_action"], "NO_ACTION_STALE")
        self.assertFalse(payload["items"][0]["governor_state"]["actionable"])
        self.assertEqual(payload["audit"][0]["event_type"], "observed")

    def test_run_position_governor_executes_actionable_position_and_returns_audit(self) -> None:
        now = datetime.now(timezone.utc)
        fresh_as_of = now.isoformat()
        position = {
            "position_id": "bingx:acct-1:BTCUSDT:long",
            "account_id": "acct-1",
            "symbol": "BTCUSDT",
            "instrument": "BTCUSDT",
            "side": "long",
            "quantity": 0.01,
            "notional_usd": 720.0,
            "avg_entry_price": 70000.0,
            "mark_price": 70700.0,
            "pnl_unrealized_usd": 7.0,
            "as_of": fresh_as_of,
            "source": "bingx-futures-position",
            "payload": {},
        }
        account = {"account_id": "acct-1", "connector_type": "bingx", "metadata": {}}
        status_row = build_live_position_protection_status(
            position,
            provider="bingx",
            broker_truth_source="bingx-open-orders+positions",
            requested_protection={"stop_loss": {"trigger_price": 69300.0}},
            broker_accepted_protection={"stop_loss": {"trigger_price": 69300.0}},
            active_protection={},
            now=now,
        )
        governor_state = build_position_protection_governor(status_row)
        governor_state["execution_result"] = {"status": "executed", "action": "ARM_STOP_LOSS"}
        item = {
            **status_row,
            "last_amend_request": {},
            "governor_state": governor_state,
            "forced_action": "executed",
            "updated_at": now.isoformat(),
        }

        with patch.object(control_plane, "_reconcile_live_position_protection", return_value={"account_id": "acct-1", "provider": "bingx", "items": [item]}), \
             patch.object(control_plane, "_latest_live_position_protection_rows", return_value=[item]), \
             patch.object(control_plane, "_latest_live_position_protection_audit", return_value=[{"event_type": "observed"}]), \
             patch.object(control_plane, "_assert_account_visible", return_value=account), \
             patch.object(control_plane, "append_audit") as append_audit:
            payload = asyncio.run(
                control_plane.run_position_governor(
                    "acct-1",
                    {"refresh": False, "execute_actions": True},
                    auth=SimpleNamespace(username="operator"),
                )
            )

        self.assertEqual(payload["status"], "ok")
        self.assertTrue(payload["execute_actions"])
        self.assertEqual(payload["summary"]["actionable_governor_count"], 1)
        self.assertEqual(payload["items"][0]["forced_action"], "executed")
        self.assertEqual(payload["items"][0]["governor_state"]["execution_result"]["status"], "executed")
        self.assertEqual(payload["audit"][0]["event_type"], "observed")
        append_audit.assert_called_once()
        self.assertEqual(append_audit.call_args.args[0], "live_position_governor_run")


if __name__ == "__main__":
    unittest.main()