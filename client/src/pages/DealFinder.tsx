import { useState } from "react";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Flame, Search, TrendingUp, ExternalLink, Bookmark, BookmarkCheck,
  ArrowDown, Sparkles, DollarSign, Zap, ChevronRight, RefreshCw,
  ShoppingCart, Tag, AlertTriangle,
} from "lucide-react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface Deal {
  title: string;
  platform: string;
  price: number;
  marketValue: number;
  discount: number;
  url: string | null;
  condition: string | null;
  size: string | null;
  rating: string | null;
  ratingNote: string | null;
}

interface SearchResult {
  query: string;
  deals: Deal[];
  marketData: {
    ebay: { soldCount: number; avgPrice: number; medianPrice: number; minPrice: number; maxPrice: number } | null;
    platforms: Array<{ platform: string; avgPrice: number; medianPrice: number; count: number; type: string }>;
  };
  analysis: {
    trendScore: number;
    demandLevel: string;
    avgFlipProfit: { low: number; high: number };
    marketSummary: string;
    bestPlatformToBuy: string;
    bestPlatformToSell: string;
    tips: string[];
    searchSuggestions: string[];
  } | null;
  totalFound: number;
}

interface TrendItem {
  query: string;
  category: string;
  buyPrice: { low: number; high: number };
  resalePrice: { low: number; high: number };
  demand: string;
  trendReason: string;
  platforms: string[];
}

const PLATFORM_COLORS: Record<string, string> = {
  depop: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  vinted: "bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-400",
  poshmark: "bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-400",
  ebay: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
};

const RATING_CONFIG: Record<string, { color: string; label: string }> = {
  great: { color: "text-emerald-600 dark:text-emerald-400", label: "Great Deal" },
  good: { color: "text-blue-600 dark:text-blue-400", label: "Good Deal" },
  okay: { color: "text-amber-600 dark:text-amber-400", label: "Okay" },
  risky: { color: "text-red-500", label: "Risky" },
};

const CATEGORY_ICONS: Record<string, string> = {
  clothing: "👕",
  sneakers: "👟",
  accessories: "👜",
  electronics: "📱",
  collectibles: "🎴",
  home: "🏠",
};

