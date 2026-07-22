import { NextRequest, NextResponse } from "next/server";

import { cpFetchJsonSafe, extractMcContextHeaders } from "../../../../lib/controlPlane";
import { buildPerformanceAttributionRows, parseAttributionGroupBy } from "../../../../lib/performanceAttributionV1";

function hasEnhancedAttributionRows(rows: unknown[]): boolean {
  return rows.some((row) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      return false;
    }
    const candidate = row as Record<string, unknown>;
    return candidate.allocation_alpha_bps_avg !== undefined
      || candidate.signal_alpha_bps_avg !== undefined
      || candidate.timing_alpha_bps_avg !== undefined
      || candidate.execution_alpha_bps_avg !== undefined
      || candidate.winner_component !== undefined
      || candidate.loser_component !== undefined;
  });
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const query = request.nextUrl.searchParams.toString();
  const path = `/v1/performance/attribution${query ? `?${query}` : ""}`;
  const { response, payload } = await cpFetchJsonSafe(path, {
    headers: extractMcContextHeaders(request),
  });

  const rows = Array.isArray((payload as { rows?: unknown[] } | null)?.rows)
    ? (payload as { rows: unknown[] }).rows
    : [];
  if (response.ok && rows.length > 0 && hasEnhancedAttributionRows(rows)) {
    return NextResponse.json(payload, { status: response.status });
  }

  const scopeType = request.nextUrl.searchParams.get("scope_type") || request.nextUrl.searchParams.get("scopeType") || "";
  const scopeId = request.nextUrl.searchParams.get("scope_id") || request.nextUrl.searchParams.get("scopeId") || "";
  const groupBy = parseAttributionGroupBy(request.nextUrl.searchParams.get("group_by") || request.nextUrl.searchParams.get("groupBy"));
  const sinceDays = Number(request.nextUrl.searchParams.get("since_days") || request.nextUrl.searchParams.get("sinceDays") || 30);
  const limit = Number(request.nextUrl.searchParams.get("limit") || 2000);
  const fallbackRows = await buildPerformanceAttributionRows({ scopeType, scopeId, groupBy, sinceDays, limit });

  return NextResponse.json({
    scope_type: scopeType || "portfolio",
    scope_id: scopeId,
    group_by: groupBy,
    period_start: sinceDays > 0 ? new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000).toISOString() : null,
    period_end: new Date().toISOString(),
    source: "canonical_execution_facts_v1",
    rows: fallbackRows,
  }, { status: 200 });
}
