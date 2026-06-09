import { NextResponse } from "next/server";

import { appendAllocationWriterStageTransitions } from "../../../../../lib/allocationWriterAuditJournal";
import { appendApprovalDecisionJournalEntry } from "../../../../../lib/approvalDecisionJournal";
import {
  classifyControlPlaneNetworkRegime,
  computeControlPlaneInfraHealth,
  cpFetchJsonSafe,
  extractMcContextHeaders,
  getControlPlaneNetworkMetricsSnapshot,
} from "../../../../../lib/controlPlane";

type JsonMap = Record<string, unknown>;

type OrderIntentPayload = {
  source?: string;
  mode?: string;
  preset?: string;
  final_decision_truth?: JsonMap;
  edge_eligibility?: JsonMap;
  oco?: {
    enabled?: boolean;
    group_id?: string;
    cancel_policy?: string;
  };
  bracket?: {
    entry?: number;
    stop_loss?: number;
    take_profit?: number;
    rr_ratio?: number;
    risk_usd?: number;
    reward_usd?: number;
  };
  risk_preview?: {
    qty?: number;
    notional?: number;
    max_spread_bps?: number;
    max_loss_usd?: number;
    target_gain_usd?: number;
    target_rr?: number;
    guard_enabled?: boolean;
    confirm_ack?: boolean;
  };
};

function asObject(value: unknown): JsonMap {
  return value && typeof value === "object" ? (value as JsonMap) : {};
}

function asNumber(value: unknown, fallback = 0): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function firstNonEmpty(...values: unknown[]): string {
  for (const value of values) {
    const normalized = String(value || "").trim();
    if (normalized) {
      return normalized;
    }
  }
  return "";
}

