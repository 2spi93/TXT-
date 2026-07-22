"use client";

import { useEffect, useState } from "react";

import type { TradabilityAnalyticsSummary } from "../../lib/tradabilityAnalytics";
import TradabilityScienceCard from "./TradabilityScienceCard";

type Props = {
  title?: string;
  testId?: string;
  mode?: "full" | "compact";
  containerClassName?: string;
  refreshMs?: number;
};

export default function TradabilityScienceDesk({
  title,
  testId,
  mode = "full",
  containerClassName,
  refreshMs = 15_000,
}: Props) {
  const [summary, setSummary] = useState<TradabilityAnalyticsSummary | null>(null);

  useEffect(() => {
    let mounted = true;

    const load = async () => {
      try {
        const response = await fetch("/api/terminal/tradability/analytics?sinceDays=14&limit=1200", { cache: "no-store" });
        if (!response.ok) {
          throw new Error(`tradability analytics ${response.status}`);
        }
        const payload = await response.json() as TradabilityAnalyticsSummary;
        if (mounted) {
          setSummary(payload);
        }
      } catch {
        if (mounted) {
          setSummary(null);
        }
      }
    };

    void load();
    const timer = window.setInterval(() => {
      void load();
    }, refreshMs);

    return () => {
      mounted = false;
      window.clearInterval(timer);
    };
  }, [refreshMs]);

  return (
    <TradabilityScienceCard
      summary={summary}
      title={title}
      testId={testId}
      mode={mode}
      containerClassName={containerClassName}
    />
  );
}