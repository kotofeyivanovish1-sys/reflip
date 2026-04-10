import { useState, useRef } from "react";
import { useLocation } from "wouter";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ScanLine, Camera, CheckCircle, AlertCircle, ShoppingBag, Copy, CheckCheck, ExternalLink } from "lucide-react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient, getAuthHeaders } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import type { ScanResult } from "@shared/schema";

const SCORE_COLORS = {
  high: "text-emerald-600 dark:text-emerald-400",
  medium: "text-amber-600 dark:text-amber-400",
  low: "text-red-500",
};

function ScoreRing({ score }: { score: number }) {
  const circumference = 2 * Math.PI * 20;
  const filled = (score / 10) * circumference;
  const color = score >= 7 ? "#22c55e" : score >= 5 ? "#f59e0b" : "#ef4444";
  return (
    <div className="relative w-16 h-16 flex items-center justify-center">
      <svg width="64" height="64" className="-rotate-90">
        <circle cx="32" cy="32" r="20" fill="none" stroke="currentColor" strokeWidth="4" className="text-muted/40" />
        <circle cx="32" cy="32" r="20" fill="none" stroke={color} strokeWidth="4"
          strokeDasharray={`${filled} ${circumference - filled}`} strokeLinecap="round"
          style={{ transition: "stroke-dasharray 1.2s cubic-bezier(0.34,1.56,0.64,1)" }} />
      </svg>
      <span className="absolute font-bold text-lg font-mono" style={{ color }}>{score}</span>
    </div>
  );
}

