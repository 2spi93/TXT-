import { NextRequest, NextResponse } from "next/server";

import { buildCanonicalSpineHealthSnapshot, inspectCanonicalSpineSnapshotCache } from "../../../../lib/canonicalSpineHealth";
import { getControlPlaneToken } from "../../../../lib/controlPlane";
import { buildTradeLifecycleHealthSnapshot } from "../../../../lib/tradeLifecycleHealth";
import { inspectRuntimeTruthCache } from "../../../../lib/runtimeTruth";

function toNumber(value: unknown, fallback = 0): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

const RUNTIME_TRUTH_TRI_TTL_MS = Math.max(1_000, toNumber(process.env.RUNTIME_TRUTH_SNAPSHOT_TTL_MS, 15_000));
const CANONICAL_SPINE_TRI_TTL_MS = Math.max(1_000, toNumber(process.env.CANONICAL_SPINE_SNAPSHOT_TTL_MS, 60_000));

function unauthorized(): NextResponse {
  return NextResponse.json({ message: "Authentication required" }, { status: 401 });
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const token = await getControlPlaneToken();
  if (!token) {
    return unauthorized();
  }
  const sinceDays = Number(request.nextUrl.searchParams.get("sinceDays") || request.nextUrl.searchParams.get("since_days") || 30);
  const [runtimeTruthCacheAudit, canonicalSpineCacheAudit, canonicalSpine] = await Promise.all([
    inspectRuntimeTruthCache(),
    inspectCanonicalSpineSnapshotCache({ sinceDays }),
    buildCanonicalSpineHealthSnapshot({ sinceDays, allowStaleOnMiss: true }),
  ]);
  const snapshot = await buildTradeLifecycleHealthSnapshot({
    sinceDays,
    truthReliabilityInput: {
      spineMatchRatePct: toNumber(canonicalSpine.spine_match_rate_pct, 0),
      runtimeTruthSnapshotAgeMs: runtimeTruthCacheAudit.age_ms,
      canonicalSpineSnapshotAgeMs: canonicalSpineCacheAudit.age_ms,
      runtimeTruthTtlMs: RUNTIME_TRUTH_TRI_TTL_MS,
      canonicalSpineTtlMs: CANONICAL_SPINE_TRI_TTL_MS,
    },
  });
  return NextResponse.json(snapshot, { status: 200, headers: { "Cache-Control": "no-store" } });
}