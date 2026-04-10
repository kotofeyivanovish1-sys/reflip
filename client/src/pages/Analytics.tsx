import { useQuery } from "@tanstack/react-query";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { RadarChart, Radar, PolarGrid, PolarAngleAxis, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, PieChart, Pie, Cell, Legend } from "recharts";
import { apiRequest } from "@/lib/queryClient";
import { TrendingUp, Target, BarChart3 } from "lucide-react";

const PLATFORM_COLORS: Record<string, string> = {
  depop: "#ff4e4e",
  vinted: "#09b1ba",
  poshmark: "#e94365",
  ebay: "#e43c24",
};

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card border border-border rounded-lg px-3 py-2 shadow-lg text-xs">
      <p className="font-semibold mb-1">{label}</p>
      {payload.map((p: any) => (
        <p key={p.name} style={{ color: p.color ?? p.fill }}>{p.name}: <span className="font-mono">{typeof p.value === "number" && p.name?.includes("$") ? `$${p.value.toFixed(0)}` : p.value}</span></p>
      ))}
    </div>
  );
};

export default function Analytics() {
  const { data: platforms = [], isLoading: loadingPlatforms } = useQuery({
    queryKey: ["/api/stats/platforms"],
    queryFn: () => apiRequest("GET", "/api/stats/platforms").then(r => r.json()),
  });

  const { data: stats, isLoading: loadingStats } = useQuery({
    queryKey: ["/api/stats/dashboard"],
    queryFn: () => apiRequest("GET", "/api/stats/dashboard").then(r => r.json()),
  });

  const radarData = platforms.map((p: any) => ({
    platform: p.platform,
    "Sales Vol.": p.soldItems,
    "Revenue": Math.round(p.revenue / 10),
    "Margin %": p.avgMargin,
    "Activity": p.totalItems,
  }));

  const profitData = platforms.map((p: any) => ({
    name: p.platform.charAt(0).toUpperCase() + p.platform.slice(1),
    profit: Math.round(p.profit),
    revenue: Math.round(p.revenue),
    margin: p.avgMargin,
    platform: p.platform,
  }));

  const pieData = platforms.filter((p: any) => p.soldItems > 0).map((p: any) => ({
    name: p.platform,
    value: p.soldItems,
  }));

  const isLoading = loadingPlatforms || loadingStats;

  // Listing suggestions based on data
  const suggestions = [];
  if (platforms.length > 0) {
    const best = [...platforms].sort((a: any, b: any) => b.avgMargin - a.avgMargin)[0];
    if (best) suggestions.push({ icon: TrendingUp, color: "text-emerald-500", text: `${best.platform.charAt(0).toUpperCase() + best.platform.slice(1)} has your highest margin (${best.avgMargin}%). List more items there.` });
    const mostActive = [...platforms].sort((a: any, b: any) => b.activeItems - a.activeItems)[0];
    if (mostActive) suggestions.push({ icon: Target, color: "text-blue-500", text: `You have ${mostActive.activeItems} active listings on ${mostActive.platform}. Keep them refreshed every 30 days.` });
    if (stats?.avgProfit < 25) suggestions.push({ icon: BarChart3, color: "text-amber-500", text: `Avg profit is $${stats.avgProfit.toFixed(0)}. Focus on higher-ticket items like jackets and designer bags.` });
  }

  return (
    <div className="flex flex-col h-full">
      <header className="flex items-center gap-2 sm:gap-3 px-3 sm:px-5 md:px-6 py-3 sm:py-4 border-b border-border sticky top-0 bg-background/95 backdrop-blur z-10">
        <SidebarTrigger />
        <div>
          <h1 className="text-base sm:text-lg font-semibold">Analytics</h1>
          <p className="text-[11px] sm:text-xs text-muted-foreground">Performance by platform</p>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto px-3 sm:px-5 md:px-6 py-4 sm:py-6 space-y-4 sm:space-y-5">
        {/* Platform cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {isLoading ? (
            Array.from({length: 2}).map((_, i) => (
              <Card key={i}><CardContent className="pt-5"><Skeleton className="h-36 skeleton" /></CardContent></Card>
            ))
          ) : (
            platforms.map((p: any) => (
              <Card key={p.platform} data-testid={`analytics-card-${p.platform}`}>
                <CardContent className="pt-4 pb-4">
                  <div className="flex items-center justify-between mb-4">
                    <span className={`badge-${p.platform} text-[11px] font-bold px-3 py-1 rounded-full uppercase tracking-wide`}>{p.platform}</span>
                    <span className="text-xs text-muted-foreground">{p.totalItems} total items</span>
                  </div>
                  <div className="grid grid-cols-3 gap-3 text-center">
                    <div>
                      <p className="text-xl font-bold font-mono">{p.soldItems}</p>
                      <p className="text-xs text-muted-foreground">Sold</p>
                    </div>
                    <div>
                      <p className="text-xl font-bold font-mono">${p.revenue?.toFixed(0)}</p>
                      <p className="text-xs text-muted-foreground">Revenue</p>
                    </div>
                    <div>
                      <p className={`text-xl font-bold font-mono ${p.avgMargin > 60 ? "text-emerald-600 dark:text-emerald-400" : p.avgMargin > 40 ? "text-amber-600 dark:text-amber-400" : "text-foreground"}`}>{p.avgMargin}%</p>
                      <p className="text-xs text-muted-foreground">Margin</p>
                    </div>
                  </div>
                  {p.topCategories?.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-border">
                      <p className="text-[10px] text-muted-foreground uppercase font-semibold tracking-wider mb-1.5">Top categories</p>
                      <div className="flex gap-1.5 flex-wrap">
                        {p.topCategories.map((c: any) => (
                          <span key={c.name} className="text-xs bg-muted px-2 py-0.5 rounded-full">{c.name} ({c.count})</span>
                        ))}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Bar chart: Revenue vs Profit */}
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Revenue vs Profit by Platform</CardTitle></CardHeader>
            <CardContent>
              {isLoading ? <Skeleton className="h-48 skeleton" /> : (
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={profitData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                    <XAxis dataKey="name" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} tickFormatter={v => `$${v}`} />
                    <Tooltip content={<CustomTooltip />} cursor={{ fill: "hsl(var(--muted)/0.4)" }} />
                    <Bar dataKey="revenue" name="Revenue $" radius={[4, 4, 0, 0]}>
                      {profitData.map((p) => <Cell key={p.name} fill={PLATFORM_COLORS[p.platform] || "#888"} opacity={0.6} />)}
                    </Bar>
                    <Bar dataKey="profit" name="Profit $" radius={[4, 4, 0, 0]}>
                      {profitData.map((p) => <Cell key={p.name} fill={PLATFORM_COLORS[p.platform] || "#888"} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          {/* Pie: sales distribution */}
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Sales Distribution</CardTitle></CardHeader>
            <CardContent>
              {isLoading ? <Skeleton className="h-48 skeleton" /> : pieData.length > 0 ? (
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie data={pieData} cx="50%" cy="50%" innerRadius={50} outerRadius={80} dataKey="value" paddingAngle={3}>
                      {pieData.map((entry: any) => (
                        <Cell key={entry.name} fill={PLATFORM_COLORS[entry.name] || "#888"} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(value: any, name: any) => [value + " sales", name]} />
                    <Legend formatter={(value: any) => <span className="text-xs capitalize">{value}</span>} />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <p className="text-xs text-muted-foreground text-center py-16">No sales data yet</p>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Monthly trend */}
        {stats?.monthlySales && (
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Monthly Sales Trend</CardTitle></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={stats.monthlySales}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                  <Tooltip content={<CustomTooltip />} cursor={{ fill: "hsl(var(--muted)/0.4)" }} />
                  <Bar dataKey="sales" name="Items sold" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        )}

        {/* AI Recommendations */}
        {suggestions.length > 0 && (
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Recommendations</CardTitle></CardHeader>
            <CardContent>
              <div className="space-y-2">
                {suggestions.map((s, i) => (
                  <div key={i} className="flex items-start gap-3 bg-muted/40 rounded-lg p-3 text-sm">
                    <s.icon size={14} className={`${s.color} mt-0.5 shrink-0`} />
                    <p className="text-sm">{s.text}</p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
}
