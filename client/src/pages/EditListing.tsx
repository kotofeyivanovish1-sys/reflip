import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation, useParams } from "wouter";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Save, ArrowLeft, Package, Sparkles } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useState, useEffect } from "react";
import type { Listing } from "@shared/schema";

const PLATFORMS = ["depop", "vinted", "poshmark", "ebay"];
const CONDITIONS = ["new with tags", "like new", "very good", "good", "fair"];
const PLATFORM_COLORS: Record<string, string> = {
  depop: "#ff4e4e", vinted: "#09b1ba", poshmark: "#e94365", ebay: "#e43c24",
};

export default function EditListing() {
  const params = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const { toast } = useToast();

  const { data: listing, isLoading } = useQuery<Listing>({
    queryKey: ["/api/listings", params.id],
    queryFn: () => apiRequest("GET", `/api/listings/${params.id}`).then(r => r.json()),
  });

  const [form, setForm] = useState({
    title: "", brand: "", size: "", condition: "good",
    category: "", platform: "depop", costPrice: "", listedPrice: "",
    description: "",
  });

  useEffect(() => {
    if (listing) {
      setForm({
        title: listing.title || "",
        brand: listing.brand || "",
        size: listing.size || "",
        condition: listing.condition || "good",
        category: listing.category || "",
        platform: listing.platform || "depop",
        costPrice: String(listing.costPrice || ""),
        listedPrice: String(listing.listedPrice || ""),
        description: listing.description || "",
      });
    }
  }, [listing]);

  const [improving, setImproving] = useState(false);

  const improveDescription = async () => {
    if (!params.id) return;
    setImproving(true);
    try {
      const r = await apiRequest("POST", `/api/listings/${params.id}/improve-description`);
      const data = await r.json();
      if (data.error) throw new Error(data.error);
      setForm(f => ({ ...f, description: data.description }));
      toast({ title: "Description improved!" });
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setImproving(false);
    }
  };

  const update = (key: string, val: string) => setForm(f => ({ ...f, [key]: val }));

  const saveMutation = useMutation({
    mutationFn: () => apiRequest("PATCH", `/api/listings/${params.id}`, {
      title: form.title,
      brand: form.brand || null,
      size: form.size || null,
      condition: form.condition,
      category: form.category || null,
      platform: form.platform,
      costPrice: Number(form.costPrice) || 0,
      listedPrice: form.listedPrice ? Number(form.listedPrice) : null,
      description: form.description,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/listings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats/dashboard"] });
      toast({ title: "Saved!" });
      navigate("/listings");
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  // Platform-specific prices from priceSuggestions
  const prices = listing?.priceSuggestions ? (() => {
    try { return JSON.parse(listing.priceSuggestions); } catch { return {}; }
  })() : {};

  // AI texts per platform
  const aiTexts = listing?.aiTexts ? (() => {
    try { return JSON.parse(listing.aiTexts); } catch { return {}; }
  })() : {};

  if (isLoading) return (
    <div className="flex flex-col h-full">
      <header className="flex items-center gap-3 px-6 py-4 border-b border-border/50">
        <SidebarTrigger />
        <Skeleton className="h-5 w-40 skeleton" />
      </header>
      <main className="flex-1 px-6 py-6 space-y-4">
        {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12 skeleton" />)}
      </main>
    </div>
  );

  return (
    <div className="flex flex-col h-full">
      <header className="flex items-center justify-between gap-2 sm:gap-3 px-3 sm:px-5 md:px-6 py-3 sm:py-4 border-b border-border/50 sticky top-0 bg-background/80 backdrop-blur-xl z-10">
        <div className="flex items-center gap-1.5 sm:gap-3 min-w-0">
          <SidebarTrigger />
          <Button variant="ghost" size="sm" className="gap-1 sm:gap-1.5 text-xs px-2 sm:px-3" onClick={() => navigate("/listings")}>
            <ArrowLeft size={13} /> <span className="hidden sm:inline">Back</span>
          </Button>
          <div className="min-w-0">
            <h1 className="text-sm sm:text-base font-semibold truncate">Edit Listing</h1>
            {listing?.bagNumber && (
              <p className="text-[11px] sm:text-xs text-muted-foreground flex items-center gap-1">
                <Package size={10} /> Bag #{listing.bagNumber}
              </p>
            )}
          </div>
        </div>
        <Button
          size="sm"
          className="gap-2 rounded-xl"
          style={{ background: "linear-gradient(135deg, hsl(250 80% 58%), hsl(280 70% 58%))" }}
          onClick={() => saveMutation.mutate()}
          disabled={saveMutation.isPending}
          data-testid="save-btn"
        >
          <Save size={13} />
          {saveMutation.isPending ? "Saving..." : "Save changes"}
        </Button>
      </header>

      <main className="flex-1 overflow-y-auto px-3 sm:px-5 md:px-6 py-4 sm:py-6">
        <div className="max-w-2xl mx-auto space-y-5">

          {/* Core fields */}
          <div className="glass-card rounded-2xl p-5 space-y-4">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Item details</p>

            <div>
              <Label className="text-xs mb-1.5 block text-muted-foreground">Title</Label>
              <Input value={form.title} onChange={e => update("title", e.target.value)}
                className="rounded-xl" data-testid="input-title" />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs mb-1.5 block text-muted-foreground">Brand</Label>
                <Input value={form.brand} onChange={e => update("brand", e.target.value)}
                  placeholder="Levi's, Zara..." className="rounded-xl" />
              </div>
              <div>
                <Label className="text-xs mb-1.5 block text-muted-foreground">Size</Label>
                <Input value={form.size} onChange={e => update("size", e.target.value)}
                  placeholder="M, W32, XS..." className="rounded-xl" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs mb-1.5 block text-muted-foreground">Condition</Label>
                <Select value={form.condition} onValueChange={v => update("condition", v)}>
                  <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CONDITIONS.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs mb-1.5 block text-muted-foreground">Category</Label>
                <Input value={form.category} onChange={e => update("category", e.target.value)}
                  placeholder="Jeans, Jacket..." className="rounded-xl" />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <Label className="text-xs text-muted-foreground">Description</Label>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2.5 gap-1.5 text-xs text-amber-600 hover:text-amber-700 hover:bg-amber-50 dark:hover:bg-amber-900/20"
                  onClick={improveDescription}
                  disabled={improving}
                >
                  <Sparkles size={12} />
                  {improving ? "Improving..." : "Improve Description"}
                </Button>
              </div>
              <Textarea value={form.description} onChange={e => update("description", e.target.value)}
                rows={4} className="rounded-xl resize-none text-sm" />
            </div>
          </div>

          {/* Pricing — the main thing to edit */}
          <div className="glass-card rounded-2xl p-5 space-y-4">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Pricing & Platform</p>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label className="text-xs mb-1.5 block text-muted-foreground">Cost paid ($)</Label>
                <Input type="number" value={form.costPrice} onChange={e => update("costPrice", e.target.value)}
                  placeholder="8" className="rounded-xl font-mono" data-testid="input-cost" />
              </div>
              <div>
                <Label className="text-xs mb-1.5 block text-muted-foreground">List price ($)</Label>
                <Input type="number" value={form.listedPrice} onChange={e => update("listedPrice", e.target.value)}
                  placeholder="45" className="rounded-xl font-mono" data-testid="input-price" />
              </div>
              <div>
                <Label className="text-xs mb-1.5 block text-muted-foreground">Platform</Label>
                <Select value={form.platform} onValueChange={v => update("platform", v)}>
                  <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PLATFORMS.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Margin preview */}
            {form.costPrice && form.listedPrice && (
              <div className="grid grid-cols-3 gap-2">
                {PLATFORMS.map(plat => {
                  const fee = plat === "vinted" ? 0 : plat === "poshmark" ? 0.20 : 0.13;
                  const net = Number(form.listedPrice) * (1 - fee);
                  const profit = net - Number(form.costPrice);
                  const roi = ((profit / Number(form.costPrice)) * 100).toFixed(0);
                  return (
                    <div key={plat} className="rounded-xl p-2.5 text-center"
                      style={{ background: `${PLATFORM_COLORS[plat]}18`, border: `1px solid ${PLATFORM_COLORS[plat]}33` }}>
                      <p className="text-[10px] font-bold uppercase" style={{ color: PLATFORM_COLORS[plat] }}>{plat}</p>
                      <p className="text-sm font-mono font-bold">${net.toFixed(0)}<span className="text-[9px] text-muted-foreground"> net</span></p>
                      <p className={`text-[10px] font-semibold ${profit > 0 ? "text-emerald-500" : "text-red-400"}`}>
                        {profit > 0 ? "+" : ""}{profit.toFixed(0)} ({roi}% ROI)
                      </p>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* AI-generated platform texts — read-only reference */}
          {Object.keys(aiTexts).length > 0 && (
            <div className="glass-card rounded-2xl p-5 space-y-3">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">AI-generated texts (reference)</p>
              {Object.entries(aiTexts).map(([plat, text]: any) => {
                const [title, desc] = text.split("|");
                return (
                  <div key={plat} className="rounded-xl p-3"
                    style={{ background: `${PLATFORM_COLORS[plat]}10`, border: `1px solid ${PLATFORM_COLORS[plat]}25` }}>
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className={`badge-${plat} text-[10px] font-bold px-2 py-0.5 rounded-full uppercase`}>{plat}</span>
                      {prices[plat] && <span className="text-xs font-mono font-semibold">${prices[plat]}</span>}
                    </div>
                    <p className="text-xs font-medium mb-1">{title?.trim()}</p>
                    <p className="text-[11px] text-muted-foreground whitespace-pre-wrap leading-relaxed max-h-32 overflow-y-auto">{desc?.trim()}</p>
                  </div>
                );
              })}
            </div>
          )}

          <Button
            className="w-full h-11 rounded-2xl gap-2"
            style={{ background: "linear-gradient(135deg, hsl(250 80% 58%), hsl(280 70% 58%))" }}
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending}
          >
            <Save size={15} />
            {saveMutation.isPending ? "Saving..." : "Save changes"}
          </Button>
        </div>
      </main>
    </div>
  );
}
