"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { useUiMode } from "../../lib/userUiPrefs";

const NAV_ITEMS = [
  { href: "/", label: "Dashboard" },
  { href: "/terminal", label: "Terminal" },
  { href: "/live-readiness", label: "Readiness" },
  { href: "/incidents", label: "Incidents" },
  { href: "/connectors", label: "Connectors" },
  { href: "/ai", label: "AI" },
  { href: "/learn", label: "Learn" },
  { href: "/advanced", label: "Advanced" },
  { href: "/settings", label: "Settings" },
];

export default function TxtGlobalNav() {
  const pathname = usePathname();
  const [uiMode, setUiMode] = useUiMode();

  if (pathname === "/login" || pathname === "/change-password") {
    return null;
  }

  return (
    <header className="txt-global-nav" role="banner">
      <div className="txt-global-brand-wrap">
        <div className="txt-global-brand">TXT</div>
        <div className="txt-global-subbrand">Trader eXelle Terminal</div>
      </div>
      <nav className="txt-global-links" aria-label="TXT main navigation">
        {NAV_ITEMS.map((item) => {
          const active = pathname === item.href;
          return (
            <Link key={item.href} href={item.href} className={`txt-global-link${active ? " active" : ""}`}>
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="txt-global-mode" role="tablist" aria-label="Global display mode">
        <button type="button" className={`txt-global-mode-btn${uiMode === "novice" ? " active" : ""}`} onClick={() => setUiMode("novice")}>
          Novice
        </button>
        <button type="button" className={`txt-global-mode-btn${uiMode === "expert" ? " active" : ""}`} onClick={() => setUiMode("expert")}>
          Expert
        </button>
      </div>
    </header>
  );
}