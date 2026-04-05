import { useLocation, Link } from "wouter";
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup,
  SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarHeader,
} from "@/components/ui/sidebar";
import { LayoutDashboard, ShoppingBag, Plus, ScanLine, BarChart3, Moon, Sun, LogOut } from "lucide-react";
import { useState, useEffect } from "react";
import { useAuth } from "@/lib/auth";

const navItems = [
  { href: "/", icon: LayoutDashboard, label: "Dashboard" },
  { href: "/listings", icon: ShoppingBag, label: "Listings" },
  { href: "/listings/new", icon: Plus, label: "New Listing" },
  { href: "/scanner", icon: ScanLine, label: "Store Scanner" },
  { href: "/analytics", icon: BarChart3, label: "Analytics" },
];

export function AppSidebar() {
  const [location] = useLocation();
  const [dark, setDark] = useState(() => window.matchMedia("(prefers-color-scheme: dark)").matches);
  const { user, logout } = useAuth();

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);

  return (
    <Sidebar collapsible="icon" data-testid="sidebar">
      <SidebarHeader className="px-4 py-5">
        <div className="flex items-center gap-3">
          {/* Gradient logo */}
          <div className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0"
            style={{ background: "linear-gradient(135deg, hsl(250 80% 58%), hsl(195 80% 55%), hsl(280 70% 60%))" }}>
            <svg width="16" height="16" viewBox="0 0 28 28" fill="none" aria-label="ReFlip">
              <path d="M7 8h8a5 5 0 0 1 0 10H7V8Z" stroke="white" strokeWidth="2.5" fill="none" />
              <path d="M13 18l6 4" stroke="white" strokeWidth="2.5" strokeLinecap="round" />
            </svg>
          </div>
          <div className="group-data-[collapsible=icon]:hidden">
            <p className="text-sm font-semibold text-sidebar-foreground tracking-tight">ReFlip</p>
            <p className="text-[10px] text-sidebar-foreground/40">Reseller Intelligence</p>
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarMenu className="gap-0.5">
            {navItems.map((item) => {
              const isActive = location === item.href;
              return (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton
                    asChild
                    isActive={isActive}
                    tooltip={item.label}
                    data-testid={`nav-${item.label.toLowerCase().replace(/\s/g, "-")}`}
                    className={isActive ? "!bg-sidebar-accent !text-sidebar-primary font-medium" : ""}
                  >
                    <Link href={item.href} className="flex items-center gap-3">
                      <item.icon size={16} />
                      <span className="text-sm">{item.label}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              );
            })}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="px-2 py-3 space-y-1">
        {user && (
          <div className="px-3 py-2 rounded-lg flex items-center gap-2 group-data-[collapsible=icon]:justify-center">
            <div className="w-6 h-6 rounded-full flex items-center justify-center shrink-0 text-[10px] font-bold text-white"
              style={{ background: "linear-gradient(135deg, hsl(250 80% 58%), hsl(280 70% 60%))" }}>
              {(user.name || user.email)[0].toUpperCase()}
            </div>
            <div className="group-data-[collapsible=icon]:hidden min-w-0">
              <p className="text-xs font-medium text-sidebar-foreground truncate">{user.name || "Reseller"}</p>
              <p className="text-[10px] text-sidebar-foreground/40 truncate">{user.email}</p>
            </div>
          </div>
        )}
        <button
          onClick={() => setDark(d => !d)}
          className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sidebar-foreground/50 hover:text-sidebar-foreground hover:bg-sidebar-accent transition-colors w-full text-xs group-data-[collapsible=icon]:justify-center"
          aria-label="Toggle theme"
        >
          {dark ? <Sun size={14} /> : <Moon size={14} />}
          <span className="group-data-[collapsible=icon]:hidden">{dark ? "Light mode" : "Dark mode"}</span>
        </button>
        {user && (
          <button
            onClick={logout}
            className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sidebar-foreground/40 hover:text-red-400 hover:bg-sidebar-accent transition-colors w-full text-xs group-data-[collapsible=icon]:justify-center"
            aria-label="Sign out"
          >
            <LogOut size={14} />
            <span className="group-data-[collapsible=icon]:hidden">Sign out</span>
          </button>
        )}
      </SidebarFooter>
    </Sidebar>
  );
}
