from __future__ import annotations

import asyncio
import os
import socket
from datetime import datetime, timedelta, timezone
from dataclasses import dataclass
from typing import Any
from time import perf_counter
from urllib.parse import urlparse

import httpx
from fastapi import FastAPI
from pydantic import BaseModel, Field

from shared.db import ensure_schema, execute as db_execute, execute_rowcount, fetch_all, json_dumps

app = FastAPI(title="AI Orchestrator", version="0.1.0")


class OrchestrateRequest(BaseModel):
    task: str
    prompt: str
    criticality: str = Field(default="medium")
    cost_limit_usd: float = Field(default=0.05, ge=0)
    prefer_local: bool = False


class RouteDecision(BaseModel):
    primary_model: str
    fallback_model: str
    primary_provider: str
    fallback_provider: str
    reason: str
    estimated_cost_usd: float


class OrchestrateResponse(BaseModel):
    route: RouteDecision
    model_used: str
    provider_used: str
    output: str
    latency_ms: int
    retries_used: int = 0
    fallback_used: bool = False


class WarmupRequest(BaseModel):
    model_key: str | None = None


class RegimeDetectRequest(BaseModel):
    trend_score: float = Field(ge=-1.0, le=1.0)
    realized_volatility: float = Field(ge=0.0)
    sentiment_score: float = Field(ge=-1.0, le=1.0)


class GeopoliticalBacktestRequest(BaseModel):
    strategy_name: str
    asset_class: str
    scenario: str
    horizon_days: int = Field(default=20, ge=1, le=365)


class DecisionScoreRequest(BaseModel):
    confidence: float = Field(ge=0.0, le=1.0)
    consistency: float = Field(ge=0.0, le=1.0)
    risk_alignment: float = Field(ge=0.0, le=1.0)
    historical_match: float = Field(ge=0.0, le=1.0)
    threshold: float = Field(default=0.7, ge=0.0, le=1.0)


class MultiAgentVoteRequest(BaseModel):
    votes: dict[str, str]
    disagreement_threshold: float = Field(default=0.34, ge=0.0, le=1.0)


@dataclass
class ModelConfig:
    name: str
    provider: str
    kind: str
    estimated_cost_usd: float
    model: str
    available: bool


@dataclass
class CircuitState:
    failures: int = 0
    opened_until: datetime | None = None


_CIRCUITS: dict[str, CircuitState] = {}


def _secret(name: str) -> str:
    direct = os.getenv(name, "").strip()
    if direct:
        return direct
    file_path = os.getenv(f"{name}_FILE", "").strip()
    if not file_path:
        return ""
    try:
        with open(file_path, "r", encoding="utf-8") as handle:
            return handle.read().strip()
    except Exception:
        return ""


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _timeout_s() -> float:
    return float(os.getenv("AI_TIMEOUT_SECONDS", "8"))


def _local_timeout_s() -> float:
    return float(os.getenv("AI_LOCAL_TIMEOUT_SECONDS", "90"))


def _max_retries() -> int:
    return int(os.getenv("AI_MAX_RETRIES", "0"))


def _cb_threshold() -> int:
    return int(os.getenv("AI_CB_FAILURE_THRESHOLD", "3"))


def _cb_reset_seconds() -> int:
    return int(os.getenv("AI_CB_RESET_SECONDS", "30"))


def _history_retention_days() -> int:
    return int(os.getenv("AI_HISTORY_RETENTION_DAYS", "30"))


def _detect_capacity() -> dict[str, Any]:
    cpus = os.cpu_count() or 1
    mem_gb = 0.0
    try:
        with open("/proc/meminfo", "r", encoding="utf-8") as handle:
            for line in handle:
                if line.startswith("MemTotal:"):
                    kb = int(line.split()[1])
                    mem_gb = kb / 1024 / 1024
                    break
    except Exception:
        mem_gb = 0.0
    has_gpu = bool(os.getenv("NVIDIA_VISIBLE_DEVICES", ""))
    return {
        "cpus": cpus,
        "memory_gb": round(mem_gb, 2),
        "has_gpu": has_gpu,
    }


def _recommended_open_source_models() -> dict[str, str]:
    cap = _detect_capacity()
    mem_gb = float(cap["memory_gb"])

    if mem_gb < 8:
        fast_model = "qwen2.5:3b-instruct"
        reasoning_model = "deepseek-r1:1.5b"
    elif mem_gb < 16:
        fast_model = "qwen2.5:7b-instruct"
        reasoning_model = "deepseek-r1:7b"
    else:
        fast_model = "qwen2.5:14b-instruct"
        reasoning_model = "deepseek-r1:14b"

    return {
        "fast": os.getenv("LOCAL_MODEL_FAST", fast_model),
        "reasoning": os.getenv("LOCAL_MODEL_REASONING", reasoning_model),
    }


