"use client";

import {
  ArrowRightLeft,
  ChartNoAxesCombined,
  Landmark,
  LayoutDashboard,
  Lightbulb,
  Menu,
  Settings,
  WalletCards,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

const navigation = [
  { label: "Dashboard", href: "/", icon: LayoutDashboard },
  { label: "Transactions", href: "/transactions", icon: ArrowRightLeft },
  { label: "Accounts", href: "/accounts", icon: Landmark },
  { label: "Budgets", href: "/budgets", icon: WalletCards },
  { label: "Insights", href: "/insights", icon: Lightbulb },
  { label: "Settings", href: "/settings", icon: Settings },
];

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();

  return (
    <nav aria-label="Primary navigation" className="sidebar-nav">
      {navigation.map((item) => {
        const active =
          item.href === "/"
            ? pathname === "/"
            : pathname.startsWith(item.href);
        const Icon = item.icon;

        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`nav-link ${active ? "nav-link-active" : ""}`}
            onClick={onNavigate}
          >
            <Icon size={18} strokeWidth={1.8} aria-hidden="true" />
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

function Brand() {
  return (
    <Link href="/" className="brand" aria-label="Moneta dashboard">
      <span className="brand-mark" aria-hidden="true">
        M
      </span>
      <span>
        <strong>MONETA</strong>
        <small>YOUR MONEY, CLEARLY</small>
      </span>
    </Link>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const isAuth = pathname === "/login" || pathname === "/setup";

  if (isAuth) {
    return <>{children}</>;
  }

  return (
    <div className="app-frame">
      <aside className="sidebar">
        <Brand />
        <div className="sidebar-label">Workspace</div>
        <NavLinks />
        <div className="sidebar-foot">
          <div className="sidebar-foot-icon">
            <ChartNoAxesCombined size={17} aria-hidden="true" />
          </div>
          <div>
            <span>Private by design</span>
            <small>Your data stays on this server.</small>
          </div>
        </div>
      </aside>

      <header className="mobile-header">
        <Brand />
        <button
          className="icon-button"
          type="button"
          aria-label="Open navigation"
          aria-expanded={open}
          onClick={() => setOpen(true)}
        >
          <Menu size={20} />
        </button>
      </header>

      {open ? (
        <div className="mobile-drawer-layer">
          <button
            type="button"
            className="drawer-backdrop"
            aria-label="Close navigation"
            onClick={() => setOpen(false)}
          />
          <aside className="mobile-drawer">
            <div className="drawer-heading">
              <Brand />
              <button
                className="icon-button"
                type="button"
                aria-label="Close navigation"
                onClick={() => setOpen(false)}
              >
                <X size={20} />
              </button>
            </div>
            <NavLinks onNavigate={() => setOpen(false)} />
          </aside>
        </div>
      ) : null}

      <main className="main-content">{children}</main>
    </div>
  );
}
