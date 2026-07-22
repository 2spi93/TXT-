from __future__ import annotations

import asyncio
import unittest
from unittest.mock import patch

from apps.broker_adapter import main as broker_adapter


class BrokerAdapterSizingTests(unittest.TestCase):
    def test_resolve_notional_adjustment_applies_exchange_minimum_when_enabled(self) -> None:
        adjustment = broker_adapter._resolve_notional_adjustment(2.5, 7.5, auto_adjust_enabled=True)

        self.assertTrue(adjustment["enabled"])
        self.assertTrue(adjustment["applied"])
        self.assertFalse(adjustment["supports_requested_notional"])
        self.assertTrue(adjustment["supports_auto_adjusted_notional"])
        self.assertEqual(adjustment["adjusted_notional_usd"], 7.5)

    def test_resolve_notional_adjustment_rejects_below_minimum_when_disabled(self) -> None:
        adjustment = broker_adapter._resolve_notional_adjustment(2.5, 7.5, auto_adjust_enabled=False)

        self.assertFalse(adjustment["enabled"])
        self.assertFalse(adjustment["applied"])
        self.assertFalse(adjustment["supports_requested_notional"])
        self.assertFalse(adjustment["supports_auto_adjusted_notional"])
        self.assertEqual(adjustment["adjusted_notional_usd"], 2.5)

    def test_live_execution_constraints_return_ready_preflight_when_auto_adjust_enabled(self) -> None:
        async def run_test() -> None:
            with patch.object(
                broker_adapter,
                "_bingx_contract_spec",
                return_value={
                    "size_step": 0.0001,
                    "trade_min_quantity": 0.0001,
                    "trade_min_usdt": 7.5,
                    "quantity_precision": 4,
                    "price_precision": 1,
                },
            ), patch.object(
                broker_adapter,
                "_bingx_public_get",
                return_value={"bidPrice": "75000", "askPrice": "75010", "lastPrice": "75005"},
            ):
                response = await broker_adapter.live_execution_constraints(
                    {
                        "provider": "bingx",
                        "symbol": "BTCUSDT",
                        "side": "buy",
                        "requested_notional_usd": 2.5,
                        "auto_adjust_notional": True,
                    }
                )

            self.assertEqual(response["status"], "ready_preflight")
            self.assertFalse(response["supports_requested_notional"])
            self.assertTrue(response["supports_auto_adjusted_notional"])
            self.assertEqual(response["effective_notional_usd"], response["min_notional_usd"])
            self.assertTrue(response["auto_adjustment"]["applied"])

        asyncio.run(run_test())

    def test_bingx_amend_live_order_cancel_replaces_protection_orders(self) -> None:
        async def run_test() -> None:
            async def fake_signed_request(secret_payload: dict, method: str, path: str, params: dict | None = None) -> object:
                self.assertEqual(method, "POST")
                self.assertEqual(path, "/openApi/swap/v2/trade/order")
                self.assertIsInstance(params, dict)
                return {
                    "orderId": f"new-{params.get('clientOrderId')}",
                    "clientOrderId": params.get("clientOrderId"),
                    "symbol": params.get("symbol"),
                    "side": params.get("side"),
                    "type": params.get("type"),
                    "stopPrice": params.get("stopPrice"),
                    "price": params.get("price"),
                    "status": "NEW",
                }

            async def fake_cancel(payload: dict) -> dict:
                return {
                    "status": "cancelled",
                    "order_id": payload.get("order_id") or payload.get("client_order_id"),
                }

            async def fake_query_order(secret_payload: dict, symbol: str, order_id: str | None, client_order_id: str | None, requested_notional_usd: float, side: str, requested_protection: dict[str, object] | None = None) -> dict | None:
                return {
                    "order_id": order_id or f"query-{client_order_id}",
                    "client_order_id": client_order_id,
                    "status": "open",
                    "instrument": broker_adapter._canonical_instrument(symbol),
                    "side": side,
                    "raw_order": {
                        "createTime": "2026-05-15T12:00:00+00:00",
                    },
                }

            with patch.object(
                broker_adapter,
                "_bingx_contract_spec",
                return_value={
                    "size_step": 0.0001,
                    "trade_min_quantity": 0.0001,
                    "trade_min_usdt": 5.0,
                    "quantity_precision": 4,
                    "price_precision": 1,
                },
            ), patch.object(broker_adapter, "_bingx_cancel_live_order", side_effect=fake_cancel), patch.object(
                broker_adapter,
                "_bingx_signed_request",
                side_effect=fake_signed_request,
            ), patch.object(broker_adapter, "_bingx_query_order", side_effect=fake_query_order):
                response = await broker_adapter._bingx_amend_live_order(
                    {
                        "secret_payload": {"api_key": "key", "api_secret": "secret"},
                        "symbol": "BTCUSDT",
                        "position_side": "LONG",
                        "quantity": 0.01,
                        "active_protection": {
                            "stop_loss": {"order_id": "old-sl"},
                            "take_profit": {"order_id": "old-tp"},
                        },
                        "protection": {
                            "stop_loss": {"trigger_price": 69000.0, "order_type": "market", "working_type": "MARK_PRICE"},
                            "take_profit": {"trigger_price": 71500.0, "order_type": "limit", "limit_price": 71510.0, "working_type": "MARK_PRICE"},
                        },
                    }
                )

            self.assertEqual(response["status"], "replaced")
            self.assertTrue(response["modify_supported"])
            self.assertEqual(response["protection_status"], "armed")
            self.assertEqual(len(response["cancelled_orders"]), 2)
            self.assertEqual(len(response["created_orders"]), 2)
            self.assertEqual(response["protection"]["mode"], "cancel_replace")
            self.assertTrue(str(response["protection"]["accepted"]["stop_loss"]["order_id"]).startswith("new-txt-st-"))
            self.assertEqual(response["protection"]["accepted"]["take_profit"]["order_type"], "limit")

        asyncio.run(run_test())

    def test_bingx_amend_live_order_rolls_back_cancelled_legs_when_replace_fails(self) -> None:
        async def run_test() -> None:
            created_client_order_ids: list[str] = []

            async def fake_signed_request(secret_payload: dict, method: str, path: str, params: dict | None = None) -> object:
                self.assertEqual(method, "POST")
                self.assertEqual(path, "/openApi/swap/v2/trade/order")
                self.assertIsInstance(params, dict)
                client_order_id = str(params.get("clientOrderId") or "")
                created_client_order_ids.append(client_order_id)
                if client_order_id.startswith("txt-st-"):
                    raise RuntimeError("replace leg creation failed")
                return {
                    "orderId": f"restored-{client_order_id}",
                    "clientOrderId": client_order_id,
                    "symbol": params.get("symbol"),
                    "side": params.get("side"),
                    "type": params.get("type"),
                    "stopPrice": params.get("stopPrice"),
                    "price": params.get("price"),
                    "status": "NEW",
                }

            async def fake_cancel(payload: dict) -> dict:
                return {
                    "status": "cancelled",
                    "order_id": payload.get("order_id") or payload.get("client_order_id"),
                }

            async def fake_query_order(secret_payload: dict, symbol: str, order_id: str | None, client_order_id: str | None, requested_notional_usd: float, side: str, requested_protection: dict[str, object] | None = None) -> dict | None:
                return {
                    "order_id": order_id or f"query-{client_order_id}",
                    "client_order_id": client_order_id,
                    "status": "open",
                    "instrument": broker_adapter._canonical_instrument(symbol),
                    "side": side,
                    "raw_order": {
                        "createTime": "2026-05-15T12:00:00+00:00",
                    },
                }

            with patch.object(
                broker_adapter,
                "_bingx_contract_spec",
                return_value={
                    "size_step": 0.0001,
                    "trade_min_quantity": 0.0001,
                    "trade_min_usdt": 5.0,
                    "quantity_precision": 4,
                    "price_precision": 1,
                },
            ), patch.object(broker_adapter, "_bingx_cancel_live_order", side_effect=fake_cancel), patch.object(
                broker_adapter,
                "_bingx_signed_request",
                side_effect=fake_signed_request,
            ), patch.object(broker_adapter, "_bingx_query_order", side_effect=fake_query_order):
                with self.assertRaises(RuntimeError) as raised:
                    await broker_adapter._bingx_amend_live_order(
                        {
                            "secret_payload": {"api_key": "key", "api_secret": "secret"},
                            "symbol": "BTCUSDT",
                            "position_side": "LONG",
                            "quantity": 0.01,
                            "active_protection": {
                                "stop_loss": {"order_id": "old-sl", "trigger_price": 69000.0, "order_type": "market", "working_type": "MARK_PRICE"},
                                "take_profit": {"order_id": "old-tp", "trigger_price": 71500.0, "order_type": "limit", "limit_price": 71510.0, "working_type": "MARK_PRICE"},
                            },
                            "protection": {
                                "stop_loss": {"trigger_price": 69500.0, "order_type": "market", "working_type": "MARK_PRICE"},
                                "take_profit": {"trigger_price": 72000.0, "order_type": "limit", "limit_price": 72010.0, "working_type": "MARK_PRICE"},
                            },
                        }
                    )

            rollback_state = getattr(raised.exception, "rollback_state", {})
            self.assertEqual(rollback_state.get("status"), "rollback_attempted")
            self.assertEqual(len(rollback_state.get("cancelled_orders") or []), 2)
            self.assertEqual(len(rollback_state.get("created_orders") or []), 0)
            self.assertTrue(rollback_state.get("rollback", {}).get("restored"))
            self.assertEqual(len(rollback_state.get("rollback", {}).get("recreated_original_orders") or []), 2)
            self.assertTrue(any(item.startswith("txt-rb-st-") for item in created_client_order_ids))
            self.assertTrue(any(item.startswith("txt-rb-ta-") for item in created_client_order_ids))

        asyncio.run(run_test())


if __name__ == "__main__":
    unittest.main()