def _ollama_endpoint_reachable() -> bool:
    endpoint = os.getenv("MISTRAL_LOCAL_URL", "").strip()
    if not endpoint:
        return False
    parsed = urlparse(endpoint)
    host = parsed.hostname
    port = parsed.port or (443 if parsed.scheme == "https" else 80)
    if not host:
        return False
    try:
        socket.getaddrinfo(host, port)
    except OSError:
        return False
    try:
        with socket.create_connection((host, port), timeout=0.6):
            pass
    except OSError:
        return False
    return True


def _config() -> dict[str, ModelConfig]:
    openai_available = bool(_secret("OPENAI_API_KEY"))
    claude_available = bool(_secret("ANTHROPIC_API_KEY"))
    deepseek_available = bool(_secret("DEEPSEEK_API_KEY"))
    mistral_available = bool(_secret("MISTRAL_API_KEY"))
    local_available = _ollama_endpoint_reachable()
    local_models = _recommended_open_source_models()

    return {
        "gpt-5": ModelConfig("gpt-5", "openai", "remote", 0.06, os.getenv("OPENAI_MODEL", "gpt-4.1-mini"), openai_available),
        "claude-4.6": ModelConfig("claude-4.6", "anthropic", "remote", 0.05, os.getenv("ANTHROPIC_MODEL", "claude-3-5-sonnet-latest"), claude_available),
        "deepseek-r1": ModelConfig("deepseek-r1", "deepseek", "remote", 0.01, os.getenv("DEEPSEEK_MODEL", "deepseek-reasoner"), deepseek_available),
        "mistral-large": ModelConfig("mistral-large", "mistral", "remote", 0.008, os.getenv("MISTRAL_MODEL", "mistral-large-latest"), mistral_available),
        "open-source-fast": ModelConfig("open-source-fast", "ollama", "local", 0.001, local_models["fast"], local_available),
        "open-source-reasoning": ModelConfig("open-source-reasoning", "ollama", "local", 0.0015, local_models["reasoning"], local_available),
    }


def _purge_old_history() -> None:
    db_execute(
        """
        DELETE FROM ai_orchestration_events
        WHERE created_at < NOW() - (%s || ' days')::interval
        """,
        (str(_history_retention_days()),),
    )


def _clear_old_history() -> int:
    return execute_rowcount(
        """
        DELETE FROM ai_orchestration_events
        WHERE created_at < NOW() - (%s || ' days')::interval
        """,
        (str(_history_retention_days()),),
    )


def _local_model_rows() -> list[dict[str, Any]]:
    cfg = _config()
    rows = fetch_all(
        """
        SELECT model_used, COUNT(*) AS calls, AVG(latency_ms)::INT AS avg_latency_ms,
               MAX(created_at) AS last_used_at,
               MAX(CASE WHEN status = 'ok' THEN 1 ELSE 0 END) AS has_success
        FROM ai_orchestration_events
        WHERE provider_used = 'ollama'
        GROUP BY model_used
        """
    )
    metrics = {row["model_used"]: row for row in rows}
    result: list[dict[str, Any]] = []
    for route_name in ["open-source-fast", "open-source-reasoning"]:
        route = cfg[route_name]
        metric = metrics.get(route_name, {})
        result.append(
            {
                "route": route_name,
                "model": route.model,
                "available": route.available,
                "avg_latency_ms": metric.get("avg_latency_ms"),
                "calls": metric.get("calls", 0),
                "last_used_at": metric.get("last_used_at"),
                "has_success": bool(metric.get("has_success", 0)),
            }
        )
    return result