async function appendApprovalDecisionArtifact(params: {
  approvalPayloadRaw: unknown;
  orderPayload: JsonMap;
  predictorContext: JsonMap;
}): Promise<void> {
  const approvalPayload = asObject(params.approvalPayloadRaw);
  const approvalId = firstNonEmpty(approvalPayload.approval_id);
  if (!approvalId) {
    return;
  }
  const orderPayload = asObject(params.orderPayload);
  const metadata = asObject(orderPayload.metadata);
  const orderIntent = asObject(orderPayload.order_intent);
  const finalDecisionTruth = Object.keys(asObject(metadata.final_decision_truth)).length > 0
    ? asObject(metadata.final_decision_truth)
    : asObject(orderIntent.final_decision_truth);
  const riskContext = Object.keys(asObject(approvalPayload.risk_context)).length > 0
    ? asObject(approvalPayload.risk_context)
    : params.predictorContext;
  const hardening = Object.keys(asObject(approvalPayload.go_live_hardening)).length > 0
    ? asObject(approvalPayload.go_live_hardening)
    : asObject(approvalPayload.hardening);
  const decisionId = firstNonEmpty(
    approvalPayload.decision_id,
    orderPayload.decision_id,
    metadata.decision_id,
    orderIntent.decision_id,
    finalDecisionTruth.oracle_fingerprint,
    approvalId,
  );
  const tradeLifecycleId = firstNonEmpty(
    approvalPayload.trade_lifecycle_id,
    orderPayload.trade_lifecycle_id,
    metadata.trade_lifecycle_id,
    orderIntent.trade_lifecycle_id,
    finalDecisionTruth.oracle_fingerprint,
    decisionId,
  );
  const candidateId = firstNonEmpty(
    approvalPayload.candidate_id,
    orderPayload.candidate_id,
    metadata.candidate_id,
    orderIntent.candidate_id,
    finalDecisionTruth.oracle_fingerprint,
    decisionId,
  );
  await appendApprovalDecisionJournalEntry({
    approval_fact_id: `${approvalId}:approval_1:${Date.now()}`,
    approval_id: approvalId,
    approval_stage: "approval_1",
    approval_status: firstNonEmpty(approvalPayload.status, "pending_second_approval"),
    trade_lifecycle_id: tradeLifecycleId || null,
    candidate_id: candidateId || null,
    decision_id: decisionId || null,
    causality_confidence: "native",
    allocation_id: null,
    execution_id: null,
    outcome_id: null,
    account_id: firstNonEmpty(approvalPayload.account_id, orderPayload.account_id) || null,
    portfolio_id: firstNonEmpty(approvalPayload.portfolio_id, orderPayload.portfolio_id, metadata.portfolio_id) || null,
    strategy_id: firstNonEmpty(approvalPayload.strategy_id, metadata.selected_strategy_id, metadata.strategy_id) || null,
    symbol: firstNonEmpty(approvalPayload.symbol, orderPayload.symbol).toUpperCase(),
    side: firstNonEmpty(approvalPayload.side, orderPayload.side, "buy").toLowerCase(),
    lots: asNumber(approvalPayload.lots || orderPayload.lots || null, Number.NaN),
    estimated_notional_usd: asNumber(approvalPayload.estimated_notional_usd || orderPayload.estimated_notional_usd || null, Number.NaN),
    approval_mode: firstNonEmpty(approvalPayload.approval_mode, "mt5_double_approval"),
    first_approved_by: firstNonEmpty(approvalPayload.first_approved_by) || null,
    second_approved_by: null,
    rejection_code: null,
    rejection_reason: null,
    predictor_summary: firstNonEmpty(approvalPayload.predictor_summary, riskContext.network_regime) || null,
    hardening,
    risk_context: riskContext,
    order_payload: orderPayload,
    source_event_category: "mt5_live_order_pending_second_approval",
    created_at_iso: firstNonEmpty(approvalPayload.created_at, approvalPayload.timestamp, new Date().toISOString()),
  });
  const writerTimestampIso = firstNonEmpty(approvalPayload.created_at, approvalPayload.timestamp, new Date().toISOString());
  await appendAllocationWriterStageTransitions([
    {
      decision_id: decisionId || null,
      candidate_id: candidateId || null,
      trade_lifecycle_id: tradeLifecycleId || null,
      portfolio_id: firstNonEmpty(approvalPayload.portfolio_id, orderPayload.portfolio_id, metadata.portfolio_id) || null,
      selected_strategy_id: firstNonEmpty(approvalPayload.strategy_id, metadata.selected_strategy_id, metadata.strategy_id) || null,
      writer_version: firstNonEmpty(approvalPayload.approval_mode, "mt5_double_approval"),
      writer_timestamp_iso: writerTimestampIso,
      previous_stage: "PERSISTED",
      next_stage: "APPROVAL_CREATED",
    },
    ...(decisionId || tradeLifecycleId || candidateId ? [{
      decision_id: decisionId || null,
      candidate_id: candidateId || null,
      trade_lifecycle_id: tradeLifecycleId || null,
      portfolio_id: firstNonEmpty(approvalPayload.portfolio_id, orderPayload.portfolio_id, metadata.portfolio_id) || null,
      selected_strategy_id: firstNonEmpty(approvalPayload.strategy_id, metadata.selected_strategy_id, metadata.strategy_id) || null,
      writer_version: firstNonEmpty(approvalPayload.approval_mode, "mt5_double_approval"),
      writer_timestamp_iso: writerTimestampIso,
      previous_stage: "APPROVAL_CREATED" as const,
      next_stage: "APPROVAL_LINKED" as const,
    }] : []),
    ...(Object.keys(hardening).length > 0 ? [{
      decision_id: decisionId || null,
      candidate_id: candidateId || null,
      trade_lifecycle_id: tradeLifecycleId || null,
      portfolio_id: firstNonEmpty(approvalPayload.portfolio_id, orderPayload.portfolio_id, metadata.portfolio_id) || null,
      selected_strategy_id: firstNonEmpty(approvalPayload.strategy_id, metadata.selected_strategy_id, metadata.strategy_id) || null,
      writer_version: firstNonEmpty(approvalPayload.approval_mode, "mt5_double_approval"),
      writer_timestamp_iso: writerTimestampIso,
      previous_stage: "APPROVAL_LINKED" as const,
      next_stage: "HARDENING_REACHED" as const,
    }] : []),
  ]);
}

