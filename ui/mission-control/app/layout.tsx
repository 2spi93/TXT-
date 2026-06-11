import "./globals.css";
import type { ReactNode } from "react";

import LazyOpsChatbot from "../components/LazyOpsChatbot";
import TxtGlobalNav from "../components/ui/TxtGlobalNav";
import UiModeController from "../components/ui/UiModeController";

export const metadata = {
  title: "TXT - Trader eXelle Terminal",
  description: "Human-first trading platform"
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <UiModeController />
        <TxtGlobalNav />
        {children}
        <LazyOpsChatbot />
      </body>
    </html>
  );
}
