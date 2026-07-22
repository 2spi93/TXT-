import LiveOpsPageClient from "./LiveOpsPageClient";
import { buildInitialLiveOpsBootstrapPayload } from "./liveOpsBootstrap";

export const dynamic = "force-dynamic";

export default async function LiveOpsPage() {
  const initialLiveOpsPayload = await buildInitialLiveOpsBootstrapPayload().catch(() => null);
  return <LiveOpsPageClient initialLiveOpsPayload={initialLiveOpsPayload} />;
}