function DealCard({ deal, query, onSave, isSaved }: { deal: Deal; query: string; onSave: () => void; isSaved: boolean }) {
  const ratingInfo = deal.rating ? RATING_CONFIG[deal.rating] : null;

  return (
    <Card className={`transition-all hover:shadow-md ${deal.discount >= 50 ? "border-emerald-300 dark:border-emerald-700 bg-emerald-50/30 dark:bg-emerald-900/10" : ""}`}>
      <CardContent className="pt-4 pb-4">
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1.5 flex-wrap">
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase ${PLATFORM_COLORS[deal.platform] || "bg-gray-100 text-gray-700"}`}>
                {deal.platform}
              </span>
              {ratingInfo && (
                <span className={`text-[10px] font-semibold ${ratingInfo.color}`}>
                  {ratingInfo.label}
                </span>
              )}
              {deal.discount >= 50 && (
                <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 flex items-center gap-0.5">
                  <Flame size={10} /> HOT
                </span>
              )}
            </div>
            <p className="text-sm font-medium line-clamp-2">{deal.title}</p>
            {deal.ratingNote && (
              <p className="text-[11px] text-muted-foreground mt-1 line-clamp-2">{deal.ratingNote}</p>
            )}
            {(deal.condition || deal.size) && (
              <p className="text-[10px] text-muted-foreground mt-1">
                {[deal.condition, deal.size].filter(Boolean).join(" · ")}
              </p>
            )}
          </div>
          <div className="text-right shrink-0">
            <p className="text-lg font-bold font-mono text-emerald-600 dark:text-emerald-400">${deal.price}</p>
            <p className="text-xs text-muted-foreground line-through">${deal.marketValue}</p>
            <div className="flex items-center gap-0.5 justify-end mt-0.5">
              <ArrowDown size={10} className="text-emerald-500" />
              <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400">{deal.discount}%</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 mt-3">
          {deal.url && (
            <a href={deal.url} target="_blank" rel="noopener noreferrer" className="flex-1">
              <Button variant="outline" size="sm" className="w-full gap-1.5 text-xs h-8">
                <ExternalLink size={12} /> Open on {deal.platform}
              </Button>
            </a>
          )}
          <Button
            variant={isSaved ? "secondary" : "outline"}
            size="sm"
            className="gap-1.5 text-xs h-8 shrink-0"
            onClick={onSave}
            disabled={isSaved}
          >
            {isSaved ? <BookmarkCheck size={12} /> : <Bookmark size={12} />}
            {isSaved ? "Saved" : "Save"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function TrendCard({ trend, onSearch }: { trend: TrendItem; onSearch: (q: string) => void }) {
  const icon = CATEGORY_ICONS[trend.category] || "🔥";
  const profit = trend.resalePrice.low - trend.buyPrice.high;

  return (
    <Card className="cursor-pointer hover:shadow-md transition-all hover:border-primary/30 group" onClick={() => onSearch(trend.query)}>
      <CardContent className="pt-3 pb-3">
        <div className="flex items-start gap-3">
          <span className="text-xl">{icon}</span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <p className="text-sm font-semibold truncate">{trend.query}</p>
              <ChevronRight size={14} className="text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
            </div>
            <p className="text-[11px] text-muted-foreground line-clamp-2">{trend.trendReason}</p>
            <div className="flex items-center gap-3 mt-2">
              <span className="text-[10px] text-muted-foreground">
                Buy: <span className="font-mono font-semibold text-foreground">${trend.buyPrice.low}-${trend.buyPrice.high}</span>
              </span>
              <span className="text-[10px] text-muted-foreground">
                Sell: <span className="font-mono font-semibold text-emerald-600 dark:text-emerald-400">${trend.resalePrice.low}-${trend.resalePrice.high}</span>
              </span>
              {profit > 0 && (
                <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400">
                  +${profit}+
                </span>
              )}
            </div>
            <div className="flex items-center gap-1 mt-1.5">
              {trend.platforms.map(p => (
                <span key={p} className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full uppercase ${PLATFORM_COLORS[p] || ""}`}>{p}</span>
              ))}
              <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-4 ml-auto">
                {trend.demand} demand
              </Badge>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function DealFinder() {
  const [query, setQuery] = useState("");
  const [searchResult, setSearchResult] = useState<SearchResult | null>(null);
  const [searching, setSearching] = useState(false);
  const [savedDealIds, setSavedDealIds] = useState<Set<string>>(new Set());
  const { toast } = useToast();

  // Fetch trending categories
  const { data: trending, isLoading: trendingLoading, error: trendingError, refetch: refetchTrending } = useQuery<{ trends: TrendItem[]; insight: string }>({
    queryKey: ["/api/deals/trending"],
    queryFn: () => apiRequest("GET", "/api/deals/trending").then(r => r.json()),
    staleTime: 1000 * 60 * 30, // 30 min cache
    retry: 1,
  });

  // Fetch saved deals
  const { data: savedDeals = [] } = useQuery<any[]>({
    queryKey: ["/api/deals/saved"],
    queryFn: () => apiRequest("GET", "/api/deals/saved").then(r => r.json()),
  });

  const saveMutation = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/api/deals/save", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/deals/saved"] });
      toast({ title: "Deal saved!" });
    },
  });

  const searchDeals = async (searchQuery?: string) => {
    const q = searchQuery || query;
    if (!q.trim()) { toast({ title: "Enter a search query" }); return; }
    setQuery(q);
    setSearching(true);
    setSearchResult(null);
    try {
      const r = await apiRequest("POST", "/api/deals/search", { query: q });
      const data = await r.json();
      setSearchResult(data);
    } catch (e: any) {
      toast({ title: "Search failed", description: e.message, variant: "destructive" });
    } finally {
      setSearching(false);
    }
  };

  const saveDeal = (deal: Deal) => {
    const key = `${deal.platform}-${deal.title}-${deal.price}`;
    if (savedDealIds.has(key)) return;
    setSavedDealIds(prev => new Set(prev).add(key));
    saveMutation.mutate({
      query,
      platform: deal.platform,
      title: deal.title,
      price: deal.price,
      marketPrice: deal.marketValue,
      discount: deal.discount,
      url: deal.url,
      analysis: deal.ratingNote,
    });
  };

  const analysis = searchResult?.analysis;

  return (
    <div className="flex flex-col h-full">
      <header className="flex items-center gap-2 sm:gap-3 px-3 sm:px-5 md:px-6 py-3 sm:py-4 border-b border-border sticky top-0 bg-background/95 backdrop-blur z-10">
        <SidebarTrigger />
        <div className="flex-1">
          <h1 className="text-base sm:text-lg font-semibold flex items-center gap-2">
            <Flame size={18} className="text-orange-500" /> Deal Finder
          </h1>
          <p className="text-[11px] sm:text-xs text-muted-foreground">Find underpriced items to flip for profit</p>
        </div>
        {savedDeals.length > 0 && (
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-muted text-xs">
            <Bookmark size={12} />
            <span className="font-mono font-semibold">{savedDeals.length}</span>
            <span className="text-muted-foreground hidden sm:inline">saved</span>
          </div>
        )}
      </header>

      <main className="flex-1 overflow-y-auto px-3 sm:px-5 md:px-6 py-4 sm:py-6">
        <div className="max-w-4xl mx-auto space-y-5">
          {/* Search bar */}
          <Card>
            <CardContent className="pt-4 pb-4">
              <div className="flex gap-3">
                <div className="flex-1 relative">
                  <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={query}
                    onChange={e => setQuery(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && searchDeals()}
                    placeholder="e.g. vintage Carhartt jacket, Nike Dunk, Y2K baby tee..."
                    className="pl-9"
                    data-testid="deal-search-input"
                  />
                </div>
                <Button className="gap-2 shrink-0" onClick={() => searchDeals()} disabled={searching} data-testid="deal-search-btn">
                  <Zap size={15} />
                  {searching ? "Scanning..." : "Find Deals"}
                </Button>
              </div>
              {analysis?.searchSuggestions && analysis.searchSuggestions.length > 0 && (
                <div className="flex items-center gap-2 mt-3 flex-wrap">
                  <span className="text-[10px] text-muted-foreground">Related:</span>
                  {analysis.searchSuggestions.map((s, i) => (
                    <button
                      key={i}
                      onClick={() => searchDeals(s)}
                      className="text-[11px] px-2 py-0.5 rounded-full bg-muted hover:bg-primary/10 hover:text-primary transition-colors"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Loading state */}
          {searching && (
            <Card>
              <CardContent className="py-8 space-y-4">
                <div className="flex flex-col items-center gap-3">
                  <div className="w-12 h-12 rounded-full flex items-center justify-center pulse-glow"
                    style={{ background: "linear-gradient(135deg, hsl(25 90% 55%), hsl(350 80% 55%))" }}>
                    <Search size={20} className="text-white" />
                  </div>
                  <p className="text-sm font-medium">Scanning all platforms...</p>
                  <p className="text-xs text-muted-foreground text-center max-w-sm">
                    Searching Depop, Vinted, Poshmark for underpriced listings and comparing against eBay sold prices
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 skeleton" />)}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Search results */}
          {searchResult && !searching && (
            <>
              {/* Market overview */}
              {analysis && (
                <Card className="border-primary/20">
                  <CardContent className="pt-4 pb-4">
                    <div className="flex items-start gap-4">
                      <div className="flex flex-col items-center gap-1">
                        <div className="w-14 h-14 rounded-xl flex items-center justify-center"
                          style={{
                            background: analysis.trendScore >= 7
                              ? "linear-gradient(135deg, #22c55e, #10b981)"
                              : analysis.trendScore >= 5
                              ? "linear-gradient(135deg, #f59e0b, #eab308)"
                              : "linear-gradient(135deg, #ef4444, #dc2626)",
                          }}>
                          <TrendingUp size={22} className="text-white" />
                        </div>
                        <span className="text-lg font-bold font-mono">{analysis.trendScore}/10</span>
                        <span className="text-[9px] text-muted-foreground uppercase font-semibold">Trend</span>
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <h3 className="text-sm font-semibold">Market Analysis: {searchResult.query}</h3>
                          <Badge variant={analysis.demandLevel === "high" ? "default" : "secondary"} className="text-[10px] h-5">
                            {analysis.demandLevel} demand
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground leading-relaxed">{analysis.marketSummary}</p>
                        <div className="flex items-center gap-4 mt-2">
                          <span className="text-xs">
                            <DollarSign size={11} className="inline text-emerald-500" />
                            Profit: <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400">${analysis.avgFlipProfit.low}-${analysis.avgFlipProfit.high}</span>
                          </span>
                          <span className="text-xs text-muted-foreground">
                            Buy on <span className="font-semibold text-foreground">{analysis.bestPlatformToBuy}</span> &rarr; sell on <span className="font-semibold text-foreground">{analysis.bestPlatformToSell}</span>
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Tips */}
                    {analysis.tips && analysis.tips.length > 0 && (
                      <div className="mt-3 pt-3 border-t border-border">
                        <div className="flex items-center gap-1.5 mb-1.5">
                          <Sparkles size={12} className="text-amber-500" />
                          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Tips</span>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                          {analysis.tips.map((tip, i) => (
                            <p key={i} className="text-[11px] text-muted-foreground flex gap-1.5">
                              <span className="text-primary shrink-0">*</span> {tip}
                            </p>
                          ))}
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}

              {/* eBay market baseline */}
              {searchResult.marketData.ebay && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <Card className="bg-blue-50/50 dark:bg-blue-900/10 border-blue-200 dark:border-blue-800">
                    <CardContent className="pt-3 pb-3 text-center">
                      <p className="text-[10px] text-blue-600 dark:text-blue-400 font-semibold uppercase mb-1">eBay Sold Avg</p>
                      <p className="text-xl font-bold font-mono">${searchResult.marketData.ebay.avgPrice}</p>
                    </CardContent>
                  </Card>
                  <Card className="bg-blue-50/50 dark:bg-blue-900/10 border-blue-200 dark:border-blue-800">
                    <CardContent className="pt-3 pb-3 text-center">
                      <p className="text-[10px] text-blue-600 dark:text-blue-400 font-semibold uppercase mb-1">eBay Median</p>
                      <p className="text-xl font-bold font-mono">${searchResult.marketData.ebay.medianPrice}</p>
                    </CardContent>
                  </Card>
                  <Card className="bg-blue-50/50 dark:bg-blue-900/10 border-blue-200 dark:border-blue-800">
                    <CardContent className="pt-3 pb-3 text-center">
                      <p className="text-[10px] text-blue-600 dark:text-blue-400 font-semibold uppercase mb-1">Price Range</p>
                      <p className="text-xl font-bold font-mono">${searchResult.marketData.ebay.minPrice}-${searchResult.marketData.ebay.maxPrice}</p>
                    </CardContent>
                  </Card>
                  <Card className="bg-blue-50/50 dark:bg-blue-900/10 border-blue-200 dark:border-blue-800">
                    <CardContent className="pt-3 pb-3 text-center">
                      <p className="text-[10px] text-blue-600 dark:text-blue-400 font-semibold uppercase mb-1">Sold Count</p>
                      <p className="text-xl font-bold font-mono">{searchResult.marketData.ebay.soldCount}</p>
                      <p className="text-[9px] text-emerald-600 dark:text-emerald-400 font-medium mt-0.5">Real sold prices</p>
                    </CardContent>
                  </Card>
                </div>
              )}

              {/* Deals list */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <Tag size={14} className="text-primary" />
                    <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      {searchResult.deals.length > 0 ? `${searchResult.deals.length} Deals Found` : "No Deals Found"}
                    </span>
                    {searchResult.totalFound > searchResult.deals.length && (
                      <span className="text-[10px] text-muted-foreground">({searchResult.totalFound} total below market)</span>
                    )}
                  </div>
                </div>

                {searchResult.deals.length > 0 ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {searchResult.deals.map((deal, i) => {
                      const key = `${deal.platform}-${deal.title}-${deal.price}`;
                      return (
                        <DealCard
                          key={i}
                          deal={deal}
                          query={query}
                          onSave={() => saveDeal(deal)}
                          isSaved={savedDealIds.has(key)}
                        />
                      );
                    })}
                  </div>
                ) : (
                  <Card className="border-dashed">
                    <CardContent className="py-8 text-center">
                      <AlertTriangle size={28} className="mx-auto text-muted-foreground/40 mb-2" />
                      <p className="text-sm font-medium text-muted-foreground">No underpriced listings found</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        All current listings are priced at or above market value. Try a different search term.
                      </p>
                    </CardContent>
                  </Card>
                )}
              </div>

              {/* Platform comparison */}
              {searchResult.marketData.platforms.length > 0 && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <span className="inline-flex items-center gap-1">
                        <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                        Platform Prices
                      </span>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      {searchResult.marketData.platforms.map(m => (
                        <div key={m.platform} className="bg-muted/40 rounded-lg p-3">
                          <div className="flex items-center justify-between mb-1.5">
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase ${PLATFORM_COLORS[m.platform] || ""}`}>{m.platform}</span>
                            <span className="text-[10px] text-muted-foreground">{m.count} {m.type}</span>
                          </div>
                          <p className="text-sm font-bold font-mono">${m.avgPrice} avg</p>
                          <p className="text-[10px] text-muted-foreground">${m.medianPrice} median</p>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}
            </>
          )}

          {/* Trending categories (shown when no search results) */}
          {!searchResult && !searching && (
            <>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <TrendingUp size={16} className="text-orange-500" />
                  <h2 className="text-sm font-semibold">Trending Now</h2>
                  <span className="text-[10px] text-muted-foreground">AI-powered trend analysis</span>
                </div>
                <Button variant="ghost" size="sm" className="gap-1.5 text-xs h-7" onClick={() => refetchTrending()} disabled={trendingLoading}>
                  <RefreshCw size={12} className={trendingLoading ? "animate-spin" : ""} />
                  Refresh
                </Button>
              </div>

              {trending?.insight && (
                <div className="bg-gradient-to-r from-orange-50 to-amber-50 dark:from-orange-900/10 dark:to-amber-900/10 rounded-xl p-3 border border-orange-200/50 dark:border-orange-800/30">
                  <div className="flex items-center gap-2">
                    <Sparkles size={14} className="text-orange-500 shrink-0" />
                    <p className="text-xs text-orange-800 dark:text-orange-300">{trending.insight}</p>
                  </div>
                </div>
              )}

              {trendingLoading ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-28 skeleton" />)}
                </div>
              ) : trending?.trends && trending.trends.length > 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {trending.trends.map((trend, i) => (
                    <TrendCard key={i} trend={trend} onSearch={searchDeals} />
                  ))}
                </div>
              ) : (
                <Card className="border-dashed">
                  <CardContent className="py-6 text-center">
                    <AlertTriangle size={24} className="mx-auto text-amber-500/60 mb-2" />
                    <p className="text-sm font-medium text-muted-foreground">Could not load trending categories</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {trendingError ? (trendingError as Error).message : "The AI trend analyzer returned no results"}
                    </p>
                    <Button variant="outline" size="sm" className="mt-3 gap-1.5 text-xs" onClick={() => refetchTrending()}>
                      <RefreshCw size={12} /> Try again
                    </Button>
                  </CardContent>
                </Card>
              )}

              {/* Saved deals section */}
              {savedDeals.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <Bookmark size={14} className="text-primary" />
                    <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Saved Deals</span>
                    <span className="text-[10px] text-muted-foreground">({savedDeals.length})</span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {savedDeals.slice(0, 6).map((deal: any) => (
                      <Card key={deal.id} className="hover:shadow-sm transition-shadow">
                        <CardContent className="pt-3 pb-3">
                          <div className="flex items-center gap-2 mb-1">
                            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full uppercase ${PLATFORM_COLORS[deal.platform] || ""}`}>
                              {deal.platform}
                            </span>
                            <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400">-{deal.discount}%</span>
                          </div>
                          <p className="text-xs font-medium line-clamp-1">{deal.title}</p>
                          <div className="flex items-center justify-between mt-1.5">
                            <span className="text-sm font-bold font-mono text-emerald-600 dark:text-emerald-400">${deal.price}</span>
                            <span className="text-[10px] text-muted-foreground">
                              Market: <span className="line-through">${deal.marketPrice}</span>
                            </span>
                          </div>
                          {deal.url && (
                            <a href={deal.url} target="_blank" rel="noopener noreferrer" className="block mt-2">
                              <Button variant="ghost" size="sm" className="w-full h-7 text-[10px] gap-1">
                                <ExternalLink size={10} /> Open listing
                              </Button>
                            </a>
                          )}
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </div>
              )}

              {/* How it works */}
              <Card className="border-dashed bg-muted/20">
                <CardContent className="pt-4 pb-4">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">How Deal Finder Works</p>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="flex gap-2">
                      <div className="w-7 h-7 rounded-lg bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center shrink-0">
                        <Search size={13} className="text-blue-600 dark:text-blue-400" />
                      </div>
                      <div>
                        <p className="text-xs font-semibold">1. Search</p>
                        <p className="text-[10px] text-muted-foreground">We scan Depop, Vinted, Poshmark for active listings</p>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <div className="w-7 h-7 rounded-lg bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center shrink-0">
                        <DollarSign size={13} className="text-emerald-600 dark:text-emerald-400" />
                      </div>
                      <div>
                        <p className="text-xs font-semibold">2. Compare</p>
                        <p className="text-[10px] text-muted-foreground">Compare against real eBay sold prices (actual market value)</p>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <div className="w-7 h-7 rounded-lg bg-orange-100 dark:bg-orange-900/30 flex items-center justify-center shrink-0">
                        <ShoppingCart size={13} className="text-orange-600 dark:text-orange-400" />
                      </div>
                      <div>
                        <p className="text-xs font-semibold">3. Flip</p>
                        <p className="text-[10px] text-muted-foreground">Buy underpriced items and resell at market value for profit</p>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