def _route(task: str, criticality: str, cost_limit_usd: float, prefer_local: bool) -> RouteDecision:
    cfg = _config()

    if prefer_local:
        primary = "open-source-reasoning" if cfg["open-source-reasoning"].available else "open-source-fast"
        fallback = "open-source-fast"
        return RouteDecision(
            primary_model=primary,
            fallback_model=fallback,
            primary_provider=cfg.get(primary, cfg["open-source-fast"]).provider,
            fallback_provider=cfg.get(fallback, cfg["open-source-fast"]).provider,
            reason="prefer_local_enabled",
            estimated_cost_usd=cfg.get(primary, cfg["open-source-fast"]).estimated_cost_usd,
        )

    if task == "strategy_creation":
        primary = "gpt-5" if cfg["gpt-5"].available else "open-source-reasoning"
        fallback = "open-source-fast" if primary == "gpt-5" else "open-source-fast"
    elif task == "feature_extraction":
        primary = "open-source-fast" if cfg["open-source-fast"].available else "deepseek-r1"
        fallback = "deepseek-r1" if cfg["deepseek-r1"].available else "open-source-reasoning"
    elif task == "backtest_analysis":
        primary = "deepseek-r1" if cfg["deepseek-r1"].available else "open-source-reasoning"
        fallback = "open-source-reasoning" if primary == "deepseek-r1" else "gpt-5"
    else:
        primary = "gpt-5" if criticality == "high" and cfg["gpt-5"].available else "open-source-fast"
        fallback = "open-source-reasoning"

    if cfg.get(primary) and cfg[primary].estimated_cost_usd > cost_limit_usd:
        primary = "open-source-fast" if cfg["open-source-fast"].available else "open-source-reasoning"
        fallback = "open-source-reasoning"
        reason = "cost_limit_enforced"
    else:
        reason = "task_based_routing"

    primary_cfg = cfg.get(primary, cfg["open-source-fast"])
    fallback_cfg = cfg.get(fallback, cfg["open-source-reasoning"])
    return RouteDecision(
        primary_model=primary,
        fallback_model=fallback,
        primary_provider=primary_cfg.provider,
        fallback_provider=fallback_cfg.provider,
        reason=reason,
        estimated_cost_usd=primary_cfg.estimated_cost_usd,
    )


def _circuit_for(provider: str) -> CircuitState:
    if provider not in _CIRCUITS:
        _CIRCUITS[provider] = CircuitState()
    return _CIRCUITS[provider]


def _is_circuit_open(provider: str) -> bool:
    state = _circuit_for(provider)
    return bool(state.opened_until and state.opened_until > _now_utc())


def _record_failure(provider: str) -> None:
    state = _circuit_for(provider)
    state.failures += 1
    if state.failures >= _cb_threshold():
        state.opened_until = _now_utc() + timedelta(seconds=_cb_reset_seconds())


def _record_success(provider: str) -> None:
    state = _circuit_for(provider)
    state.failures = 0
    state.opened_until = None


