import type { ExecutionAttributionSummary } from "./executionAttributionLayer";
import type { SmartRoutePlan } from "../../lib/smartRouter";

type RouteCandidate = {
  venue?: unknown;
  score?: unknown;
  stability_score?: unknown;
  fill_probability?: unknown;
};

export type CrossVenueExecutionIntelligenceState = "PRIMARY" | "SPLIT" | "ROTATE" | "OBSERVE";
export type CrossVenueExecutionIntelligenceAction = "KEEP_PRIMARY" | "SPLIT_ROUTE" | "ROTATE_BACKUP" | "OBSERVE_ONLY";

export type CrossVenueExecutionIntelligenceSummary = {
  schema_version: "cross-venue-execution-intelligence/v1";
  generated_at_iso: string;
  state: CrossVenueExecutionIntelligenceState;
  action: CrossVenueExecutionIntelligenceAction;
  summary_label: string;
  recommended_primary_venue: string | null;
  backup_venue: string | null;
  split_venues: string[];
  recommended_split_pct: number;
  route_health_pct: number;
  opportunity_score_pct: number;
  confidence_pct: number;
  reasons: string[];
};

export type CrossVenueLocalRoutingDirective = {
  preferred_venue: string | null;
  route_mode_override: "bestSingleVenue" | null;
  allow_smart_routing_split: boolean;
  reason_tag: string;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function asVenue(value: unknown): string | null {
  const normalized = String(value || "").trim();
  return normalized || null;
}

function normalizeUnitScore(value: unknown, fallback = 0): number {
  const numeric = asNumber(value, fallback);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  if (numeric > 1) {
    return clamp(numeric / 100, 0, 1);
  }
  return clamp(numeric, 0, 1);
}

function dedupe(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))));
}

export function buildCrossVenueExecutionIntelligenceSummary(input: {
  marketTruthLockEnabled: boolean;
  routingInfraHealthScore: number;
  routingFailureClassification?: string;
  preferredRoute?: RouteCandidate | null;
  backupRoute?: RouteCandidate | null;
  smartRoutingPlan: SmartRoutePlan;
  executionAttribution: Pick<ExecutionAttributionSummary, "state" | "primary_driver" | "execution_loss_share_pct" | "components">;
  arbitrageActive: boolean;
  arbitrageNetSpreadBps: number;
  nowMs?: number;
}): CrossVenueExecutionIntelligenceSummary {
  const preferredVenue = asVenue(input.preferredRoute?.venue);
  const backupVenue = asVenue(input.backupRoute?.venue);
  const preferredScore = normalizeUnitScore(input.preferredRoute?.score, 0);
  const backupScore = normalizeUnitScore(input.backupRoute?.score, 0);
  const preferredStability = normalizeUnitScore(input.preferredRoute?.stability_score, 0);
  const backupStability = normalizeUnitScore(input.backupRoute?.stability_score, 0);
  const preferredFill = normalizeUnitScore(input.preferredRoute?.fill_probability, 0);
  const backupFill = normalizeUnitScore(input.backupRoute?.fill_probability, 0);
  const backupAdvantage = (backupScore - preferredScore) + (backupStability - preferredStability) + (backupFill - preferredFill);
  const routingImpactPct = input.executionAttribution.components.routing_impact_pct;
  const venueImpactPct = input.executionAttribution.components.venue_impact_pct;
  const routeHealthPct = Math.round(clamp(
    input.routingInfraHealthScore * 42
      + preferredStability * 23
      + preferredFill * 18
      + clamp(100 - routingImpactPct, 0, 100) * 0.1
      + clamp(100 - venueImpactPct, 0, 100) * 0.07,
    0,
    100,
  ));
  const opportunityScorePct = Math.round(clamp(
    input.smartRoutingPlan.coverageRatio * 42
      + (input.smartRoutingPlan.venueCount >= 2 ? 18 : 4)
      + clamp(12 - input.smartRoutingPlan.estimatedSlippageBps, 0, 12) * 2.5
      + (input.arbitrageActive ? clamp(input.arbitrageNetSpreadBps * 4, 0, 24) : 0),
    0,
    100,
  ));

  let state: CrossVenueExecutionIntelligenceState = "PRIMARY";
  let action: CrossVenueExecutionIntelligenceAction = "KEEP_PRIMARY";
  const reasons: string[] = [];

  if (input.marketTruthLockEnabled) {
    state = "OBSERVE";
    action = "OBSERVE_ONLY";
    reasons.push("cross_venue_intel:truth_lock");
  } else if (
    backupVenue
    && backupAdvantage >= 0.16
    && input.executionAttribution.execution_loss_share_pct >= 52
    && (input.executionAttribution.primary_driver === "ROUTING" || input.executionAttribution.primary_driver === "VENUE" || routingImpactPct >= 48 || venueImpactPct >= 48)
  ) {
    state = "ROTATE";
    action = "ROTATE_BACKUP";
    reasons.push(`cross_venue_intel:rotate:${backupVenue}`);
  } else if (
    input.smartRoutingPlan.venueCount >= 2
    && input.smartRoutingPlan.coverageRatio >= 0.85
    && input.smartRoutingPlan.estimatedSlippageBps <= 3.5
    && (input.arbitrageActive || opportunityScorePct >= 58)
  ) {
    state = "SPLIT";
    action = "SPLIT_ROUTE";
    reasons.push("cross_venue_intel:split_route");
  } else if (
    routeHealthPct < 34
    || (input.routingFailureClassification || "").length > 0
    || input.executionAttribution.execution_loss_share_pct >= 78
  ) {
    state = "OBSERVE";
    action = "OBSERVE_ONLY";
    reasons.push("cross_venue_intel:observe_only");
  } else {
    reasons.push(`cross_venue_intel:keep:${preferredVenue || input.smartRoutingPlan.primaryVenue || "none"}`);
  }

  if (backupVenue && backupAdvantage >= 0.08) {
    reasons.push(`cross_venue_intel:backup_advantage:${backupVenue}`);
  }
  if (input.arbitrageActive) {
    reasons.push(`cross_venue_intel:arbitrage:${input.arbitrageNetSpreadBps.toFixed(2)}bps`);
  }
  if ((input.routingFailureClassification || "").length > 0) {
    reasons.push(`cross_venue_intel:routing_failure:${String(input.routingFailureClassification).toLowerCase()}`);
  }

  const recommendedPrimaryVenue = action === "ROTATE_BACKUP"
    ? backupVenue
    : input.smartRoutingPlan.primaryVenue || preferredVenue;
  const confidencePct = Math.round(clamp(
    routeHealthPct * 0.5
      + opportunityScorePct * 0.3
      + clamp(100 - input.executionAttribution.execution_loss_share_pct, 0, 100) * 0.2,
    0,
    100,
  ));
  const splitVenues = dedupe(input.smartRoutingPlan.orders.map((order) => order.venue)).slice(0, 3);
  const recommendedSplitPct = action === "SPLIT_ROUTE"
    ? Math.round((input.smartRoutingPlan.orders[0]?.sharePct || 0) * 100)
    : 0;

  return {
    schema_version: "cross-venue-execution-intelligence/v1",
    generated_at_iso: new Date(input.nowMs || Date.now()).toISOString(),
    state,
    action,
    summary_label: `XVEN ${state} ${recommendedPrimaryVenue || "NONE"}`,
    recommended_primary_venue: recommendedPrimaryVenue,
    backup_venue: backupVenue,
    split_venues: splitVenues,
    recommended_split_pct: recommendedSplitPct,
    route_health_pct: routeHealthPct,
    opportunity_score_pct: opportunityScorePct,
    confidence_pct: confidencePct,
    reasons: dedupe(reasons),
  };
}

