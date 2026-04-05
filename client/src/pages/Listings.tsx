import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Plus, Trash2, CheckCircle, Sparkles, ExternalLink, Copy, CheckCheck, Tag, Package, Pencil, QrCode, Download } from "lucide-react";
import { useState } from "react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Listing } from "@shared/schema";

const PLATFORMS = ["all", "depop", "vinted", "poshmark", "ebay"];
const STATUSES = ["all", "pending", "active", "sold", "draft"];

export default function Listings() {
  const [platform, setPlatform] = useState("all");
  const [status, setStatus] = useState("all");
  const [, navigate] = useLocation();
  const [markSoldId, setMarkSoldId] = useState<number | null>(null);
  const [soldPrice, setSoldPrice] = useState("");
  const [suggestId, setSuggestId] = useState<number | null>(null);
  const [suggestions, setSuggestions] = useState<any>(null);
  const [suggestLoading, setSuggestLoading] = useState(false);
  const [crosslistListing, setCrosslistListing] = useState<Listing | null>(null);
  const [copiedPlat, setCopiedPlat] = useState<string | null>(null);
  const [qrData, setQrData] = useState<{ bagNumber: number; qrDataUrl: string; label: string } | null>(null);
  const [qrLoading, setQrLoading] = useState(false);
  const { toast } = useToast();

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
      toast({ title: "Листинг активирован!" });
    },
  });

  const buildExportText = (listing: Listing, platform: string) => {
    const prices = listing.priceSuggestions ? JSON.parse(listing.priceSuggestions) : {};
    const scanData = listing.scanData ? JSON.parse(listing.scanData) : null;
    const platData = scanData?.platforms?.[platform];
    const price = prices[platform] || listing.listedPrice || "";
    const priceStr = platData ? `$${platData.minPrice}–$${platData.maxPrice}` : price ? `$${price}` : "";
    const title = listing.title || "";
    const desc = listing.description || "";
    const cond = listing.condition || "good";
    const sz = listing.size || "";
    return `${title}${sz ? ` | Size: ${sz}` : ""}\n\n${desc}\n\nCondition: ${cond}\nPrice: ${priceStr}`.trim();
  };

  const copyExport = (platform: string) => {
    if (!crosslistListing) return;
    const text = buildExportText(crosslistListing, platform);
    navigator.clipboard.writeText(text);
    setCopiedPlat(platform);
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
        title: bagNum ? `✅ Sold! Go grab Bag #${bagNum}` : "✅ Marked as sold!",
        description: bagNum
          ? `Pack it up — show QR for Bag #${bagNum} at USPS to print label`
          : "Stats updated.",
      });
    },
  });

  const getAISuggestions = async (id: number) => {
    setSuggestId(id);
    setSuggestLoading(true);
    setSuggestions(null);
    try {
      const r = await apiRequest("POST", "/api/ai/suggest", { listingId: id });
      const data = await r.json();
      setSuggestions(data);
    } catch (e) {
      toast({ title: "Error", description: "Could not get AI suggestions", variant: "destructive" });
    } finally {
      setSuggestLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-full">
      <header className="flex items-center justify-between gap-3 px-6 py-4 border-b border-border sticky top-0 bg-background/95 backdrop-blur z-10">
        <div className="flex items-center gap-3">
          <SidebarTrigger />
          <div>
            <h1 className="text-lg font-semibold">Listings</h1>
            <p className="text-xs text-muted-foreground">{listings.length} items</p>
          </div>
        </div>
        <Button size="sm" asChild data-testid="new-listing-btn">
          <Link href="/listings/new"><Plus size={14} className="mr-1" /> New Listing</Link>
        </Button>
      </header>

      <div className="px-6 py-3 border-b border-border flex flex-wrap gap-2">
        <div className="flex gap-1">
          {STATUSES.map(s => (
            <button key={s} onClick={() => setStatus(s)} className={`text-xs px-3 py-1.5 rounded-full font-medium transition-colors ${status === s ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"}`} data-testid={`filter-status-${s}`}>
              {s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
        <div className="flex gap-1 ml-auto">
          {PLATFORMS.map(p => (
            <button key={p} onClick={() => setPlatform(p)} className={`text-xs px-3 py-1.5 rounded-full font-medium transition-colors ${platform === p ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"}`} data-testid={`filter-platform-${p}`}>
              {p.charAt(0).toUpperCase() + p.slice(1)}
            </button>
          ))}
        </div>
      </div>

      <main className="flex-1 overflow-y-auto px-6 py-5">
        {isLoading ? (
          <div className="space-y-2">{Array.from({length: 5}).map((_, i) => <Skeleton key={i} className="h-16 w-full skeleton" />)}</div>
        ) : listings.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <Package size={40} className="text-muted-foreground/40 mb-3" />
            <p className="font-medium text-sm mb-1">No listings found</p>
            <p className="text-xs text-muted-foreground mb-4">Try adjusting filters or add a new listing</p>
            <Button size="sm" asChild><Link href="/listings/new"><Plus size={13} className="mr-1" /> Add first item</Link></Button>
          </div>
        ) : (
          <div className="space-y-2" data-testid="listings-list">
            {listings.map((listing: Listing) => (
              <Card key={listing.id} className="hover:shadow-sm transition-shadow" data-testid={`listing-card-${listing.id}`}>
                <CardContent className="py-3 px-4">
                  <div className="flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                        <p className="font-medium text-sm truncate">{listing.title}</p>
                        <span className={`badge-${listing.status} text-[10px] font-semibold px-2 py-0.5 rounded-full`}>{listing.status}</span>
                        <span className={`badge-${listing.platform} text-[10px] font-semibold px-2 py-0.5 rounded-full`}>{listing.platform}</span>
                        {(listing as any).bagNumber && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">
                            <Package size={9} /> #{(listing as any).bagNumber}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground">
                        <span>Cost: <span className="font-mono text-foreground">${listing.costPrice}</span></span>
                        {listing.listedPrice && <span>Listed: <span className="font-mono text-foreground">${listing.listedPrice}</span></span>}
                        {listing.soldPrice && <span>Sold: <span className="font-mono text-emerald-600 dark:text-emerald-400">${listing.soldPrice}</span></span>}
                        {listing.soldPrice && <span className="text-emerald-600 dark:text-emerald-400 font-medium">+${(listing.soldPrice - listing.costPrice).toFixed(0)} profit</span>}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {listing.status === "pending" && (
                        <>
                          <Button variant="ghost" size="sm" className="text-xs h-7 gap-1 text-blue-600 hover:text-blue-700 hover:bg-blue-50 dark:hover:bg-blue-900/20" onClick={() => activateMutation.mutate(listing.id)} data-testid={`activate-${listing.id}`}>
                            <Tag size={12} /> List it
                          </Button>
                          <Button variant="ghost" size="sm" className="text-xs h-7 gap-1" onClick={() => setCrosslistListing(listing)} data-testid={`crosslist-${listing.id}`}>
                            <ExternalLink size={12} /> Export
                          </Button>
                        </>
                      )}
                      {listing.status === "active" && (
                        <>
                          <Button variant="ghost" size="sm" className="text-xs h-7 gap-1 text-muted-foreground" onClick={() => navigate(`/listings/${listing.id}/edit`)} data-testid={`edit-${listing.id}`}>
                            <Pencil size={12} /> Edit
                          </Button>
                          <Button variant="ghost" size="sm" className="text-xs h-7 gap-1" onClick={() => getAISuggestions(listing.id)} data-testid={`ai-suggest-${listing.id}`}>
                            <Sparkles size={12} /> AI
                          </Button>
                          <Button variant="ghost" size="sm" className="text-xs h-7 gap-1" onClick={() => setCrosslistListing(listing)} data-testid={`crosslist-active-${listing.id}`}>
                            <ExternalLink size={12} /> Export
                          </Button>
                          <Button variant="ghost" size="sm" className="text-xs h-7 gap-1 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 dark:hover:bg-emerald-900/20" onClick={() => setMarkSoldId(listing.id)} data-testid={`mark-sold-${listing.id}`}>
                            <CheckCircle size={12} /> Sold
                          </Button>
                        </>
                      )}
                      {listing.status === "pending" && (
                        <Button variant="ghost" size="sm" className="text-xs h-7 gap-1 text-muted-foreground" onClick={() => navigate(`/listings/${listing.id}/edit`)} data-testid={`edit-pending-${listing.id}`}>
                          <Pencil size={12} /> Edit
                        </Button>
                      )}
                      {listing.status === "sold" && (listing as any).bagNumber && (
                        <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs text-emerald-600 hover:text-emerald-700" onClick={() => openQR((listing as any).bagNumber)} data-testid={`qr-${listing.id}`}>
                          <QrCode size={12} /> USPS
                        </Button>
                      )}
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive" onClick={() => deleteMutation.mutate(listing.id)} data-testid={`delete-${listing.id}`}>
                        <Trash2 size={13} />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </main>

      {/* Mark Sold Dialog — asks for NET price after all fees */}
      <Dialog open={markSoldId !== null} onOpenChange={() => { setMarkSoldId(null); setSoldPrice(""); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle size={16} className="text-emerald-500" />
              Mark as Sold
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {/* Show the listing being sold */}
            {markSoldId && (() => {
              const l = listings.find((x: any) => x.id === markSoldId);
              const platFee = l?.platform === "vinted" ? 0 : l?.platform === "poshmark" ? 0.20 : 0.13;
              const estNet = l?.listedPrice ? (l.listedPrice * (1 - platFee)).toFixed(0) : null;
              return l ? (
                <div className="bg-muted/40 rounded-xl p-3 space-y-2">
                  <p className="text-sm font-semibold">{l.title}</p>
                  <div className="flex gap-3 text-xs text-muted-foreground">
                    <span>Listed: <span className="font-mono text-foreground">${l.listedPrice}</span></span>
                    <span>Cost: <span className="font-mono text-foreground">${l.costPrice}</span></span>
                    {estNet && <span>Est. net: <span className="font-mono text-emerald-500">${estNet}</span></span>}
                  </div>
                </div>
              ) : null;
            })()}

            <div className="space-y-1.5">
              <Label htmlFor="sold-price" className="text-sm font-medium">
                How much did you receive? ($)
              </Label>
              <p className="text-xs text-muted-foreground">
                Enter what you actually received <strong>after all platform fees</strong>. This goes into your profit stats.
              </p>
              <Input
                id="sold-price"
                type="number"
                value={soldPrice}
                onChange={e => setSoldPrice(e.target.value)}
                placeholder="e.g. 39"
                data-testid="sold-price-input"
                autoFocus
                className="rounded-xl font-mono text-base h-11"
              />
            </div>

            {/* Live profit preview */}
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
                  {roi && <p className="text-xs text-muted-foreground mt-0.5">{roi}% ROI on this item</p>}
                </div>
              ) : null;
            })()}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setMarkSoldId(null); setSoldPrice(""); }}>Cancel</Button>
            <Button
              onClick={() => markSoldMutation.mutate({ id: markSoldId!, price: Number(soldPrice) })}
              disabled={!soldPrice || markSoldMutation.isPending}
              className="gap-2"
              style={{ background: "linear-gradient(135deg, hsl(150 65% 40%), hsl(195 80% 45%))" }}
              data-testid="confirm-sold-btn"
            >
              <CheckCircle size={13} />
              {markSoldMutation.isPending ? "Saving..." : "Confirm Sale"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* AI Suggestions Dialog */}
      <Dialog open={suggestId !== null} onOpenChange={() => { setSuggestId(null); setSuggestions(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><Sparkles size={16} className="text-amber-500" /> AI Suggestions</DialogTitle></DialogHeader>
          {suggestLoading ? (
            <div className="space-y-3 py-2">
              {Array.from({length: 3}).map((_, i) => <Skeleton key={i} className="h-12 skeleton" />)}
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

      {/* QR Code Dialog */}
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

      {/* Crosslist Export Dialog */}
      <Dialog open={!!crosslistListing} onOpenChange={() => { setCrosslistListing(null); setCopiedPlat(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ExternalLink size={15} className="text-primary" />
              Экспорт в Crosslist / Vendoo
            </DialogTitle>
          </DialogHeader>
          {crosslistListing && (
            <div className="space-y-3 max-h-[60vh] overflow-y-auto">
              <div className="bg-muted/40 rounded-lg p-3">
                <p className="text-sm font-semibold">{crosslistListing.title}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{crosslistListing.brand} · Size: {crosslistListing.size} · {crosslistListing.condition}</p>
              </div>
              <p className="text-xs text-muted-foreground">Копируй текст для нужной площадки, затем вставь в Crosslist или Vendoo.</p>
              {["depop", "vinted", "poshmark", "ebay"].map(plat => {
                const prices = crosslistListing.priceSuggestions ? JSON.parse(crosslistListing.priceSuggestions) : {};
                const price = prices[plat];
                return (
                  <div key={plat} className="bg-muted/40 rounded-lg p-3">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className={`badge-${plat} text-[10px] font-bold px-2 py-0.5 rounded-full uppercase`}>{plat}</span>
                        {price && <span className="text-xs font-mono font-semibold">${price}</span>}
                      </div>
                      <Button variant="ghost" size="sm" className="h-7 px-2 gap-1" onClick={() => copyExport(plat)} data-testid={`copy-export-${plat}`}>
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

    </div>
  );
}

function Package({ size, className }: any) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className={className}>
      <path d="m7.5 4.27 9 5.15M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/>
      <path d="m3.3 7 8.7 5 8.7-5M12 22V12"/>
    </svg>
  );
}
