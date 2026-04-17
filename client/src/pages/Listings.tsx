import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Plus, Trash2, CheckCircle, Sparkles, ExternalLink, Copy, CheckCheck,
  Tag, Package, Pencil, QrCode, Download, MoreHorizontal, ImagePlus, Loader2, RefreshCw,
  Eye, Heart, Users, BarChart2, TrendingUp, AlertTriangle
} from "lucide-react";
import { useState, useEffect } from "react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Listing } from "@shared/schema";

const PLATFORMS = ["all", "depop", "vinted", "ebay"];
const STATUSES = ["all", "pending", "active", "sold", "draft"];

const PLATFORM_DOT: Record<string, string> = {
  depop: "#ff4e4e", vinted: "#09b1ba", ebay: "#e43c24",
};

export default function Listings() {
  const [platform, setPlatform] = useState("all");
  const [status, setStatus] = useState("all");
  const [, navigate] = useLocation();
  const [markSoldId, setMarkSoldId] = useState<number | null>(null);
  const [soldPrice, setSoldPrice] = useState("");
  const [suggestId, setSuggestId] = useState<number | null>(null);
  const [suggestions, setSuggestions] = useState<any>(null);
  const [suggestLoading, setSuggestLoading] = useState(false);
  const [adviceId, setAdviceId] = useState<number | null>(null);
  const [advice, setAdvice] = useState<any>(null);
  const [adviceLoading, setAdviceLoading] = useState(false);
  const [manualStatsId, setManualStatsId] = useState<number | null>(null);
  const [manualPlatform, setManualPlatform] = useState<"depop" | "vinted" | "ebay">("depop");
  const [manualViews, setManualViews] = useState("");
  const [manualLikes, setManualLikes] = useState("");
  const [manualSubmitting, setManualSubmitting] = useState(false);
  const [crosslistListing, setCrosslistListing] = useState<Listing | null>(null);
  const [copiedPlat, setCopiedPlat] = useState<string | null>(null);
  const [qrData, setQrData] = useState<{ bagNumber: number; qrDataUrl: string; label: string } | null>(null);
  const [qrLoading, setQrLoading] = useState(false);
  const [photoFetchId, setPhotoFetchId] = useState<number | null>(null);
  const [fetchUrl, setFetchUrl] = useState("");
  const [photoFetching, setPhotoFetching] = useState(false);
  const [photoMode, setPhotoMode] = useState<"url" | "direct">("direct");
  const [extensionInstalled, setExtensionInstalled] = useState(false);
  const [syncingAll, setSyncingAll] = useState(false);
  const [lastAutoSync, setLastAutoSync] = useState<string | null>(null);
  const { toast } = useToast();

  // Detect extension and get last sync status
  useEffect(() => {
    const handleReady = () => setExtensionInstalled(true);
    const handleStatus = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.reflip_last_sync) setLastAutoSync(detail.reflip_last_sync);
    };
    window.addEventListener("reflip:extension-ready", handleReady);
    window.addEventListener("reflip:status-response", handleStatus);
    // Request status from extension
    window.dispatchEvent(new CustomEvent("reflip:status-request"));
    return () => {
      window.removeEventListener("reflip:extension-ready", handleReady);
      window.removeEventListener("reflip:status-response", handleStatus);
    };
  }, []);

  const fetchPhotos = async () => {
    if (!photoFetchId || !fetchUrl.trim()) return;
    setPhotoFetching(true);
    try {
      if (photoMode === "direct") {
        // Direct image URLs — split by newlines, filter valid URLs
        const urls = fetchUrl.split(/[\n,]+/).map(u => u.trim()).filter(u => u.startsWith("http"));
        if (urls.length === 0) throw new Error("No valid image URLs found. Each URL must start with http");
        const r = await apiRequest("POST", `/api/listings/${photoFetchId}/save-image-urls`, { urls });
        const data = await r.json();
        if (data.error) throw new Error(data.error);
        queryClient.invalidateQueries({ queryKey: ["/api/listings"] });
        toast({ title: `${data.images.length} photo(s) saved!` });
      } else {
        const r = await apiRequest("POST", `/api/listings/${photoFetchId}/fetch-photos`, { url: fetchUrl });
        const data = await r.json();
        if (data.error) throw new Error(data.error);
        queryClient.invalidateQueries({ queryKey: ["/api/listings"] });
        toast({ title: `${data.images.length} photo(s) loaded!` });
      }
      setPhotoFetchId(null);
      setFetchUrl("");
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally { setPhotoFetching(false); }
  };

  const syncAllViaExtension = () => {
    if (!extensionInstalled) return;
    setSyncingAll(true);
    const handleDone = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      setSyncingAll(false);
      window.removeEventListener("reflip:sync-done", handleDone);
      if (detail?.error) {
        toast({ title: "Sync error", description: detail.error, variant: "destructive" });
      } else {
        const updated = detail?.updated ?? 0;
        const checked = detail?.checked ?? 0;
        toast({ title: `Sync done`, description: `${updated} of ${checked} listings updated.` });
        queryClient.invalidateQueries({ queryKey: ["/api/listings"] });
        if (detail?.timestamp) setLastAutoSync(detail.timestamp);
      }
    };
    window.addEventListener("reflip:sync-done", handleDone);
    window.dispatchEvent(new CustomEvent("reflip:sync-request"));
    // Timeout fallback
    setTimeout(() => { setSyncingAll(false); window.removeEventListener("reflip:sync-done", handleDone); }, 60000);
  };

  const openQR = async (bagNumber: number) => {
    setQrLoading(true);
    setQrData(null);
    try {
      const r = await apiRequest("GET", `/api/bags/${bagNumber}/qr`);
      const data = await r.json();
      setQrData(data);
    } catch { toast({ title: "Could not load QR", variant: "destructive" }); }
    finally { setQrLoading(false); }
  };

  const downloadQR = () => {
    if (!qrData) return;
    const a = document.createElement("a");
    a.href = qrData.qrDataUrl;
    a.download = `bag-${qrData.bagNumber}.png`;
    a.click();
  };

  const activateMutation = useMutation({
    mutationFn: (id: number) => apiRequest("PATCH", `/api/listings/${id}`, { status: "active" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/listings"] });
      toast({ title: "Listed!" });
    },
  });

  const buildExportText = (listing: Listing, plat: string) => {
    const prices = listing.priceSuggestions ? JSON.parse(listing.priceSuggestions) : {};
    const scanData = listing.scanData ? JSON.parse(listing.scanData) : null;
    const platData = scanData?.platforms?.[plat];
    const price = prices[plat] || listing.listedPrice || "";
    const priceStr = platData ? `$${platData.minPrice}–$${platData.maxPrice}` : price ? `$${price}` : "";
    return `${listing.title}${listing.size ? ` | Size: ${listing.size}` : ""}\n\n${listing.description}\n\nCondition: ${listing.condition}\nPrice: ${priceStr}`.trim();
  };

  const copyExport = (plat: string) => {
    if (!crosslistListing) return;
    navigator.clipboard.writeText(buildExportText(crosslistListing, plat));
    setCopiedPlat(plat);
    setTimeout(() => setCopiedPlat(null), 2000);
  };

  const { data: listings = [], isLoading } = useQuery<Listing[]>({
    queryKey: ["/api/listings", status, platform],
    queryFn: () => {
      const params = new URLSearchParams();
      if (status !== "all") params.set("status", status);
      if (platform !== "all") params.set("platform", platform);
      return apiRequest("GET", `/api/listings?${params}`).then(r => r.json());
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/listings/${id}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/listings"] }); toast({ title: "Deleted" }); },
  });

  const markSoldMutation = useMutation({
    mutationFn: ({ id, price }: { id: number; price: number }) =>
      apiRequest("PATCH", `/api/listings/${id}`, { status: "sold", soldPrice: price, soldAt: new Date().toISOString().split("T")[0] }),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/listings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats/dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["/api/bags"] });
      const listing = listings.find((l: any) => l.id === id);
      const bagNum = (listing as any)?.bagNumber;
      setMarkSoldId(null);
      setSoldPrice("");
      toast({
        title: bagNum ? `✅ Sold! Grab Bag #${bagNum}` : "✅ Marked as sold!",
        description: bagNum ? `Show QR for Bag #${bagNum} at USPS` : "Stats updated.",
      });
    },
  });

  const getAISuggestions = async (id: number) => {
    setSuggestId(id);
    setSuggestLoading(true);
    setSuggestions(null);
    try {
      const r = await apiRequest("POST", "/api/ai/suggest", { listingId: id });
      setSuggestions(await r.json());
    } catch {
      toast({ title: "Error", description: "Could not get AI suggestions", variant: "destructive" });
    } finally { setSuggestLoading(false); }
  };

  const getAIAdvice = async (id: number) => {
    setAdviceId(id);
    setAdviceLoading(true);
    setAdvice(null);
    try {
      const r = await apiRequest("POST", "/api/ai/listing-advice", { listingId: id });
      setAdvice(await r.json());
    } catch (e: any) {
      toast({ title: "Error", description: e.message || "Could not get AI advice", variant: "destructive" });
    } finally { setAdviceLoading(false); }
  };

  const openManualStats = (id: number) => {
    const l = listings.find((x: any) => x.id === id) as any;
    const defaultPlat: "depop" | "vinted" | "ebay" =
      l?.depopUrl ? "depop" : l?.vintedUrl ? "vinted" : l?.ebayUrl ? "ebay" : (l?.platform || "depop");
    setManualStatsId(id);
    setManualPlatform(defaultPlat);
    setManualViews("");
    setManualLikes("");
  };

  const submitManualStats = async () => {
    if (!manualStatsId) return;
    const body: any = { platform: manualPlatform };
    if (manualViews.trim()) body.views = Number(manualViews);
    if (manualLikes.trim()) {
      if (manualPlatform === "depop") body.likes = Number(manualLikes);
      else if (manualPlatform === "vinted") body.favorites = Number(manualLikes);
      else body.watchers = Number(manualLikes);
    }
    if (!body.views && !body.likes && !body.favorites && !body.watchers) {
      toast({ title: "Enter at least one number", variant: "destructive" });
      return;
    }
    setManualSubmitting(true);
    try {
      await apiRequest("POST", `/api/listings/${manualStatsId}/engagement`, body);
      queryClient.invalidateQueries({ queryKey: ["/api/listings"] });
      toast({ title: "Stats saved", description: "AI can now use these numbers." });
      setManualStatsId(null);
    } catch (e: any) {
      toast({ title: "Error", description: e.message || "Save failed", variant: "destructive" });
    } finally { setManualSubmitting(false); }
  };

  return (
    <div className="flex flex-col h-full">
      <header className="flex items-center justify-between gap-2 px-3 sm:px-5 md:px-6 py-3 sm:py-4 border-b border-border sticky top-0 bg-background/95 backdrop-blur z-10">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <SidebarTrigger />
          <div className="min-w-0">
            <h1 className="text-base sm:text-lg font-semibold truncate">Listings</h1>
            <p className="text-[11px] sm:text-xs text-muted-foreground">{listings.length} items</p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {/* Live sync button — uses extension bridge */}
          {extensionInstalled ? (
            <Button
              size="sm"
              variant="outline"
              onClick={syncAllViaExtension}
              disabled={syncingAll}
              className="rounded-xl gap-1.5 text-xs h-8 border-emerald-500/30 text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/20"
              title={lastAutoSync ? `Last sync: ${new Date(lastAutoSync).toLocaleTimeString()}` : "Auto-syncs every 30 min"}
            >
              <RefreshCw size={12} className={syncingAll ? "animate-spin" : ""} />
              <span className="hidden sm:inline">{syncingAll ? "Syncing..." : "Sync All"}</span>
            </Button>
          ) : (
            <span className="text-[10px] text-muted-foreground/60 hidden sm:inline" title="Install the ReFlip extension for auto price sync">
              Extension for auto-sync
            </span>
          )}
          <Button size="sm" asChild className="rounded-xl gap-1.5">
            <Link href="/listings/new"><Plus size={14} /> New</Link>
          </Button>
        </div>
      </header>

      {/* Filter bar — scrollable on mobile */}
      <div className="px-3 sm:px-5 md:px-6 py-2.5 sm:py-3 border-b border-border/60 overflow-x-auto scrollbar-none">
        <div className="flex gap-1.5 sm:gap-2 min-w-max">
          {/* Status filters */}
          <div className="flex gap-1 items-center">
            {STATUSES.map(s => (
              <button key={s} onClick={() => setStatus(s)}
                className={`text-xs px-3 py-1.5 rounded-full font-medium transition-all whitespace-nowrap ${
                  status === s
                    ? "bg-foreground text-background"
                    : "bg-muted text-muted-foreground hover:text-foreground"
                }`}>
                {s.charAt(0).toUpperCase() + s.slice(1)}
              </button>
            ))}
          </div>

          {/* Divider */}
          <div className="w-px bg-border/60 mx-1" />

          {/* Platform filters */}
          <div className="flex gap-1 items-center">
            {PLATFORMS.map(p => (
              <button key={p} onClick={() => setPlatform(p)}
                className={`text-xs px-3 py-1.5 rounded-full font-medium transition-all whitespace-nowrap flex items-center gap-1.5 ${
                  platform === p
                    ? "bg-foreground text-background"
                    : "bg-muted text-muted-foreground hover:text-foreground"
                }`}>
                {p !== "all" && (
                  <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: PLATFORM_DOT[p] }} />
                )}
                {p.charAt(0).toUpperCase() + p.slice(1)}
              </button>
            ))}
          </div>
        </div>
      </div>

      <main className="flex-1 overflow-y-auto px-3 sm:px-5 md:px-6 py-3 sm:py-4">
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-16 w-full skeleton rounded-2xl" />)}
          </div>
        ) : listings.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-16 h-16 rounded-3xl flex items-center justify-center mb-4 float"
              style={{ background: "linear-gradient(135deg, hsl(250 80% 65% / 0.2), hsl(195 80% 60% / 0.2))" }}>
              <Package size={28} className="text-muted-foreground/50" />
            </div>
            <p className="font-medium text-sm mb-1">No listings yet</p>
            <p className="text-xs text-muted-foreground mb-5">Add your first item to get started</p>
            <Button size="sm" asChild className="gap-1.5 rounded-xl">
              <Link href="/listings/new"><Plus size={13} /> Add first item</Link>
            </Button>
          </div>
        ) : (
          <div className="space-y-2">
            {listings.map((listing: Listing) => (
              <ListingRow
                key={listing.id}
                listing={listing}
                onMarkSold={() => setMarkSoldId(listing.id)}
                onActivate={() => activateMutation.mutate(listing.id)}
                onEdit={() => navigate(`/listings/${listing.id}/edit`)}
                onDelete={() => deleteMutation.mutate(listing.id)}
                onAI={() => getAISuggestions(listing.id)}
                onAdvice={() => getAIAdvice(listing.id)}
                onManualStats={() => openManualStats(listing.id)}
                onExport={() => setCrosslistListing(listing)}
                onQR={() => openQR((listing as any).bagNumber)}
                onFetchPhotos={() => { setPhotoFetchId(listing.id); setFetchUrl(""); }}
              />
            ))}
          </div>
        )}
      </main>

      {/* ── MARK SOLD DIALOG ── */}
      <Dialog open={markSoldId !== null} onOpenChange={() => { setMarkSoldId(null); setSoldPrice(""); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle size={16} className="text-emerald-500" />
              Mark as Sold
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {markSoldId && (() => {
              const l = listings.find((x: any) => x.id === markSoldId);
              const platFee = l?.platform === "vinted" ? 0 : 0.13;
              const estNet = l?.listedPrice ? (l.listedPrice * (1 - platFee)).toFixed(0) : null;
              return l ? (
                <div className="bg-muted/40 rounded-xl p-3 space-y-1">
                  <p className="text-sm font-semibold">{l.title}</p>
                  <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                    <span>Listed: <span className="font-mono text-foreground">${l.listedPrice}</span></span>
                    <span>Cost: <span className="font-mono text-foreground">${l.costPrice}</span></span>
                    {estNet && <span>Est. net: <span className="font-mono text-emerald-500">${estNet}</span></span>}
                  </div>
                </div>
              ) : null;
            })()}

            <div className="space-y-1.5">
              <Label className="text-sm font-medium">How much did you receive? ($)</Label>
              <p className="text-xs text-muted-foreground">Enter what you actually received after all platform fees.</p>
              <Input
                type="number"
                value={soldPrice}
                onChange={e => setSoldPrice(e.target.value)}
                placeholder="e.g. 39"
                autoFocus
                className="rounded-xl font-mono text-base h-11"
              />
            </div>

            {soldPrice && markSoldId && (() => {
              const l = listings.find((x: any) => x.id === markSoldId);
              const net = Number(soldPrice);
              const profit = l ? net - l.costPrice : null;
              const roi = l && l.costPrice > 0 ? ((profit! / l.costPrice) * 100).toFixed(0) : null;
              return profit !== null ? (
                <div className={`rounded-xl p-3 text-center ${profit >= 0 ? "bg-emerald-50 dark:bg-emerald-900/20" : "bg-red-50 dark:bg-red-900/20"}`}>
                  <p className={`text-xl font-bold font-mono ${profit >= 0 ? "text-emerald-500" : "text-red-400"}`}>
                    {profit >= 0 ? "+" : ""}{profit.toFixed(0)} profit
                  </p>
                  {roi && <p className="text-xs text-muted-foreground mt-0.5">{roi}% ROI</p>}
                </div>
              ) : null;
            })()}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setMarkSoldId(null); setSoldPrice(""); }}>Cancel</Button>
            <Button
              onClick={() => markSoldMutation.mutate({ id: markSoldId!, price: Number(soldPrice) })}
              disabled={!soldPrice || markSoldMutation.isPending}
              style={{ background: "linear-gradient(135deg, hsl(150 65% 40%), hsl(195 80% 45%))" }}
            >
              <CheckCircle size={13} className="mr-1.5" />
              {markSoldMutation.isPending ? "Saving..." : "Confirm Sale"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── AI SUGGESTIONS DIALOG ── */}
      <Dialog open={suggestId !== null} onOpenChange={() => { setSuggestId(null); setSuggestions(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><Sparkles size={16} className="text-amber-500" /> AI Suggestions</DialogTitle></DialogHeader>
          {suggestLoading ? (
            <div className="space-y-3 py-2">
              {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12 skeleton" />)}
              <p className="text-xs text-muted-foreground text-center">Analyzing your listing...</p>
            </div>
          ) : suggestions ? (
            <div className="space-y-3">
              {(suggestions.suggestions || []).map((s: any, i: number) => (
                <div key={i} className="bg-muted/50 rounded-lg p-3 text-sm">
                  <span className="badge-active text-[10px] font-semibold px-2 py-0.5 rounded-full uppercase mb-2 inline-block">{s.type}</span>
                  <p className="text-muted-foreground text-xs mb-1">{s.issue}</p>
                  <p className="font-medium text-xs">{s.fix}</p>
                </div>
              ))}
              {suggestions.newTitle && (
                <div className="bg-amber-50 dark:bg-amber-900/20 rounded-lg p-3 text-sm border border-amber-200 dark:border-amber-800">
                  <p className="text-xs font-semibold text-amber-700 dark:text-amber-400 mb-1">Suggested title:</p>
                  <p className="text-xs">{suggestions.newTitle}</p>
                </div>
              )}
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => { setSuggestId(null); setSuggestions(null); }}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── QR CODE DIALOG ── */}
      <Dialog open={!!qrData || qrLoading} onOpenChange={() => setQrData(null)}>
        <DialogContent className="max-w-xs">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <QrCode size={15} className="text-emerald-500" />
              {qrData ? `Bag #${qrData.bagNumber} — USPS QR` : "Loading QR..."}
            </DialogTitle>
          </DialogHeader>
          <div className="flex flex-col items-center gap-4">
            {qrLoading && <Skeleton className="w-48 h-48 rounded-2xl skeleton" />}
            {qrData && (
              <>
                <div className="p-3 bg-white rounded-2xl shadow-md">
                  <img src={qrData.qrDataUrl} alt="Bag QR" className="w-44 h-44" />
                </div>
                <p className="text-xs text-muted-foreground text-center">
                  Show this at USPS → they scan → label prints automatically
                </p>
                <Button onClick={downloadQR} className="w-full gap-2 rounded-xl" size="sm">
                  <Download size={13} /> Save to phone
                </Button>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* ── CROSSLIST EXPORT DIALOG ── */}
      <Dialog open={!!crosslistListing} onOpenChange={() => { setCrosslistListing(null); setCopiedPlat(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ExternalLink size={15} className="text-primary" />
              Export to Crosslist / Vendoo
            </DialogTitle>
          </DialogHeader>
          {crosslistListing && (
            <div className="space-y-3 max-h-[60vh] overflow-y-auto">
              <div className="bg-muted/40 rounded-lg p-3">
                <p className="text-sm font-semibold">{crosslistListing.title}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{crosslistListing.brand} · Size: {crosslistListing.size} · {crosslistListing.condition}</p>
              </div>
              <p className="text-xs text-muted-foreground">Copy text for each platform, then paste into Crosslist or Vendoo.</p>
              {["depop", "vinted", "ebay"].map(plat => {
                const prices = crosslistListing.priceSuggestions ? JSON.parse(crosslistListing.priceSuggestions) : {};
                const price = prices[plat];
                return (
                  <div key={plat} className="bg-muted/40 rounded-lg p-3">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className={`badge-${plat} text-[10px] font-bold px-2 py-0.5 rounded-full uppercase`}>{plat}</span>
                        {price && <span className="text-xs font-mono font-semibold">${price}</span>}
                      </div>
                      <Button variant="ghost" size="sm" className="h-7 px-2 gap-1" onClick={() => copyExport(plat)}>
                        {copiedPlat === plat ? <CheckCheck size={13} className="text-emerald-500" /> : <Copy size={13} />}
                        <span className="text-xs">{copiedPlat === plat ? "Copied!" : "Copy"}</span>
                      </Button>
                    </div>
                    <pre className="text-[10px] text-muted-foreground whitespace-pre-wrap line-clamp-3">{buildExportText(crosslistListing, plat)}</pre>
                  </div>
                );
              })}
              <div className="border-t border-border pt-3 flex gap-2">
                <a href="https://crosslist.com" target="_blank" rel="noopener noreferrer">
                  <Button variant="outline" size="sm" className="gap-1.5 text-xs"><ExternalLink size={11} /> Crosslist</Button>
                </a>
                <a href="https://vendoo.co" target="_blank" rel="noopener noreferrer">
                  <Button variant="outline" size="sm" className="gap-1.5 text-xs"><ExternalLink size={11} /> Vendoo</Button>
                </a>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => { setCrosslistListing(null); setCopiedPlat(null); }}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── AI LISTING ADVICE DIALOG (uses live engagement stats) ── */}
      <Dialog open={adviceId !== null} onOpenChange={() => { setAdviceId(null); setAdvice(null); }}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <BarChart2 size={16} className="text-primary" /> AI Advice
              <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-primary/10 text-primary uppercase tracking-wider">Live stats</span>
            </DialogTitle>
          </DialogHeader>
          {adviceLoading ? (
            <div className="space-y-3 py-2">
              {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16 skeleton" />)}
              <p className="text-xs text-muted-foreground text-center">Analyzing real performance data…</p>
            </div>
          ) : advice ? (
            <div className="space-y-3">
              {/* Score + summary */}
              <div className="bg-muted/40 rounded-xl p-3">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Performance</span>
                  <div className="flex items-center gap-2">
                    {typeof advice.score === "number" && (
                      <span className="text-2xl font-bold font-mono">{advice.score}<span className="text-sm text-muted-foreground">/10</span></span>
                    )}
                    {advice.scoreLabel && (
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-primary/10 text-primary">{advice.scoreLabel}</span>
                    )}
                  </div>
                </div>
                {advice.performanceSummary && (
                  <p className="text-xs text-foreground/80 leading-relaxed">{advice.performanceSummary}</p>
                )}
              </div>

              {/* Top action */}
              {advice.topAction && (
                <div className="rounded-xl p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-300/50">
                  <div className="flex items-start gap-2">
                    <TrendingUp size={14} className="text-amber-600 mt-0.5 shrink-0" />
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-wider text-amber-700 dark:text-amber-400 mb-0.5">Do this now</p>
                      <p className="text-xs font-medium">{advice.topAction}</p>
                    </div>
                  </div>
                </div>
              )}

              {/* Price recommendation */}
              {advice.priceRecommendation && (
                <div className="rounded-xl p-3 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-300/40">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400 mb-1">Price recommendation</p>
                  <p className="text-sm font-mono">
                    ${advice.priceRecommendation.current} → <span className="font-bold">${advice.priceRecommendation.suggested}</span>
                  </p>
                  {advice.priceRecommendation.reason && (
                    <p className="text-[11px] text-muted-foreground mt-1">{advice.priceRecommendation.reason}</p>
                  )}
                </div>
              )}

              {/* Advice list */}
              {(advice.advice || []).map((a: any, i: number) => {
                const priorityColor =
                  a.priority === "high" ? "border-red-400/60 bg-red-50/60 dark:bg-red-900/10"
                    : a.priority === "medium" ? "border-amber-400/50 bg-amber-50/40 dark:bg-amber-900/10"
                      : "border-border/50 bg-muted/30";
                return (
                  <div key={i} className={`rounded-xl p-3 border ${priorityColor}`}>
                    <div className="flex items-center gap-2 mb-1.5">
                      {a.priority === "high" && <AlertTriangle size={12} className="text-red-500" />}
                      <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-background/60">{a.type}</span>
                      <span className="text-[9px] font-bold uppercase text-muted-foreground">{a.priority}</span>
                      {a.timeToAct && <span className="text-[9px] text-muted-foreground ml-auto">{a.timeToAct.replace("_", " ")}</span>}
                    </div>
                    {a.issue && <p className="text-xs text-muted-foreground mb-1">{a.issue}</p>}
                    {a.action && <p className="text-xs font-medium">{a.action}</p>}
                  </div>
                );
              })}
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => { setAdviceId(null); setAdvice(null); }}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── MANUAL STATS ENTRY DIALOG ── */}
      <Dialog open={manualStatsId !== null} onOpenChange={() => setManualStatsId(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Eye size={15} className="text-primary" /> Enter listing stats
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Check your seller dashboard on the platform and type in the numbers. The AI will use them to give better advice.
            </p>
            {/* Platform toggle */}
            <div className="flex gap-1 bg-muted rounded-lg p-1">
              {(["depop", "vinted", "ebay"] as const).map(p => (
                <button key={p} onClick={() => setManualPlatform(p)}
                  className={`flex-1 text-xs py-1.5 rounded-md font-semibold capitalize transition-all ${manualPlatform === p ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"}`}>
                  {p}
                </button>
              ))}
            </div>
            <div className="space-y-2">
              <div>
                <Label className="text-xs">Views</Label>
                <Input type="number" inputMode="numeric" value={manualViews} onChange={e => setManualViews(e.target.value)} placeholder="e.g. 245" className="rounded-lg font-mono h-9 text-sm" />
              </div>
              <div>
                <Label className="text-xs">
                  {manualPlatform === "depop" ? "Likes" : manualPlatform === "vinted" ? "Favorites" : "Watchers"}
                </Label>
                <Input type="number" inputMode="numeric" value={manualLikes} onChange={e => setManualLikes(e.target.value)} placeholder="e.g. 3" className="rounded-lg font-mono h-9 text-sm" />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setManualStatsId(null)}>Cancel</Button>
            <Button size="sm" onClick={submitManualStats} disabled={manualSubmitting} className="gap-1.5">
              {manualSubmitting ? <><Loader2 size={12} className="animate-spin" /> Saving...</> : <>Save stats</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── ADD PHOTOS DIALOG ── */}
      <Dialog open={photoFetchId !== null} onOpenChange={() => { setPhotoFetchId(null); setFetchUrl(""); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ImagePlus size={16} className="text-secondary" />
              Add Photos
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {/* Mode toggle */}
            <div className="flex gap-1 bg-muted rounded-lg p-1">
              <button
                onClick={() => { setPhotoMode("direct"); setFetchUrl(""); }}
                className={`flex-1 text-xs py-1.5 rounded-md font-medium transition-all ${
                  photoMode === "direct" ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Paste Image URLs
              </button>
              <button
                onClick={() => { setPhotoMode("url"); setFetchUrl(""); }}
                className={`flex-1 text-xs py-1.5 rounded-md font-medium transition-all ${
                  photoMode === "url" ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                From Listing URL
              </button>
            </div>

            {photoMode === "direct" ? (
              <>
                <p className="text-xs text-muted-foreground">
                  Right-click photos on Depop/Vinted → "Copy Image Address" and paste here. One URL per line.
                </p>
                <textarea
                  value={fetchUrl}
                  onChange={e => setFetchUrl(e.target.value)}
                  placeholder={"https://media-photos.depop.com/...\nhttps://di2ponv0v5otw.cloudfront.net/..."}
                  className="w-full rounded-xl text-sm p-3 bg-background border border-input min-h-[80px] resize-none focus:outline-none focus:ring-2 focus:ring-ring"
                  autoFocus
                />
              </>
            ) : (
              <>
                <p className="text-xs text-muted-foreground">
                  Auto-fetch from a listing page. May not work if the platform blocks server requests.
                </p>
                <Input
                  value={fetchUrl}
                  onChange={e => setFetchUrl(e.target.value)}
                  placeholder="https://depop.com/products/... or https://www.vinted.com/items/..."
                  className="rounded-xl text-sm"
                  autoFocus
                />
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setPhotoFetchId(null); setFetchUrl(""); }}>Cancel</Button>
            <Button
              onClick={fetchPhotos}
              disabled={!fetchUrl.trim() || photoFetching}
              style={{ background: "#09b1ba" }}
              className="gap-1.5 text-white"
            >
              {photoFetching ? <><Loader2 size={13} className="animate-spin" /> Saving...</> : <><ImagePlus size={13} /> {photoMode === "direct" ? "Save Photos" : "Fetch Photos"}</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}

// ── Engagement metric badges (shown inline on each listing row) ──
function EngagementBadges({ listing }: { listing: Listing }) {
  const l: any = listing;
  const hasAny =
    l.depopViews != null || l.depopLikes != null ||
    l.vintedViews != null || l.vintedFavorites != null ||
    l.ebayViews != null || l.ebayWatchers != null;
  if (!hasAny) return null;

  const badge = (color: string, children: React.ReactNode) => (
    <span className="inline-flex items-center gap-1 text-[10px] sm:text-xs font-mono px-1.5 py-0.5 rounded-md bg-muted/60 border border-border/40" style={{ color }}>
      {children}
    </span>
  );
  return (
    <>
      {(l.depopViews != null || l.depopLikes != null) && badge(PLATFORM_DOT.depop,
        <>
          {l.depopViews != null && (<><Eye size={10} /> {l.depopViews}</>)}
          {l.depopLikes != null && (<> <Heart size={10} className="ml-0.5" /> {l.depopLikes}</>)}
        </>)}
      {(l.vintedViews != null || l.vintedFavorites != null) && badge(PLATFORM_DOT.vinted,
        <>
          {l.vintedViews != null && (<><Eye size={10} /> {l.vintedViews}</>)}
          {l.vintedFavorites != null && (<> <Heart size={10} className="ml-0.5" /> {l.vintedFavorites}</>)}
        </>)}
      {(l.ebayViews != null || l.ebayWatchers != null) && badge(PLATFORM_DOT.ebay,
        <>
          {l.ebayViews != null && (<><Eye size={10} /> {l.ebayViews}</>)}
          {l.ebayWatchers != null && (<> <Users size={10} className="ml-0.5" /> {l.ebayWatchers}</>)}
        </>)}
    </>
  );
}

// Helper: parse imageUrl field — supports JSON array or single URL
function getListingImages(listing: Listing): string[] {
  if (!listing.imageUrl) return [];
  try {
    const parsed = JSON.parse(listing.imageUrl);
    if (Array.isArray(parsed)) return parsed;
  } catch {}
  return [listing.imageUrl];
}

// ── Listing Row — responsive action buttons ──
interface RowProps {
  listing: Listing;
  onMarkSold: () => void;
  onActivate: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onAI: () => void;
  onAdvice: () => void;
  onManualStats: () => void;
  onExport: () => void;
  onQR: () => void;
  onFetchPhotos: () => void;
}

function ListingRow({ listing, onMarkSold, onActivate, onEdit, onDelete, onAI, onAdvice, onManualStats, onExport, onQR, onFetchPhotos }: RowProps) {
  const status = listing.status;
  const bagNum = (listing as any).bagNumber;
  const images = getListingImages(listing);
  const thumb = images[0];

  return (
    <div className="glass-card rounded-xl sm:rounded-2xl p-3 sm:p-4 hover:shadow-lg transition-all duration-300 border border-border/50">
      <div className="flex flex-row gap-3 sm:gap-4">
        {/* Thumbnail */}
        {thumb ? (
          <div className="w-16 h-16 sm:w-24 sm:h-24 rounded-lg sm:rounded-xl overflow-hidden shrink-0 bg-muted/30 shadow-inner group">
            <img src={thumb} alt="" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" loading="lazy" />
          </div>
        ) : (
          <button
            onClick={onFetchPhotos}
            className="w-16 h-16 sm:w-24 sm:h-24 rounded-lg sm:rounded-xl shrink-0 bg-muted/30 border-2 border-dashed border-border/50 flex flex-col items-center justify-center text-muted-foreground/40 hover:border-secondary/40 hover:text-secondary/60 transition-colors group"
            title="Fetch photos from Depop"
          >
            <ImagePlus size={16} className="sm:mb-1 group-hover:scale-110 transition-transform" />
            <span className="text-[10px] font-medium hidden sm:block">Add Photo</span>
          </button>
        )}

        {/* Info */}
        <div className="flex-1 min-w-0 flex flex-col justify-center">
          <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap mb-1 sm:mb-1.5">
            {bagNum && (
              <span className="inline-flex items-center gap-1 bg-primary/10 text-primary border border-primary/20 text-[10px] sm:text-xs font-bold px-1.5 sm:px-2 py-0.5 rounded-md shadow-sm">
                <Package size={10} className="sm:w-3 sm:h-3" /> Bag #{bagNum}
              </span>
            )}
            <p className="font-semibold text-sm sm:text-base truncate max-w-[140px] sm:max-w-[280px] md:max-w-none">{listing.title}</p>
            <span className={`badge-${status} text-[9px] sm:text-[10px] font-bold px-1.5 sm:px-2 py-0.5 rounded-full shrink-0 uppercase tracking-wider`}>{status}</span>
            <span className={listing.platform === "poshmark" ? "text-[9px] sm:text-[10px] font-bold px-1.5 sm:px-2 py-0.5 rounded-full shrink-0 uppercase tracking-wider bg-muted text-muted-foreground border border-border/50" : `badge-${listing.platform} text-[9px] sm:text-[10px] font-bold px-1.5 sm:px-2 py-0.5 rounded-full shrink-0 uppercase tracking-wider`}>{listing.platform === "poshmark" ? "poshmark (legacy)" : listing.platform}</span>
            {listing.brand && (
              <span className="text-[9px] sm:text-[10px] font-medium px-1.5 sm:px-2 py-0.5 rounded-full bg-muted text-muted-foreground shrink-0 border border-border/50 hidden sm:inline-flex">{listing.brand}</span>
            )}
          </div>
          <div className="flex items-center gap-2 sm:gap-4 text-xs sm:text-sm text-muted-foreground flex-wrap">
            <span className="flex items-center gap-1"><span className="text-[10px] sm:text-xs opacity-70">Cost:</span> <span className="font-mono font-medium text-foreground">${listing.costPrice ?? "—"}</span></span>
            {(listing as any).depopPrice != null && <span className="flex items-center gap-1"><span className="text-[10px] sm:text-xs opacity-70" style={{color:PLATFORM_DOT.depop}}>Depop:</span> <span className="font-mono font-semibold text-foreground">${(listing as any).depopPrice}</span></span>}
            {(listing as any).vintedPrice != null && <span className="flex items-center gap-1"><span className="text-[10px] sm:text-xs opacity-70" style={{color:PLATFORM_DOT.vinted}}>Vinted:</span> <span className="font-mono font-semibold text-foreground">${(listing as any).vintedPrice}</span></span>}
            {(listing as any).ebayPrice != null && <span className="flex items-center gap-1"><span className="text-[10px] sm:text-xs opacity-70" style={{color:PLATFORM_DOT.ebay}}>eBay:</span> <span className="font-mono font-semibold text-foreground">${(listing as any).ebayPrice}</span></span>}
            {(listing as any).depopPrice == null && (listing as any).vintedPrice == null && (listing as any).ebayPrice == null && (
              <span className="flex items-center gap-1"><span className="text-[10px] sm:text-xs opacity-70">Listed:</span> <span className="font-mono font-semibold text-foreground">${listing.listedPrice ?? "—"}</span></span>
            )}
            {listing.soldPrice != null && (
              <span className="text-emerald-500 font-bold bg-emerald-50 dark:bg-emerald-900/20 px-1.5 sm:px-2 py-0.5 rounded-md border border-emerald-500/20 text-xs">
                +${(listing.soldPrice - listing.costPrice).toFixed(0)} NET
              </span>
            )}

            {/* LIVE ENGAGEMENT METRICS (from extension or manual entry) */}
            <EngagementBadges listing={listing} />

            {/* PLATFORM LINKS PREVIEW */}
            <div className="flex gap-1 ml-auto shrink-0">
               {(listing as any).depopUrl && <a href={(listing as any).depopUrl} target="_blank" rel="noreferrer" title="Depop link" className="w-4 h-4 sm:w-5 sm:h-5 rounded hover:opacity-80 flex items-center justify-center text-[9px] sm:text-[10px] text-white" style={{background:PLATFORM_DOT.depop}}>d</a>}
               {(listing as any).vintedUrl && <a href={(listing as any).vintedUrl} target="_blank" rel="noreferrer" title="Vinted link" className="w-4 h-4 sm:w-5 sm:h-5 rounded hover:opacity-80 flex items-center justify-center text-[9px] sm:text-[10px] text-white" style={{background:PLATFORM_DOT.vinted}}>v</a>}
               {(listing as any).ebayUrl && <a href={(listing as any).ebayUrl} target="_blank" rel="noreferrer" title="eBay link" className="w-4 h-4 sm:w-5 sm:h-5 rounded hover:opacity-80 flex items-center justify-center text-[9px] sm:text-[10px] text-white" style={{background:PLATFORM_DOT.ebay}}>e</a>}
            </div>
          </div>
        </div>

        {/* Actions — responsive */}
        <div className="flex sm:flex-col items-center sm:items-end justify-center sm:justify-center gap-1.5 sm:gap-2 shrink-0 sm:border-l border-border/30 sm:pl-3 md:pl-4 ml-auto sm:ml-0">
          {/* Primary CTA — always visible */}
          {status === "active" && (
            <Button
              variant="ghost" size="sm"
              className="text-xs h-8 gap-1 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 font-semibold"
              onClick={onMarkSold}
            >
              <CheckCircle size={13} />
              <span className="hidden sm:inline">Sold</span>
            </Button>
          )}
          {status === "pending" && (
            <Button
              variant="ghost" size="sm"
              className="text-xs h-8 gap-1 text-blue-600 hover:text-blue-700 hover:bg-blue-50 dark:hover:bg-blue-900/20 font-semibold"
              onClick={onActivate}
            >
              <Tag size={13} />
              <span className="hidden sm:inline">List it</span>
            </Button>
          )}
          {status === "sold" && bagNum && (
            <Button
              variant="ghost" size="sm"
              className="text-xs h-8 gap-1 text-emerald-600 hover:text-emerald-700"
              onClick={onQR}
            >
              <QrCode size={13} />
              <span className="hidden sm:inline">USPS</span>
            </Button>
          )}

          {/* Secondary actions — dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-muted-foreground">
                <MoreHorizontal size={15} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              {(status === "active" || status === "pending" || status === "sold") && (
                <DropdownMenuItem onClick={onEdit} className="gap-2 text-xs">
                  <Pencil size={12} /> Edit listing
                </DropdownMenuItem>
              )}
              {status === "active" && (
                <DropdownMenuItem onClick={onAI} className="gap-2 text-xs">
                  <Sparkles size={12} /> AI suggestions
                </DropdownMenuItem>
              )}
              {status === "active" && (
                <DropdownMenuItem onClick={onAdvice} className="gap-2 text-xs">
                  <BarChart2 size={12} /> AI advice (with live stats)
                </DropdownMenuItem>
              )}
              {status === "active" && (
                <DropdownMenuItem onClick={onManualStats} className="gap-2 text-xs">
                  <Eye size={12} /> Enter stats manually
                </DropdownMenuItem>
              )}
              {(status === "active" || status === "pending") && (
                <DropdownMenuItem onClick={onExport} className="gap-2 text-xs">
                  <ExternalLink size={12} /> Export / Crosslist
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={onFetchPhotos} className="gap-2 text-xs">
                <ImagePlus size={12} /> Fetch URL photos
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => window.open(`/api/listings/${listing.id}/download-images`, '_blank')} className="gap-2 text-xs">
                <Download size={12} /> Download Photos (ZIP)
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={onDelete}
                className="gap-2 text-xs text-destructive focus:text-destructive"
              >
                <Trash2 size={12} /> Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </div>
  );
}
