import TradingTerminalPageClient from "./TradingTerminalPageClient";
import { buildInitialTerminalOperatorSnapshot } from "./operatorSnapshot";

export const dynamic = "force-dynamic";

export default async function TradingTerminalPage() {
  const initialOperatorSnapshot = await buildInitialTerminalOperatorSnapshot().catch(() => null);
  return <TradingTerminalPageClient initialOperatorSnapshot={initialOperatorSnapshot} />;
}
