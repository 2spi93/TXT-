"use client";

import { createContext, useContext, useEffect, useMemo, type MutableRefObject, type ReactNode } from "react";

import type { PredictorEngineV8, PredictorEngineV8TrainingStats } from "../../lib/predictorEngineV8";
import type { MlTrainingSample } from "../../lib/mlDatasetBuilder";

type JsonMap = Record<string, unknown>;

const V8_BACKEND_TRAINING_MAX_BUFFER = 400;

type PredictorTrainingSnapshot = {
  telemetry: JsonMap[];
  outcomes: JsonMap[];
  avgExecutionLatencyMs: number;
  avgExecutionSlippageBps: number;
  effectiveV8Probability: number;
  predictorRequestPayload: JsonMap;
  predictorMarketSession: string;
  notional: number;
  mlReplayTrainingDataset: MlTrainingSample[];
  selfLearningShadowSchedulerRunCount: number;
  v8PersistenceLoaded: boolean;
};

type TerminalPredictorRuntimeProviderProps = {
  children: ReactNode;
  predictorTrainingSnapshot: PredictorTrainingSnapshot;
  predictorEngineV8Ref: MutableRefObject<PredictorEngineV8>;
  predictorTrainingBufferRef: MutableRefObject<JsonMap[]>;
  predictorTrainingQueuedIdsRef: MutableRefObject<Set<string>>;
  predictorSchedulerRetrainRunRef: MutableRefObject<number>;
  flushBackendPredictorTrainingBuffer: () => Promise<void> | void;
  onTrainingStatsChange: (stats: PredictorEngineV8TrainingStats) => void;
  onPersistenceLoaded: (loaded: boolean) => void;
  storageKey: string;
  legacyStorageKey?: string;
  trainingFlushSize: number;
  trainingFlushIntervalMs: number;
};

type TerminalPredictorRuntimeContextValue = Omit<TerminalPredictorRuntimeProviderProps, "children">;

const TerminalPredictorRuntimeContext = createContext<TerminalPredictorRuntimeContextValue | null>(null);

function toNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function trimPredictorTrainingBuffer(buffer: JsonMap[]): void {
  if (buffer.length <= V8_BACKEND_TRAINING_MAX_BUFFER) {
    return;
  }
  buffer.splice(0, buffer.length - V8_BACKEND_TRAINING_MAX_BUFFER);
}

function useTerminalPredictorRuntimeContext(): TerminalPredictorRuntimeContextValue {
  const context = useContext(TerminalPredictorRuntimeContext);
  if (!context) {
    throw new Error("Terminal predictor runtime boundary must be used inside its provider.");
  }
  return context;
}

export function TerminalPredictorRuntimeProvider({ children, ...value }: TerminalPredictorRuntimeProviderProps) {
  const contextValue = useMemo<TerminalPredictorRuntimeContextValue>(() => value, [value]);

  return (
    <TerminalPredictorRuntimeContext.Provider value={contextValue}>
      {children}
    </TerminalPredictorRuntimeContext.Provider>
  );
}