export async function POST(request: Request): Promise<NextResponse> {
  const forwardedHeaders = extractMcContextHeaders(request);
  const raw = asObject(await request.json());
  const networkMetrics = getControlPlaneNetworkMetricsSnapshot();
  const infraHealth = computeControlPlaneInfraHealth(networkMetrics);
  const networkRegime = classifyControlPlaneNetworkRegime(networkMetrics, infraHealth);
  const side = asString(raw.side, "buy") === "sell" ? "sell" : "buy";
  const orderIntentRaw = asObject(raw.order_intent) as OrderIntentPayload;
  const rawMetadata = asObject(raw.metadata);
  const bracket = asObject(orderIntentRaw.bracket);
  const oco = asObject(orderIntentRaw.oco);
  const riskPreview = asObject(orderIntentRaw.risk_preview);
  const explicitFinalDecisionTruth = asObject(orderIntentRaw.final_decision_truth);
  const metadataFinalDecisionTruth = asObject(rawMetadata.final_decision_truth);
  const normalizedFinalDecisionTruth = Object.keys(explicitFinalDecisionTruth).length > 0
    ? explicitFinalDecisionTruth
    : metadataFinalDecisionTruth;
  const explicitEdgeEligibility = asObject(orderIntentRaw.edge_eligibility);
  const derivedEdgeEligibility = asObject(normalizedFinalDecisionTruth.edge_eligibility);
  const metadataEdgeEligibility = asObject(rawMetadata.edge_eligibility);
  const normalizedEdgeEligibility = Object.keys(explicitEdgeEligibility).length > 0
    ? explicitEdgeEligibility
    : Object.keys(derivedEdgeEligibility).length > 0
      ? derivedEdgeEligibility
      : metadataEdgeEligibility;
  const predictorContext = asObject(raw.predictor_context);

  const normalizedOrderIntent: OrderIntentPayload | undefined = Object.keys(orderIntentRaw).length > 0
    ? {
      source: asString(orderIntentRaw.source, "terminal-chart"),
      mode: asString(orderIntentRaw.mode, "bracket"),
      preset: asString(orderIntentRaw.preset, "custom"),
      final_decision_truth: Object.keys(normalizedFinalDecisionTruth).length > 0 ? normalizedFinalDecisionTruth : undefined,
      edge_eligibility: Object.keys(normalizedEdgeEligibility).length > 0 ? normalizedEdgeEligibility : undefined,
      oco: {
        enabled: Boolean(oco.enabled),
        group_id: asString(oco.group_id) || (Boolean(oco.enabled) ? `oco-${Date.now()}-${Math.floor(Math.random() * 100000)}` : ""),
        cancel_policy: asString(oco.cancel_policy, "cancel-other-on-fill"),
      },
      bracket: {
        entry: asNumber(bracket.entry),
        stop_loss: asNumber(bracket.stop_loss),
        take_profit: asNumber(bracket.take_profit),
        rr_ratio: asNumber(bracket.rr_ratio),
        risk_usd: asNumber(bracket.risk_usd),
        reward_usd: asNumber(bracket.reward_usd),
      },
      risk_preview: {
        qty: asNumber(riskPreview.qty),
        notional: asNumber(riskPreview.notional),
        max_spread_bps: asNumber(riskPreview.max_spread_bps),
        max_loss_usd: asNumber(riskPreview.max_loss_usd),
        target_gain_usd: asNumber(riskPreview.target_gain_usd),
        target_rr: asNumber(riskPreview.target_rr),
        guard_enabled: Boolean(riskPreview.guard_enabled),
        confirm_ack: Boolean(riskPreview.confirm_ack),
      },
    }
    : undefined;

  const body = {
    account_id: asString(raw.account_id),
    symbol: asString(raw.symbol),
    side,
    confidence: asNumber(raw.confidence),
    preferred_venue: asString(raw.preferred_venue),
    lots: asNumber(raw.lots, 0.1),
    estimated_notional_usd: asNumber(raw.estimated_notional_usd),
    max_spread_bps: asNumber(raw.max_spread_bps),
    rationale: asString(raw.rationale),
    predictor_context: {
      ...predictorContext,
      infra_health: asNumber(predictorContext.infra_health, infraHealth),
      network_regime: asString(predictorContext.network_regime, networkRegime),
      network_metrics: Object.keys(asObject(predictorContext.network_metrics)).length > 0
        ? asObject(predictorContext.network_metrics)
        : networkMetrics,
    },
    order_intent: normalizedOrderIntent,
    // Compatibility fields for downstream services that consume top-level bracket/oco.
    bracket: normalizedOrderIntent?.bracket,
    oco: normalizedOrderIntent?.oco,
    metadata: {
      ...rawMetadata,
      ...(Object.keys(normalizedFinalDecisionTruth).length > 0 ? { final_decision_truth: normalizedFinalDecisionTruth } : {}),
      ...(Object.keys(normalizedEdgeEligibility).length > 0 ? { edge_eligibility: normalizedEdgeEligibility } : {}),
      ui: "mission-control-ui",
      schema_version: "mt5-order-filter-v2",
      submitted_at: new Date().toISOString(),
    },
  };

  const { response, payload } = await cpFetchJsonSafe("/v1/mt5/orders/filter", {
    method: "POST",
    headers: {
      ...Object.fromEntries(forwardedHeaders.entries()),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const augmented = asObject(payload);
  if (normalizedOrderIntent) {
    augmented.order_intent = augmented.order_intent || normalizedOrderIntent;
    augmented.oco_group_id = asString(augmented.oco_group_id) || asString(normalizedOrderIntent.oco?.group_id);
  }
  if (response.ok) {
    await appendApprovalDecisionArtifact({
      approvalPayloadRaw: augmented,
      orderPayload: body as JsonMap,
      predictorContext,
    }).catch(() => null);
  }
  return NextResponse.json(augmented, { status: response.status });
}
