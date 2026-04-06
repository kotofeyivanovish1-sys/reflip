import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Plus, Trash2, CheckCircle, Sparkles, ExternalLink, Copy, CheckCheck,
  Tag, Package, Pencil, QrCode, Download, MoreHorizontal
} from "lucide-react";
import { useState } from "react";
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

const PLATFORMS = ["all", "depop", "vinted", "poshmark", "ebay"];
const STATUSES = ["all", "pending", "active", "sold", "draft"];

const PLATFORM_DOT: Record<string, string> = {
  depop: "#ff4e4e", vinted: "#09b1ba", poshmark: "#e94365", ebay: "#e43c24",
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

  return (
    <div className="flex flex-col h-full">
      <header className="flex items-center justify-between gap-3 px-4 sm:px-6 py-4 border-b border-border sticky top-0 bg-background/95 backdrop-blur z-10">
        <div className="flex items-center gap-3">
          <SidebarTrigger />
          <div>
            <h1 className="text-lg font-semibold">Listings</h1>
            <p className="text-xs text-muted-foreground">{listings.length} items</p>
          </div>
        </div>
        <Button size="sm" asChild className="rounded-xl gap-1.5">
          <Link href="/listings/new"><Plus size={14} /> New</Link>
        </Button>
      </header>

      {/* Filter bar — scrollable on mobile */}
      <div className="px-4 sm:px-6 py-3 border-b border-border/60 overflow-x-auto">
        <div className="flex gap-2 min-w-max">
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

      <main className="flex-1 overflow-y-auto px-4 sm:px-6 py-4">
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
                onExport={() => setCrosslistListing(listing)}
                onQR={() => openQR((listing as any).bagNumber)}
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
              const platFee = l?.platform === "vinted" ? 0 : l?.platform === "poshmark" ? 0.20 : 0.13;
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
    </div>
  );
}

// ── Listing Row — responsive action buttons ──
interface RowProps {
  listing: Listing;
  onMarkSold: () => void;
  onActivate: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onAI: () => void;
  onExport: () => void;
  onQR: () => void;
}

function ListingRow({ listing, onMarkSold, onActivate, onEdit, onDelete, onAI, onExport, onQR }: RowProps) {
  const status = listing.status;
  const bagNum = (listing as any).bagNumber;

  return (
    <div className="glass-card rounded-2xl px-4 py-3 hover:shadow-md transition-all duration-200">
      <div className="flex items-center gap-3">
        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap mb-0.5">
            <p className="font-medium text-sm truncate max-w-[160px] sm:max-w-none">{listing.title}</p>
            <span className={`badge-${status} text-[10px] font-semibold px-1.5 py-0.5 rounded-full shrink-0`}>{status}</span>
            <span className={`badge-${listing.platform} text-[10px] font-semibold px-1.5 py-0.5 rounded-full shrink-0`}>{listing.platform}</span>
            <span className="inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20 shrink-0">
                #{bagNum ?? "—"}
              </span>
          </div>
          <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
            <span className="inline-flex items-center gap-0.5 font-semibold text-primary">
                <Package size={10} /> Bag #{bagNum ?? "—"}
              </span>
            <span>Cost: <span className="font-mono text-foreground">${listing.costPrice ?? "—"}</span></span>
            <span>Price: <span className="font-mono font-semibold text-foreground">${listing.listedPrice ?? "—"}</span></span>
            {listing.soldPrice != null && <span className="text-emerald-600 dark:text-emerald-400 font-medium">+${(listing.soldPrice - listing.costPrice).toFixed(0)}</span>}
          </div>
        </div>

        {/* Actions — responsive */}
        <div className="flex items-center gap-1 shrink-0">
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
              {(status === "active" || status === "pending") && (
                <DropdownMenuItem onClick={onEdit} className="gap-2 text-xs">
                  <Pencil size={12} /> Edit listing
                </DropdownMenuItem>
              )}
              {status === "active" && (
                <DropdownMenuItem onClick={onAI} className="gap-2 text-xs">
                  <Sparkles size={12} /> AI suggestions
                </DropdownMenuItem>
              )}
              {(status === "active" || status === "pending") && (
                <DropdownMenuItem onClick={onExport} className="gap-2 text-xs">
                  <ExternalLink size={12} /> Export / Crosslist
                </DropdownMenuItem>
              )}
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