async def _call_openai(model: str, prompt: str) -> str:
    api_key = _secret("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("openai_key_missing")
    payload = {
        "model": model,
        "max_tokens": 450,
        "messages": [{"role": "user", "content": prompt}],
    }
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    async with httpx.AsyncClient(timeout=_timeout_s()) as client:
        response = await client.post("https://api.openai.com/v1/chat/completions", headers=headers, json=payload)
        response.raise_for_status()
        data = response.json()
        return data["choices"][0]["message"]["content"]


async def _call_anthropic(model: str, prompt: str) -> str:
    api_key = _secret("ANTHROPIC_API_KEY")
    if not api_key:
        raise RuntimeError("anthropic_key_missing")
    payload = {
        "model": model,
        "max_tokens": 700,
        "messages": [{"role": "user", "content": prompt}],
    }
    headers = {
        "x-api-key": api_key,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
    }
    async with httpx.AsyncClient(timeout=_timeout_s()) as client:
        response = await client.post("https://api.anthropic.com/v1/messages", headers=headers, json=payload)
        response.raise_for_status()
        data = response.json()
        chunks = [c.get("text", "") for c in data.get("content", []) if c.get("type") == "text"]
        return "".join(chunks).strip()


async def _call_deepseek(model: str, prompt: str) -> str:
    api_key = _secret("DEEPSEEK_API_KEY")
    if not api_key:
        raise RuntimeError("deepseek_key_missing")
    payload = {
        "model": model,
        "messages": [{"role": "user", "content": prompt}],
    }
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    async with httpx.AsyncClient(timeout=_timeout_s()) as client:
        response = await client.post("https://api.deepseek.com/v1/chat/completions", headers=headers, json=payload)
        response.raise_for_status()
        data = response.json()
        return data["choices"][0]["message"]["content"]


async def _call_mistral(model: str, prompt: str) -> str:
    api_key = _secret("MISTRAL_API_KEY")
    if not api_key:
        raise RuntimeError("mistral_key_missing")
    payload = {
        "model": model,
        "messages": [{"role": "user", "content": prompt}],
    }
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    async with httpx.AsyncClient(timeout=_timeout_s()) as client:
        response = await client.post("https://api.mistral.ai/v1/chat/completions", headers=headers, json=payload)
        response.raise_for_status()
        data = response.json()
        return data["choices"][0]["message"]["content"]


async def _call_ollama(model: str, prompt: str) -> str:
    base_url = os.getenv("MISTRAL_LOCAL_URL", "http://host.docker.internal:11434").rstrip("/")
    payload = {"model": model, "prompt": prompt, "stream": False}
    async with httpx.AsyncClient(timeout=_local_timeout_s()) as client:
        response = await client.post(f"{base_url}/api/generate", json=payload)
        response.raise_for_status()
        data = response.json()
        text = str(data.get("response", "")).strip()
        if not text:
            raise RuntimeError("ollama_empty_response")
        return text


async def _invoke_provider(provider: str, model: str, prompt: str) -> str:
    if provider == "openai":
        return await _call_openai(model, prompt)
    if provider == "anthropic":
        return await _call_anthropic(model, prompt)
    if provider == "deepseek":
        return await _call_deepseek(model, prompt)
    if provider == "mistral":
        return await _call_mistral(model, prompt)
    if provider == "ollama":
        return await _call_ollama(model, prompt)
    raise RuntimeError("unknown_provider")


async def _run_with_resilience(provider: str, model: str, prompt: str) -> tuple[str, int]:
    if _is_circuit_open(provider):
        raise RuntimeError("circuit_open")

    retries = _max_retries()
    last_error: Exception | None = None
    for attempt in range(retries + 1):
        try:
            text = await _invoke_provider(provider, model, prompt)
            _record_success(provider)
            return text, attempt
        except Exception as exc:
            last_error = exc
            _record_failure(provider)
            if attempt >= retries:
                break
            await asyncio.sleep(0.35 * (2**attempt))

    raise RuntimeError(f"provider_failed:{provider}:{type(last_error).__name__}")


@app.on_event("startup")
async def startup() -> None:
    ensure_schema()
    _purge_old_history()


@app.get("/health")
async def health() -> dict:
    cfg = _config()
    return {
        "status": "ok",
        "service": "ai-orchestrator",
        "models": {
            name: {
                "available": item.available,
                "provider": item.provider,
                "kind": item.kind,
                "model": item.model,
            }
            for name, item in cfg.items()
        },
        "capacity": _detect_capacity(),
        "circuit_breakers": {
            name: {
                "failures": _circuit_for(name).failures,
                "open": _is_circuit_open(name),
                "opened_until": _circuit_for(name).opened_until.isoformat() if _circuit_for(name).opened_until else None,
            }
            for name in ["openai", "anthropic", "deepseek", "mistral", "ollama"]
        },
    }


@app.get("/v1/capacity")
async def capacity() -> dict:
    return {
        "capacity": _detect_capacity(),
        "recommended_open_source": _recommended_open_source_models(),
    }


@app.get("/v1/providers")
async def providers() -> dict:
    cfg = _config()
    return {
        "providers": [
            {
                "route": route_name,
                "provider": route.provider,
                "model": route.model,
                "kind": route.kind,
                "available": route.available,
                "estimated_cost_usd": route.estimated_cost_usd,
            }
            for route_name, route in cfg.items()
        ],
        "timeout_seconds": _timeout_s(),
        "max_retries": _max_retries(),
        "circuit_breaker": {
            "failure_threshold": _cb_threshold(),
            "reset_seconds": _cb_reset_seconds(),
        },
    }


@app.get("/v1/local-models/health")
async def local_models_health() -> dict:
    return {
        "endpoint": os.getenv("MISTRAL_LOCAL_URL", "http://host.docker.internal:11434"),
        "reachable": _ollama_endpoint_reachable(),
        "models": _local_model_rows(),
    }


@app.post("/v1/local-models/warmup")
async def warmup_local_models(request: WarmupRequest) -> dict:
    cfg = _config()
    targets = [request.model_key] if request.model_key else ["open-source-fast", "open-source-reasoning"]
    results: list[dict[str, Any]] = []

    for target in targets:
        if target not in {"open-source-fast", "open-source-reasoning"}:
            results.append({"route": target, "status": "invalid_model_key"})
            continue

        route = cfg[target]
        if not route.available:
            results.append({"route": target, "model": route.model, "status": "unavailable"})
            continue

        start = perf_counter()
        status = "ok"
        error_summary = None
        try:
            await _run_with_resilience(route.provider, route.model, "Warmup. Reply with OK only.")
        except Exception as exc:
            status = "error"
            error_summary = str(exc)
        latency_ms = int((perf_counter() - start) * 1000)

        db_execute(
            """
            INSERT INTO ai_orchestration_events (
                task, prompt_preview, criticality, route, provider_used, model_used,
                estimated_cost_usd, retries_used, fallback_used, latency_ms, status, error_summary
            ) VALUES (
                %s, %s, %s, %s::jsonb, %s, %s,
                %s, %s, %s, %s, %s, %s
            )
            """,
            (
                "warmup_local_model",
                f"Warmup {target}",
                "low",
                json_dumps({"primary_model": target, "fallback_model": target, "primary_provider": route.provider, "fallback_provider": route.provider, "reason": "warmup", "estimated_cost_usd": route.estimated_cost_usd}),
                route.provider if status == "ok" else "none",
                target if status == "ok" else "degraded-template",
                route.estimated_cost_usd,
                0,
                False,
                latency_ms,
                status,
                error_summary,
            ),
        )

        results.append(
            {
                "route": target,
                "model": route.model,
                "status": status,
                "latency_ms": latency_ms,
                "error_summary": error_summary,
            }
        )

    _purge_old_history()
    return {"results": results, "models": _local_model_rows()}


@app.post("/v1/history/clear-old")
async def clear_old_history() -> dict:
    deleted = _clear_old_history()
    return {"status": "ok", "deleted": deleted, "retention_days": _history_retention_days()}


@app.get("/v1/history")
async def history(limit: int = 30) -> list[dict[str, Any]]:
    safe_limit = max(1, min(limit, 200))
    return fetch_all(
        """
        SELECT id, task, prompt_preview, criticality, route, provider_used, model_used,
               estimated_cost_usd, retries_used, fallback_used, latency_ms,
               status, error_summary, created_at
        FROM ai_orchestration_events
        ORDER BY created_at DESC
        LIMIT %s
        """,
        (safe_limit,),
    )


@app.post("/v1/regimes/detect")
async def detect_market_regime(request: RegimeDetectRequest) -> dict[str, Any]:
    if request.realized_volatility > 0.06 and request.trend_score > 0.2:
        regime = "high_vol_trend"
    elif request.realized_volatility > 0.06:
        regime = "high_vol_range"
    elif request.trend_score > 0.35:
        regime = "trend"
    elif request.trend_score < -0.35:
        regime = "downtrend"
    else:
        regime = "range"

    recommendations = {
        "high_vol_trend": ["reduce_leverage", "favor_breakout", "wider_stops"],
        "high_vol_range": ["decrease_size", "mean_reversion_only", "tight_risk_limits"],
        "trend": ["enable_trend_robots", "disable_countertrend_scalping"],
        "downtrend": ["bias_short_setups", "hedge_beta_exposure"],
        "range": ["enable_scalping", "disable_breakout_strategies"],
    }
    return {
        "status": "ok",
        "regime": regime,
        "confidence": round(min(0.99, 0.55 + request.realized_volatility + abs(request.trend_score) * 0.2), 3),
        "recommendations": recommendations.get(regime, []),
    }


@app.post("/v1/backtests/geopolitical")
async def geopolitical_backtest(request: GeopoliticalBacktestRequest) -> dict[str, Any]:
    scenario = request.scenario.lower()
    scenario_penalty = 0.0
    if "fed" in scenario:
        scenario_penalty += 0.15
    if "war" in scenario or "conflict" in scenario:
        scenario_penalty += 0.22
    if "sanction" in scenario:
        scenario_penalty += 0.12

    base_score = 0.78
    resilience_score = max(0.05, round(base_score - scenario_penalty, 3))
    expected_drawdown = round(0.06 + scenario_penalty * 0.5, 3)

    return {
        "status": "ok",
        "strategy_name": request.strategy_name,
        "asset_class": request.asset_class,
        "scenario": request.scenario,
        "horizon_days": request.horizon_days,
        "resilience_score": resilience_score,
        "expected_max_drawdown": expected_drawdown,
        "actions": [
            "reduce_position_size_if_score_below_0_6",
            "enable_event_risk_kill_switch",
            "switch_to_capital_preservation_regime",
        ],
    }


@app.post("/v1/decision/score")
async def score_decision(request: DecisionScoreRequest) -> dict[str, Any]:
    score_global = (
        request.confidence * 0.3
        + request.consistency * 0.25
        + request.risk_alignment * 0.3
        + request.historical_match * 0.15
    )
    score_global = round(score_global, 4)
    return {
        "status": "ok",
        "score": {
            "confidence": request.confidence,
            "consistency": request.consistency,
            "risk_alignment": request.risk_alignment,
            "historical_match": request.historical_match,
            "score_global": score_global,
        },
        "threshold": request.threshold,
        "action": "execute" if score_global >= request.threshold else "human_required",
    }


@app.post("/v1/decision/vote")
async def vote_decision(request: MultiAgentVoteRequest) -> dict[str, Any]:
    if not request.votes:
        return {"status": "ok", "decision": "human_required", "reason": "no_votes"}

    counts: dict[str, int] = {}
    for decision in request.votes.values():
        key = str(decision).strip().lower()
        counts[key] = counts.get(key, 0) + 1

    winner = sorted(counts.items(), key=lambda item: item[1], reverse=True)[0][0]
    total = sum(counts.values())
    disagreement = 1.0 - (counts[winner] / total)

    return {
        "status": "ok",
        "winner": winner,
        "votes": request.votes,
        "distribution": counts,
        "disagreement": round(disagreement, 4),
        "decision": "human_required" if disagreement > request.disagreement_threshold else winner,
    }


@app.post("/v1/route", response_model=RouteDecision)
async def route_only(request: OrchestrateRequest) -> RouteDecision:
    return _route(request.task, request.criticality, request.cost_limit_usd, request.prefer_local)


@app.post("/v1/execute", response_model=OrchestrateResponse)
async def execute(request: OrchestrateRequest) -> OrchestrateResponse:
    route = _route(request.task, request.criticality, request.cost_limit_usd, request.prefer_local)
    cfg = _config()
    start = perf_counter()

    model_used = route.primary_model
    provider_used = route.primary_provider
    fallback_used = False
    retries_used = 0

    primary_cfg = cfg.get(route.primary_model)
    fallback_cfg = cfg.get(route.fallback_model)

    if not primary_cfg:
        raise RuntimeError("primary_route_missing")
    if not fallback_cfg:
        raise RuntimeError("fallback_route_missing")

    errors: list[str] = []
    output = ""
    if not primary_cfg.available:
        errors.append(f"primary_unavailable:{primary_cfg.provider}")
    else:
        try:
            output, retries_used = await _run_with_resilience(primary_cfg.provider, primary_cfg.model, request.prompt)
        except Exception as exc:
            errors.append(str(exc))

    if not output:
        model_used = route.fallback_model
        provider_used = route.fallback_provider
        fallback_used = True
        if fallback_cfg.available:
            try:
                output, retries_used = await _run_with_resilience(fallback_cfg.provider, fallback_cfg.model, request.prompt)
            except Exception as exc:
                errors.append(str(exc))
        else:
            errors.append(f"fallback_unavailable:{fallback_cfg.provider}")

    if not output:
        model_used = "degraded-template"
        provider_used = "none"
        fallback_used = True
        output = (
            "Degraded mode: no provider available. "
            "Check OPENAI/ANTHROPIC/DEEPSEEK/MISTRAL keys or run local Ollama. "
            f"task={request.task}; criticality={request.criticality}; errors={';'.join(errors)}"
        )

    latency_ms = int((perf_counter() - start) * 1000)
    response_payload = OrchestrateResponse(
        route=route,
        model_used=model_used,
        provider_used=provider_used,
        output=output,
        latency_ms=latency_ms,
        retries_used=retries_used,
        fallback_used=fallback_used,
    )
    db_execute(
        """
        INSERT INTO ai_orchestration_events (
            task, prompt_preview, criticality, route, provider_used, model_used,
            estimated_cost_usd, retries_used, fallback_used, latency_ms, status, error_summary
        ) VALUES (
            %s, %s, %s, %s::jsonb, %s, %s,
            %s, %s, %s, %s, %s, %s
        )
        """,
        (
            request.task,
            request.prompt[:280],
            request.criticality,
            json_dumps(route.model_dump()),
            response_payload.provider_used,
            response_payload.model_used,
            route.estimated_cost_usd,
            response_payload.retries_used,
            response_payload.fallback_used,
            response_payload.latency_ms,
            "ok" if response_payload.provider_used != "none" else "degraded",
            ";".join(errors) if errors else None,
        ),
    )
    _purge_old_history()
    return response_payload