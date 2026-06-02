from __future__ import annotations

import unittest
from datetime import datetime, timedelta, timezone

from apps.market_recorder import main as market_recorder


class MarketRecorderTests(unittest.TestCase):
    def setUp(self) -> None:
        self.original_symbols = list(market_recorder.SYMBOLS)
        self.original_venues = list(market_recorder.VENUES)
        self.original_quote_max_age_seconds = market_recorder.QUOTE_MAX_AGE_SECONDS
        market_recorder.SYMBOLS = ["BTCUSDT"]
        market_recorder.VENUES = ["binance-public", "bybit-public"]
        market_recorder.QUOTE_MAX_AGE_SECONDS = 120.0

    def tearDown(self) -> None:
        market_recorder.SYMBOLS = self.original_symbols
        market_recorder.VENUES = self.original_venues
        market_recorder.QUOTE_MAX_AGE_SECONDS = self.original_quote_max_age_seconds

    def _quote(self, venue: str, instrument: str, age_seconds: float = 5.0) -> dict[str, object]:
        updated_at = datetime.now(timezone.utc) - timedelta(seconds=age_seconds)
        return {
            "venue": venue,
            "instrument": instrument,
            "bid": 100.0,
            "ask": 100.1,
            "last": 100.05,
            "updated_at": updated_at.isoformat().replace("+00:00", "Z"),
        }

    def test_quote_filter_keeps_only_configured_fresh_live_quotes(self) -> None:
        self.assertTrue(market_recorder._quote_is_recordable(self._quote("binance-public", "BTCUSDT")))
        self.assertTrue(market_recorder._quote_is_recordable(self._quote("bybit-public", "BTC-USDT")))
        self.assertFalse(market_recorder._quote_is_recordable(self._quote("paper-bitget", "BTCUSDT-PERP")))
        self.assertFalse(market_recorder._quote_is_recordable(self._quote("coinbase-public", "BTCUSDT")))
        self.assertFalse(market_recorder._quote_is_recordable(self._quote("binance-public", "ETHUSDT")))
        self.assertFalse(market_recorder._quote_is_recordable(self._quote("binance-public", "BTCUSDT", age_seconds=300.0)))


if __name__ == "__main__":
    unittest.main()