function ScanResultCard({ result, onTake }: { result: any; onTake?: () => void }) {
  if (!result) return null;
  const platforms = result.platforms || {};
  const estimatedProfit = result.estimatedProfit || {};
  const sellingPoints = result.sellingPoints || [];
  const checkFor = result.checkFor || [];
  const buyAt = result.buyAt || {};
  const bestPlatform = Object.entries(platforms).sort((a: any, b: any) => b[1].score - a[1].score)[0];

  return (
    <div className="space-y-4">
      {/* Header */}
      <Card className="border-primary/30 bg-primary/5">
        <CardContent className="pt-4 pb-4">
          <div className="flex items-center gap-4">
            <ScoreRing score={result.sellScore} />
            <div className="flex-1">
              <h3 className="font-semibold text-base">{result.itemName}</h3>
              {result.brand && result.brand !== "Unknown" && <p className="text-xs text-muted-foreground">{result.brand} · {result.category} · {result.era}</p>}
              <div className="flex items-center gap-3 mt-2">
                <span className={`text-xs font-medium ${result.profitabilityRating === "high" ? "text-emerald-600 dark:text-emerald-400" : result.profitabilityRating === "medium" ? "text-amber-600 dark:text-amber-400" : "text-red-500"}`}>
                  {result.profitabilityRating?.toUpperCase()} profit potential
                </span>
                <span className="text-xs text-muted-foreground">Trend: {result.trendScore}/10</span>
              </div>
            </div>
            <div className="text-right">
              <p className="text-xs text-muted-foreground mb-0.5">Est. profit</p>
              <p className="text-lg font-bold font-mono text-emerald-600 dark:text-emerald-400">${estimatedProfit.low}–${estimatedProfit.high}</p>
            </div>
          </div>
          <div className="mt-3 bg-background/60 rounded-lg p-2.5 text-xs">{result.recommendation}</div>
          {onTake && (
            <Button className="w-full mt-3 gap-2 bg-emerald-600 hover:bg-emerald-700 text-white" onClick={onTake} data-testid="take-item-btn">
              <ShoppingBag size={15} /> Беру эту вещь — добавить в инвентарь
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Buy price guide */}
      <div className="grid grid-cols-2 gap-3">
        <Card className="bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800">
          <CardContent className="pt-3 pb-3 text-center">
            <p className="text-xs text-emerald-700 dark:text-emerald-400 font-medium mb-1">Ideal buy price</p>
            <p className="text-2xl font-bold font-mono text-emerald-600 dark:text-emerald-400">${buyAt.ideal}</p>
          </CardContent>
        </Card>
        <Card className="bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800">
          <CardContent className="pt-3 pb-3 text-center">
            <p className="text-xs text-amber-700 dark:text-amber-400 font-medium mb-1">Max pay</p>
            <p className="text-2xl font-bold font-mono text-amber-600 dark:text-amber-400">${buyAt.max}</p>
          </CardContent>
        </Card>
      </div>

      {/* Platform grid */}
      <div>
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Platform Prices</p>
        <div className="grid grid-cols-2 gap-2">
          {Object.entries(platforms).map(([plat, data]: any) => (
            <Card key={plat} className={plat === bestPlatform?.[0] ? "border-primary/40 bg-primary/5" : ""}>
              <CardContent className="pt-3 pb-3">
                <div className="flex items-center justify-between mb-1.5">
                  <span className={`badge-${plat} text-[10px] font-semibold px-2 py-0.5 rounded-full uppercase`}>{plat}</span>
                  <span className="text-xs font-mono font-semibold">{data.score}/10</span>
                </div>
                <p className="text-base font-bold font-mono">${data.minPrice}–${data.maxPrice}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5 line-clamp-2">{data.reason}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      {/* Raw market data */}
      {result.rawMarketData?.some((m: any) => m.avgPrice > 0) && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <span className="inline-flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                Live Market Data
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-2">
              {result.rawMarketData.filter((m: any) => m.avgPrice > 0).map((m: any) => (
                <div key={m.platform} className="bg-muted/40 rounded-lg p-3">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className={`badge-${m.platform} text-[10px] font-bold px-2 py-0.5 rounded-full uppercase`}>{m.platform}</span>
                    <span className="text-[10px] text-muted-foreground">{m.count} {m.isSoldData ? "sold" : "active"}</span>
                  </div>
                  <p className="text-sm font-bold font-mono">${m.avgPrice} avg</p>
                  <p className="text-[10px] text-muted-foreground">${m.minPrice}–${m.maxPrice} range</p>
                  {m.isSoldData && <p className="text-[10px] text-emerald-600 dark:text-emerald-400 font-medium mt-0.5">✓ Real sold prices</p>}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Selling points & checks */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {sellingPoints.length > 0 && (
          <Card>
            <CardContent className="pt-3 pb-3">
              <p className="text-xs font-semibold mb-2 flex items-center gap-1"><CheckCircle size={12} className="text-emerald-500" /> Selling points</p>
              <ul className="space-y-1">
                {sellingPoints.map((p: string, i: number) => <li key={i} className="text-xs text-muted-foreground flex gap-1.5"><span className="text-emerald-500">·</span>{p}</li>)}
              </ul>
            </CardContent>
          </Card>
        )}
        {checkFor.length > 0 && (
          <Card>
            <CardContent className="pt-3 pb-3">
              <p className="text-xs font-semibold mb-2 flex items-center gap-1"><AlertCircle size={12} className="text-amber-500" /> Check for</p>
              <ul className="space-y-1">
                {checkFor.map((c: string, i: number) => <li key={i} className="text-xs text-muted-foreground flex gap-1.5"><span className="text-amber-500">·</span>{c}</li>)}
              </ul>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

export default function Scanner() {
  const [query, setQuery] = useState("");
  const [size, setSize] = useState("");
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [takeDialog, setTakeDialog] = useState(false);
  const [takeCost, setTakeCost] = useState("");
  const [takePlatform, setTakePlatform] = useState("depop");
  const [crosslistDialog, setCrosslistDialog] = useState(false);
  const [crosslistItem, setCrosslistItem] = useState<any>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [, navigate] = useLocation();
  const { toast } = useToast();

  const { data: history = [] } = useQuery<ScanResult[]>({
    queryKey: ["/api/scan-history"],
    queryFn: () => apiRequest("GET", "/api/scan-history").then(r => r.json()),
  });

  const takeMutation = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/api/listings", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/listings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats/dashboard"] });
      setTakeDialog(false);
      toast({ title: "Добавлено в инвентарь!", description: "Статус: pending. Найди в Listings." });
      setTimeout(() => navigate("/listings"), 1200);
    },
  });

  const handleTake = () => {
    if (!result) return;
    const bestPlatform = Object.entries(result.platforms || {}).sort((a: any, b: any) => b[1].score - a[1].score)[0];
    const bestPrice = bestPlatform ? (result.platforms[bestPlatform[0] as string] as any).maxPrice : 0;
    takeMutation.mutate({
      title: result.itemName || query,
      description: result.recommendation || "—",
      brand: result.brand && result.brand !== "Unknown" ? result.brand : null,
      size: size || null,
      condition: "good",
      category: result.category || null,
      costPrice: Number(takeCost) || 0,
      listedPrice: bestPrice || null,
      platform: takePlatform,
      status: "pending",
      scanData: JSON.stringify(result),
      priceSuggestions: JSON.stringify(
        Object.fromEntries(Object.entries(result.platforms || {}).map(([k, v]: any) => [k, v.maxPrice]))
      ),
    });
  };

  const openCrosslist = (item: any) => {
    setCrosslistItem(item);
    setCrosslistDialog(true);
  };

  const buildCrosslistText = (platform: string, item: any) => {
    if (!item) return "";
    const p = item?.platforms?.[platform];
    const priceStr = p ? `$${p.minPrice}–$${p.maxPrice}` : "";
    const tags = item.hashtags?.join(" ") || "";
    const title = item.itemName || item.title || "";
    const desc = item.recommendation || item.description || "";
    const size2 = item.size || size || "";
    return `${title}${size2 ? ` | Size: ${size2}` : ""}\n\n${desc}\n\nCondition: ${item.condition || "Good"}\nPrice: ${priceStr}\n\n${tags}`.trim();
  };

  const copyForPlatform = (platform: string) => {
    const text = buildCrosslistText(platform, crosslistItem || result);
    navigator.clipboard.writeText(text);
    setCopied(platform);
    setTimeout(() => setCopied(null), 2000);
  };

  const scanText = async () => {
    if (!query.trim()) { toast({ title: "Enter an item name" }); return; }
    setLoading(true);
    setResult(null);
    try {
      const r = await apiRequest("POST", "/api/ai/scan", { query, size });
      const data = await r.json();
      setResult(data);
    } catch (e: any) {
      toast({ title: "Scan failed", description: e.message, variant: "destructive" });
    } finally { setLoading(false); }
  };

  const scanImage = async () => {
    if (!imageFile) return;
    setLoading(true);
    setResult(null);
    try {
      const formData = new FormData();
      formData.append("image", imageFile);
      if (size) formData.append("size", size);
      const r = await fetch("/api/ai/scan-image", { method: "POST", body: formData, headers: getAuthHeaders() });
      const data = await r.json();
      setResult(data);
    } catch (e: any) {
      toast({ title: "Scan failed", description: e.message, variant: "destructive" });
    } finally { setLoading(false); }
  };

  const handleFile = (file: File) => {
    setImageFile(file);
    const url = URL.createObjectURL(file);
    setImagePreview(url);
    setResult(null);
  };

  const PLATFORMS = ["depop", "vinted", "poshmark", "ebay"];

  return (
    <div className="flex flex-col h-full">
      <header className="flex items-center gap-2 sm:gap-3 px-3 sm:px-5 md:px-6 py-3 sm:py-4 border-b border-border sticky top-0 bg-background/95 backdrop-blur z-10">
        <SidebarTrigger />
        <div>
          <h1 className="text-base sm:text-lg font-semibold">Store Scanner</h1>
          <p className="text-[11px] sm:text-xs text-muted-foreground">Check if an item is worth buying at Goodwill</p>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto px-3 sm:px-5 md:px-6 py-4 sm:py-6">
        <div className="max-w-3xl mx-auto space-y-5">
          {/* Input card */}
          <Card>
            <CardContent className="pt-5 pb-4 space-y-4">
              {/* Image upload zone */}
              <div
                className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors ${imagePreview ? "border-primary/40 bg-primary/5" : "border-border hover:border-primary/40 hover:bg-muted/30"}`}
                onClick={() => fileRef.current?.click()}
                onDragOver={e => { e.preventDefault(); }}
                onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
                data-testid="image-drop-zone"
              >
                <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }} data-testid="image-input" />
                {imagePreview ? (
                  <div className="flex flex-col items-center gap-2">
                    <img src={imagePreview} alt="Preview" className="max-h-40 rounded-lg object-contain" />
                    <p className="text-xs text-muted-foreground">Click to change image</p>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-2 text-muted-foreground">
                    <Camera size={28} className="opacity-40" />
                    <p className="text-sm font-medium">Drop a photo here or click to upload</p>
                    <p className="text-xs">Snap a photo at the store — AI will identify and analyze it</p>
                  </div>
                )}
              </div>

              <div className="flex items-center gap-3">
                <div className="h-px flex-1 bg-border" />
                <span className="text-xs text-muted-foreground font-medium">OR type the item name</span>
                <div className="h-px flex-1 bg-border" />
              </div>

              <div className="flex gap-3">
                <div className="flex-1">
                  <Input value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => e.key === "Enter" && scanText()} placeholder="e.g. Levi's 501 jeans, Patagonia fleece, band tee..." data-testid="scan-query-input" />
                </div>
                <Input value={size} onChange={e => setSize(e.target.value)} placeholder="Size (M/L/32)" className="w-32" data-testid="scan-size-input" />
              </div>

              <div className="flex gap-2">
                <Button className="flex-1 gap-2" onClick={imageFile ? scanImage : scanText} disabled={loading} data-testid="scan-btn">
                  <ScanLine size={15} />
                  {loading ? "Analyzing..." : imageFile ? "Analyze Photo" : "Analyze Item"}
                </Button>
                {imageFile && (
                  <Button variant="outline" onClick={() => { setImageFile(null); setImagePreview(null); if (fileRef.current) fileRef.current.value = ""; }}>Clear photo</Button>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Loading state */}
          {loading && (
            <Card>
              <CardContent className="py-6 space-y-3">
                <div className="flex items-center gap-3 mb-4">
                  <Skeleton className="w-16 h-16 rounded-full skeleton" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-3/4 skeleton" />
                    <Skeleton className="h-3 w-1/2 skeleton" />
                  </div>
                </div>
                {Array.from({length: 3}).map((_, i) => <Skeleton key={i} className="h-16 skeleton" />)}
                <p className="text-xs text-muted-foreground text-center">Fetching live prices from eBay, Vinted, Depop, Poshmark...</p>
              </CardContent>
            </Card>
          )}

          {/* Results */}
          {result && !loading && (
            <>
              <ScanResultCard result={result} onTake={() => setTakeDialog(true)} />
              {/* Crosslist export button */}
              <Card className="border-dashed">
                <CardContent className="pt-4 pb-4">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Экспорт в кросслистинг</p>
                  <div className="grid grid-cols-2 gap-2">
                    {["Crosslist", "Vendoo"].map(tool => (
                      <Button key={tool} variant="outline" className="gap-2 text-sm" onClick={() => openCrosslist(result)} data-testid={`crosslist-${tool.toLowerCase()}`}>
                        <ExternalLink size={13} /> {tool}
                      </Button>
                    ))}
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-2 text-center">Копирует готовый текст для каждой площадки</p>
                </CardContent>
              </Card>
            </>
          )}

          {/* Recent scans */}
          {history.length > 0 && !result && !loading && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Recent Scans</p>
              <div className="space-y-2">
                {history.slice(0, 5).map((h: ScanResult) => {
                  let analysis: any = {};
                  try { analysis = JSON.parse(h.analysis || "{}"); } catch {}
                  if (!analysis || typeof analysis !== "object") analysis = {};
                  return (
                    <Card key={h.id} className="cursor-pointer hover:shadow-sm transition-shadow" onClick={() => setResult(analysis)} data-testid={`history-item-${h.id}`}>
                      <CardContent className="py-2.5 px-4">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-sm font-medium">{analysis.itemName || h.query}</p>
                            <p className="text-xs text-muted-foreground">{new Date(h.createdAt).toLocaleDateString()}</p>
                          </div>
                          <div className="flex items-center gap-3">
                            <span className={`text-sm font-bold font-mono ${analysis.sellScore >= 7 ? "text-emerald-600 dark:text-emerald-400" : analysis.sellScore >= 5 ? "text-amber-600 dark:text-amber-400" : "text-red-500"}`}>{analysis.sellScore}/10</span>
                            <span className="text-xs text-muted-foreground">Est. ${analysis.estimatedProfit?.low}–${analysis.estimatedProfit?.high}</span>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </main>

      {/* "Взять вещь" Dialog */}
      <Dialog open={takeDialog} onOpenChange={setTakeDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShoppingBag size={16} className="text-emerald-500" />
              Беру эту вещь
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-1">
            <div className="bg-muted/40 rounded-lg p-3">
              <p className="text-sm font-medium">{result?.itemName}</p>
              <p className="text-xs text-muted-foreground mt-0.5">Est. profit: ${result?.estimatedProfit?.low}–${result?.estimatedProfit?.high}</p>
            </div>
            <div>
              <Label className="text-xs mb-1.5 block">Сколько заплатишь в магазине ($)</Label>
              <Input type="number" value={takeCost} onChange={e => setTakeCost(e.target.value)} placeholder="напр. 8" autoFocus data-testid="take-cost-input" />
            </div>
            <div>
              <Label className="text-xs mb-1.5 block">Где будешь продавать в первую очередь</Label>
              <Select value={takePlatform} onValueChange={setTakePlatform}>
                <SelectTrigger data-testid="take-platform-select"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["depop","vinted","poshmark","ebay"].map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTakeDialog(false)}>Cancel</Button>
            <Button className="gap-2 bg-emerald-600 hover:bg-emerald-700 text-white" onClick={handleTake} disabled={takeMutation.isPending} data-testid="confirm-take-btn">
              {takeMutation.isPending ? "Добавляю..." : "Подтвердить"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Crosslist / Vendoo Export Dialog */}
      <Dialog open={crosslistDialog} onOpenChange={setCrosslistDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ExternalLink size={15} className="text-primary" />
              Экспорт для кросслистинга
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 max-h-[60vh] overflow-y-auto">
            <p className="text-xs text-muted-foreground">Copy text for each platform, then paste it in Crosslist or Vendoo.</p>
            {PLATFORMS.map(plat => {
              const p = (crosslistItem || result)?.platforms?.[plat];
              return (
                <div key={plat} className="bg-muted/40 rounded-lg p-3">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className={`badge-${plat} text-[10px] font-bold px-2 py-0.5 rounded-full uppercase`}>{plat}</span>
                      {p && <span className="text-xs font-mono font-semibold">${p.minPrice}–${p.maxPrice}</span>}
                    </div>
                    <Button variant="ghost" size="sm" className="h-7 px-2 gap-1" onClick={() => copyForPlatform(plat)} data-testid={`copy-platform-${plat}`}>
                      {copied === plat ? <CheckCheck size={13} className="text-emerald-500" /> : <Copy size={13} />}
                      <span className="text-xs">{copied === plat ? "Copied!" : "Copy"}</span>
                    </Button>
                  </div>
                  <pre className="text-[10px] text-muted-foreground whitespace-pre-wrap line-clamp-3">{buildCrosslistText(plat, crosslistItem || result)}</pre>
                </div>
              );
            })}
            <div className="border-t border-border pt-3">
              <p className="text-xs font-semibold mb-2">Open directly:</p>
              <div className="flex gap-2">
                <a href="https://crosslist.com" target="_blank" rel="noopener noreferrer">
                  <Button variant="outline" size="sm" className="gap-1.5 text-xs">
                    <ExternalLink size={11} /> Crosslist
                  </Button>
                </a>
                <a href="https://vendoo.co" target="_blank" rel="noopener noreferrer">
                  <Button variant="outline" size="sm" className="gap-1.5 text-xs">
                    <ExternalLink size={11} /> Vendoo
                  </Button>
                </a>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setCrosslistDialog(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