export function resolveCrossVenueLocalRoutingDirective(input: {
  summary: Pick<CrossVenueExecutionIntelligenceSummary, "action" | "recommended_primary_venue" | "summary_label">;
  smartRoutingPlan: Pick<SmartRoutePlan, "primaryVenue" | "venueCount" | "coverageRatio">;
}): CrossVenueLocalRoutingDirective {
  if (input.summary.action === "ROTATE_BACKUP") {
    return {
      preferred_venue: input.summary.recommended_primary_venue || input.smartRoutingPlan.primaryVenue,
      route_mode_override: "bestSingleVenue",
      allow_smart_routing_split: false,
      reason_tag: "cross_venue_route:rotate_backup",
    };
  }
  if (input.summary.action === "SPLIT_ROUTE") {
    return {
      preferred_venue: input.summary.recommended_primary_venue || input.smartRoutingPlan.primaryVenue,
      route_mode_override: null,
      allow_smart_routing_split: input.smartRoutingPlan.venueCount >= 2 && input.smartRoutingPlan.coverageRatio >= 0.55,
      reason_tag: "cross_venue_route:split_route",
    };
  }
  if (input.summary.action === "OBSERVE_ONLY") {
    return {
      preferred_venue: input.summary.recommended_primary_venue || input.smartRoutingPlan.primaryVenue,
      route_mode_override: "bestSingleVenue",
      allow_smart_routing_split: false,
      reason_tag: "cross_venue_route:observe_only",
    };
  }
  return {
    preferred_venue: input.summary.recommended_primary_venue || input.smartRoutingPlan.primaryVenue,
    route_mode_override: "bestSingleVenue",
    allow_smart_routing_split: false,
    reason_tag: "cross_venue_route:keep_primary",
  };
}