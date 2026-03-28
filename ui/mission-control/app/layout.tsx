import "./globals.css";
import type { ReactNode } from "react";

import OpsChatbot from "../components/OpsChatbot";
import TxtGlobalNav from "../components/ui/TxtGlobalNav";
import UiModeController from "../components/ui/UiModeController";
import { getServerRoleGroup } from "../lib/serverAuth";

export const metadata = {
  title: "TXT - Trader eXelle Terminal",
  description: "Human-first trading platform"
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const roleGroup = await getServerRoleGroup();
  return (
    <html lang="en">
      <body>
        <UiModeController />
        <TxtGlobalNav roleGroup={roleGroup} />
        {children}
        <OpsChatbot />
      </body>
    </html>
  );
}
