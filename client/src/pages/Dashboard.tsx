import { useQuery, useMutation } from "@tanstack/react-query";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { TrendingUp, DollarSign, Package, Tag, ArrowUpRight, RefreshCw, Zap, AlertTriangle, Lightbulb, Clock } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { useState } from "react";

const PRIORITY_COLORS = {
  high: "text-red-500 bg-red-50 dark:bg-red-900/20",
  medium: "text-amber-600 bg-amber-50 dark:bg-amber-900/20",
  low: "text-blue-500 bg-blue-50 dark:bg-blue-900/20",
};
const TYPE_ICONS: Record<string, any> = {
  price: DollarSign, platform: Tag, timing: Clock, sourcing: Lightbulb, action: Zap,
};

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="glass-card rounded-xl px-3 py-2 text-xs shadow-xl">
      <p className="font-semibold mb-1">{label}</p>
      {payload.map((p: any) => (
        <p key={p.name} style={{ color: p.color }}>{p.name}: <span className="font-mono">${p.value?.toFixed(0)}</span></p>
      ))}
    </div>
  );
};

function KPICard({ title, value, sub, trend, gradient }: any) {
  return (
    <div className="glass-card rounded-2xl p-5 relative overflow-hidden group hover:scale-[1.02] transition-transform duration-300">
      <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300 rounded-2xl"
        style={{ background: gradient, opacity: 0.05 }} />
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-widest mb-2">{title}</p>
      <p className="text-2xl font-semibold tracking-tight">{value}</p>
      {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
      {trend !== undefined && (
        <div className={`flex items-center gap-1 mt-2 text-xs font-medium ${trend >= 0 ? "text-emerald-500" : "text-red-500"}`}>
          <ArrowUpRight size={12} style={{ transform: trend < 0 ? "rotate(90deg)" : undefined }} />
          {Math.abs(trend)}% vs last month
        </div>
      )}
    </div>
  );
}

export default function Dashboard() {
  const { user } = useAuth();
  const [recommendations, setRecommendations] = useState<any>(null);
  const [recsLoading, setRecsLoading] = useState(false);

  const { data: stats, isLoading } = useQuery({
    queryKey: ["/api/stats/dashboard"],
    queryFn: () => apiRequest("GET", "/api/stats/dashboard").then(r => r.json()),
  });

  const loadRecs = async () => {
    setRecsLoading(true);
    try {
      const r = await apiRequest("POST", "/api/ai/recommendations", {});
      const data = await r.json();
      setRecommendations(data);
    } catch {} finally { setRecsLoading(false); }
  };

  return (
    <div className="flex flex-col h-full">
      <header className="flex items-center justify-between gap-2 sm:gap-3 px-3 sm:px-5 md:px-6 py-3 sm:py-4 border-b border-border/50 sticky top-0 bg-background/80 backdrop-blur-xl z-10">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <SidebarTrigger />
          <div className="min-w-0">
            <h1 className="text-sm sm:text-base font-semibold truncate">
              Good morning, <span className="gradient-text">{user?.name || "Reseller"}</span>
            </h1>
            <p className="text-[11px] sm:text-xs text-muted-foreground">Your business at a glance</p>
          </div>
        </div>
        <Button size="sm" variant="outline" className="gap-1.5 sm:gap-2 rounded-xl text-[11px] sm:text-xs h-7 sm:h-8 shrink-0" onClick={loadRecs} disabled={recsLoading}>
          <RefreshCw size={12} className={recsLoading ? "animate-spin" : ""} />
          <span className="hidden sm:inline">{recsLoading ? "Analyzing..." : "AI Recommendations"}</span>
          <span className="sm:hidden">{recsLoading ? "..." : "AI"}</span>
        </Button>
      </header>

      <main className="flex-1 overflow-y-auto px-3 sm:px-5 md:px-6 py-4 sm:py-6 space-y-4 sm:space-y-6">
        {/* KPI Grid */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {isLoading ? (
            Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-2xl skeleton" />)
          ) : (
            <>
              <KPICard title="Revenue" value={`$${stats?.totalRevenue?.toFixed(0) || 0}`}
                sub={`${stats?.soldItems || 0} items sold`} trend={12}
                gradient="linear-gradient(135deg, hsl(250 80% 60%), hsl(280 70% 60%))" />
              <KPICard title="Net Profit" value={`$${stats?.totalProfit?.toFixed(0) || 0}`}
                sub={`avg $${stats?.avgProfit?.toFixed(0) || 0}/item`} trend={8}
                gradient="linear-gradient(135deg, hsl(150 65% 45%), hsl(195 80% 55%))" />
              <KPICard title="Listed" value={stats?.activeListings || 0}
                sub="Active now" gradient="linear-gradient(135deg, hsl(35 90% 55%), hsl(330 75% 58%))" />
              <KPICard title="Inventory" value={stats?.totalItems || 0}
                sub="Total items" gradient="linear-gradient(135deg, hsl(195 80% 55%), hsl(250 80% 60%))" />
            </>
          )}
        </div>

        {/* AI Co-Pilot Persistent Monitor */}
        <div className="slide-up">
          <div className="glass-card border-primary/20 rounded-3xl p-5 mb-4 shadow-[0_0_40px_-15px_rgba(var(--primary),0.3)]">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl flex items-center justify-center pulse-glow"
                  style={{ background: "linear-gradient(135deg, hsl(250 85% 65%), hsl(280 80% 65%))" }}>
                  <Zap size={18} className="text-white drop-shadow-md" />
                </div>
                <div>
                  <h2 className="text-base font-semibold bg-clip-text text-transparent bg-gradient-to-r from-primary to-accent">ReFlip AI Co-Pilot</h2>
                  <p className="text-xs text-muted-foreground flex items-center gap-1.5 mt-0.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                    Monitoring your active listings...
                  </p>
                </div>
              </div>
              {recommendations?.topInsight && (
                <div className="hidden md:flex items-center bg-primary/5 border border-primary/10 rounded-xl px-4 py-2 text-xs text-primary font-medium">
                  "{recommendations.topInsight}"
                </div>
              )}
            </div>
            {recsLoading ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {Array.from({length:4}).map((_,i) => <Skeleton key={i} className="h-20 rounded-2xl skeleton" />)}
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {(recommendations?.recommendations || []).map((rec: any, i: number) => {
                  const Icon = TYPE_ICONS[rec.type] || Lightbulb;
                  return (
                    <div key={i} className="glass-card rounded-2xl p-4 flex gap-3 hover:scale-[1.01] transition-transform duration-200">
                      <div className={`p-1.5 rounded-lg shrink-0 ${PRIORITY_COLORS[rec.priority as keyof typeof PRIORITY_COLORS]}`}>
                        <Icon size={13} />
                      </div>
                      <div>
                        <p className="text-xs font-semibold mb-0.5">{rec.title}</p>
                        <p className="text-xs text-muted-foreground leading-relaxed">{rec.detail}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>        {/* Charts row */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Monthly chart */}
          <div className="lg:col-span-2 glass-card rounded-2xl p-5">
            <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-4">Revenue & Profit — 6 months</h2>
            {isLoading ? <Skeleton className="h-48 skeleton" /> : (
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={stats?.monthlySales || []} barGap={3}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} tickFormatter={v => `$${v}`} width={40} />
                  <Tooltip content={<CustomTooltip />} cursor={{ fill: "hsl(var(--muted)/0.3)" }} />
                  <Bar dataKey="revenue" name="Revenue" fill="hsl(250 80% 65%)" radius={[5,5,0,0]} />
                  <Bar dataKey="profit" name="Profit" fill="hsl(195 80% 55%)" radius={[5,5,0,0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Platform breakdown */}
          <div className="glass-card rounded-2xl p-5">
            <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-4">By Platform</h2>
            {isLoading ? (
              <div className="space-y-3">{Array.from({length:3}).map((_,i) => <Skeleton key={i} className="h-10 skeleton" />)}</div>
            ) : (
              <div className="space-y-3">
                {(stats?.platformBreakdown || []).map((p: any) => (
                  <div key={p.platform} className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className={`badge-${p.platform} text-[10px] font-bold px-2 py-0.5 rounded-full uppercase`}>{p.platform}</span>
                      <span className="text-xs text-muted-foreground">{p.sales} sold</span>
                    </div>
                    <span className="text-sm font-semibold font-mono">${p.revenue?.toFixed(0)}</span>
                  </div>
                ))}
                {!stats?.platformBreakdown?.length && (
                  <p className="text-xs text-muted-foreground text-center py-6">Mark listings as sold to see platform stats</p>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Recent Sales */}
        <div className="glass-card rounded-2xl p-5">
          <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-4">Recent Sales</h2>
          {isLoading ? (
            <div className="space-y-2">{Array.from({length:4}).map((_,i) => <Skeleton key={i} className="h-10 skeleton" />)}</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[10px] text-muted-foreground border-b border-border/50">
                    <th className="text-left pb-2 font-medium uppercase tracking-wider">Item</th>
                    <th className="text-left pb-2 font-medium uppercase tracking-wider">Platform</th>
                    <th className="text-right pb-2 font-medium uppercase tracking-wider">Sold</th>
                    <th className="text-right pb-2 font-medium uppercase tracking-wider">Profit</th>
                    <th className="text-right pb-2 font-medium uppercase tracking-wider">Date</th>
                  </tr>
                </thead>
                <tbody>
                  {(stats?.recentSales || []).map((s: any) => (
                    <tr key={s.id} className="border-b border-border/30 hover:bg-muted/20 transition-colors">
                      <td className="py-2.5 font-medium max-w-[200px] truncate">{s.title}</td>
                      <td className="py-2.5">
                        <span className={`badge-${s.platform} text-[10px] font-bold px-2 py-0.5 rounded-full uppercase`}>{s.platform}</span>
                      </td>
                      <td className="py-2.5 text-right font-mono text-sm">${s.soldPrice?.toFixed(0)}</td>
                      <td className="py-2.5 text-right font-mono text-sm text-emerald-500">+${((s.soldPrice||0)-s.costPrice).toFixed(0)}</td>
                      <td className="py-2.5 text-right text-xs text-muted-foreground">{s.soldAt}</td>
                    </tr>
                  ))}
                  {!stats?.recentSales?.length && (
                    <tr><td colSpan={5} className="py-10 text-center text-xs text-muted-foreground">No sales yet — mark a listing as sold to see it here</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