export function TerminalPredictorTrainingBoundary() {
  const {
    predictorTrainingSnapshot,
    predictorEngineV8Ref,
    predictorTrainingBufferRef,
    predictorTrainingQueuedIdsRef,
    predictorSchedulerRetrainRunRef,
    flushBackendPredictorTrainingBuffer,
    onTrainingStatsChange,
    onPersistenceLoaded,
    storageKey,
    legacyStorageKey,
    trainingFlushSize,
    trainingFlushIntervalMs,
  } = useTerminalPredictorRuntimeContext();

  useEffect(() => {
    if (typeof window === "undefined") {
      onPersistenceLoaded(true);
      return;
    }

    let raw = window.localStorage.getItem(storageKey);
    if (!raw && legacyStorageKey) {
      raw = window.localStorage.getItem(legacyStorageKey);
      if (raw) {
        window.localStorage.setItem(storageKey, raw);
      }
    }
    if (!raw) {
      onPersistenceLoaded(true);
      return;
    }

    try {
      const parsed = JSON.parse(raw);
      if (predictorEngineV8Ref.current.loadState(parsed)) {
        onTrainingStatsChange(predictorEngineV8Ref.current.getTrainingStats());
      }
    } catch {
      window.localStorage.removeItem(storageKey);
      if (legacyStorageKey) {
        window.localStorage.removeItem(legacyStorageKey);
      }
    }

    onPersistenceLoaded(true);
  }, [legacyStorageKey, onPersistenceLoaded, onTrainingStatsChange, predictorEngineV8Ref, storageKey]);

  useEffect(() => {
    if (!predictorTrainingSnapshot.v8PersistenceLoaded) {
      return;
    }
    predictorEngineV8Ref.current.trainFromTelemetry(predictorTrainingSnapshot.telemetry);
    predictorEngineV8Ref.current.trainFromTelemetry(predictorTrainingSnapshot.outcomes);
    const stats = predictorEngineV8Ref.current.getTrainingStats();
    onTrainingStatsChange(stats);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(storageKey, JSON.stringify(predictorEngineV8Ref.current.getState()));
    }
  }, [onTrainingStatsChange, predictorEngineV8Ref, predictorTrainingSnapshot.outcomes, predictorTrainingSnapshot.telemetry, predictorTrainingSnapshot.v8PersistenceLoaded, storageKey]);

  useEffect(() => {
    if (!predictorTrainingSnapshot.v8PersistenceLoaded) {
      return;
    }
    const runCount = predictorTrainingSnapshot.selfLearningShadowSchedulerRunCount;
    if (runCount < 5 || runCount % 5 !== 0) {
      return;
    }
    if (predictorSchedulerRetrainRunRef.current === runCount || predictorTrainingSnapshot.mlReplayTrainingDataset.length < 12) {
      return;
    }
    predictorEngineV8Ref.current.retrainModel(predictorTrainingSnapshot.mlReplayTrainingDataset, 8);
    predictorSchedulerRetrainRunRef.current = runCount;
    const stats = predictorEngineV8Ref.current.getTrainingStats();
    onTrainingStatsChange(stats);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(storageKey, JSON.stringify(predictorEngineV8Ref.current.getState()));
    }
  }, [onTrainingStatsChange, predictorEngineV8Ref, predictorSchedulerRetrainRunRef, predictorTrainingSnapshot.mlReplayTrainingDataset, predictorTrainingSnapshot.selfLearningShadowSchedulerRunCount, predictorTrainingSnapshot.v8PersistenceLoaded, storageKey]);

  useEffect(() => {
    const telemetryItems = [...predictorTrainingSnapshot.telemetry, ...predictorTrainingSnapshot.outcomes];
    for (const item of telemetryItems) {
      const sampleId = String(item.decision_id || item.id || item.event_id || "").trim();
      if (!sampleId || predictorTrainingQueuedIdsRef.current.has(sampleId)) {
        continue;
      }
      predictorTrainingQueuedIdsRef.current.add(sampleId);
      const predictorContext = item.predictor_context && typeof item.predictor_context === "object"
        ? item.predictor_context as JsonMap
        : predictorTrainingSnapshot.predictorRequestPayload;
      const pnlBps = toNumber(item.pnl_bps ?? item.realized_pnl_bps, 0);
      const pnlUsd = toNumber(item.pnl_usd ?? item.net_result_usd ?? item.realized_pnl_usd, 0);
      const slippageBps = Math.abs(toNumber(item.realized_slippage_bps ?? item.slippage_real_bps, predictorTrainingSnapshot.avgExecutionSlippageBps));
      const latencyMs = toNumber(item.latency_e2e_ms ?? item.latency_ms, predictorTrainingSnapshot.avgExecutionLatencyMs);
      const arbEdgeBps = toNumber(item.expected_net_edge_bps ?? item.net_edge_bps, toNumber(predictorTrainingSnapshot.predictorRequestPayload.arb_edge_bps, 0));
      const fillProbability = clamp(toNumber(item.fill_ratio ?? item.fill_probability, toNumber(predictorTrainingSnapshot.predictorRequestPayload.fill_probability, 0)), 0, 1);
      const label = pnlBps > 0 && slippageBps <= Math.max(1, arbEdgeBps * 1.15 + 1.5) && latencyMs < 150 ? 1 : 0;
      const rawAction = String(item.action || item.side || item.intent_side || item.order_side || item.direction || item.position_side || "HOLD").trim().toUpperCase();
      const experienceAction = rawAction.includes("SELL") || rawAction === "SHORT"
        ? "SELL"
        : rawAction.includes("BUY") || rawAction === "LONG"
          ? "BUY"
          : "HOLD";
      const experienceReward = pnlBps - slippageBps * 0.75 - Math.max(0, latencyMs - 25) * 0.04;
      const experienceState = {
        ...predictorContext,
        probability: predictorTrainingSnapshot.effectiveV8Probability,
        model_probability: predictorTrainingSnapshot.effectiveV8Probability,
        final_edge_bps: arbEdgeBps,
        fill_probability: fillProbability,
        market_session: String(predictorContext.market_session || predictorTrainingSnapshot.predictorMarketSession || "off"),
      };
      const experienceNextState = {
        ...experienceState,
        latency_ms: latencyMs,
        latency_e2e_ms: latencyMs,
        slippage_bps: slippageBps,
        realized_slippage_bps: slippageBps,
        pnl: pnlBps,
        realized_pnl_usd: pnlUsd,
        drawdown_pct: toNumber(item.drawdown_pct ?? item.current_drawdown_pct ?? item.drawdown, 0),
        position_size: toNumber(item.position_size ?? item.position, 0),
      };
      predictorTrainingBufferRef.current.push({
        id: sampleId,
        features: {
          ...predictorContext,
          latency_ms: latencyMs,
          slippage_bps: slippageBps,
          arb_edge_bps: arbEdgeBps,
          fill_probability: fillProbability,
          venue: String(item.route_chosen || item.venue || ""),
          notional_usd: toNumber(item.notional_usd ?? item.estimated_notional_usd, predictorTrainingSnapshot.notional),
        },
        experience_id: sampleId,
        action: experienceAction,
        reward: experienceReward,
        state: experienceState,
        next_state: experienceNextState,
        prediction: toNumber(item.v8_probability ?? item.prediction_probability, predictorTrainingSnapshot.effectiveV8Probability),
        outcome: {
          pnl_bps: pnlBps,
          latency_ms: latencyMs,
          slippage_bps: slippageBps,
          status: String(item.status || "filled"),
        },
        latency: latencyMs,
        pnl: pnlBps,
        slippage: slippageBps,
        venue: String(item.route_chosen || item.venue || ""),
        label,
      });
      trimPredictorTrainingBuffer(predictorTrainingBufferRef.current);
    }
    if (predictorTrainingBufferRef.current.length >= trainingFlushSize) {
      void flushBackendPredictorTrainingBuffer();
    }
  }, [flushBackendPredictorTrainingBuffer, predictorEngineV8Ref, predictorTrainingBufferRef, predictorTrainingQueuedIdsRef, predictorTrainingSnapshot, trainingFlushSize]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void flushBackendPredictorTrainingBuffer();
    }, trainingFlushIntervalMs);
    return () => {
      window.clearInterval(timer);
    };
  }, [flushBackendPredictorTrainingBuffer, trainingFlushIntervalMs]);

  return null;
}