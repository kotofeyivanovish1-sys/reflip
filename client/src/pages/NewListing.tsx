import { useState, useRef, useCallback } from "react";
import { useLocation } from "wouter";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Camera, Sparkles, Copy, CheckCheck, X, Plus,
  ArrowRight, ShoppingBag, ChevronRight, Check,
  Package, DollarSign, Tag
} from "lucide-react";
import { apiRequest, queryClient, getAuthHeaders } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

const PLATFORM_COLORS: Record<string, string> = {
  depop: "#ff4e4e", vinted: "#09b1ba", poshmark: "#e94365", ebay: "#e43c24",
};

// Platform fee multipliers (what seller keeps)
const PLATFORM_NETS: Record<string, number> = {
  depop: 0.87, vinted: 1.00, poshmark: 0.80, ebay: 0.85,
};

const PLATFORMS = ["depop", "vinted", "poshmark", "ebay"];

type Step = "input" | "analyzing" | "review" | "saved";

export default function NewListing() {
  const [, navigate] = useLocation();
  const { toast } = useToast();

  // Step state
  const [step, setStep] = useState<Step>("input");

  // Input
  const [images, setImages] = useState<{ file: File; preview: string }[]>([]);
  const [description, setDescription] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  // Result from AI
  const [result, setResult] = useState<any>(null);

  // User inputs on review step
  const [costPrice, setCostPrice] = useState("");
  const [copied, setCopied] = useState<string | null>(null);

  // Modes
  const [mode, setMode] = useState<"single"|"depop"|"batch">("single");
  const [depopUrl, setDepopUrl] = useState("");
  const [batching, setBatching] = useState(false);
  const [batchCount, setBatchCount] = useState(0);

  // Save state
  const [saving, setSaving] = useState(false);
  const [savedBag, setSavedBag] = useState<number | null>(null);

  const addImages = useCallback((files: FileList | null) => {
    if (!files) return;
    const newImgs = Array.from(files).slice(0, 8 - images.length).map(file => ({
      file, preview: URL.createObjectURL(file),
    }));
    setImages(prev => [...prev, ...newImgs].slice(0, 8));
  }, [images.length]);

  const removeImage = (i: number) => setImages(prev => prev.filter((_, idx) => idx !== i));

  // DEPOP IMPORT
  const handleDepopImport = async () => {
    if (!depopUrl.includes("depop.com")) return toast({ title: "Valid Depop URL required" });
    setStep("analyzing");
    try {
      const res = await apiRequest("POST", "/api/depop/import", { url: depopUrl, costPrice: Number(costPrice) || 0 });
      const saved = await res.json();
      setSavedBag(saved.bagNumber);
      setStep("saved");
      queryClient.invalidateQueries({ queryKey: ["/api/listings"] });
    } catch (e: any) {
      toast({ title: "Import failed", description: e.message, variant: "destructive" });
      setStep("input");
    }
  };

  // BATCH MAGIC IMPORT
  const handleBatchMagic = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setBatching(true);
    setStep("analyzing");
    try {
      const formData = new FormData();
      Array.from(files).slice(0, 20).forEach(f => formData.append("images", f));
      const res = await fetch("/api/ai/batch-source", { method: "POST", body: formData, headers: getAuthHeaders() });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setBatchCount(data.count || 0);
      toast({ title: `Successfully batched ${data.count} items!` });
      setStep("saved");
      queryClient.invalidateQueries({ queryKey: ["/api/listings"] });
    } catch (e: any) {
      toast({ title: "Batch failed", description: e.message, variant: "destructive" });
      setStep("input");
    } finally {
      setBatching(false);
    }
  };

  // BACKGROUND UPLOAD
  const handleBackgroundUpload = async (file: File) => {
    try {
      const fd = new FormData();
      fd.append("image", file);
      const res = await fetch("/api/user/background", { method: "POST", body: fd, headers: getAuthHeaders() });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      toast({ title: "Background saved!" });
    } catch(e: any) {
      toast({ title: "Failed to upload bg", description: e.message, variant: "destructive" });
    }
  };

  // STEP 1 → 2: Analyze
  const analyze = async () => {
    if (!description.trim() && images.length === 0) {
      toast({ title: "Add a photo or write a description" }); return;
    }
    setStep("analyzing");
    try {
      const formData = new FormData();
      formData.append("description", description);
      images.forEach(img => formData.append("images", img.file));
      const r = await fetch("/api/ai/quick-listing", { method: "POST", body: formData, headers: getAuthHeaders() });
      const data = await r.json();
      if (data.error) throw new Error(data.error);
      if (!data.platforms || Object.keys(data.platforms).length === 0) throw new Error("No platform data returned");
      setResult(data);
      setStep("review");
    } catch (e: any) {
      toast({ title: "Analysis failed", description: e.message, variant: "destructive" });
      setStep("input");
    }
  };

  // STEP 3 → saved: Confirm
  const confirm = async () => {
    if (!result) return;
    setSaving(true);
    try {
      const platforms = result.platforms || {};
      // Best platform = highest net
      const best = Object.entries(platforms).sort((a: any, b: any) => b[1].netAfterFees - a[1].netAfterFees)[0];
      const bestName = best?.[0] || "depop";
      const bestPrice = (best?.[1] as any)?.listPrice || null;

      const priceSuggestions = JSON.stringify(
        Object.fromEntries(Object.entries(platforms).map(([k, v]: any) => [k, v.listPrice]))
      );
      const aiTexts = JSON.stringify(
        Object.fromEntries(Object.entries(platforms).map(([k, v]: any) => [k, `${v.title}|${v.description}`]))
      );

      // Save image URLs if available (from uploaded photos)
      const imageUrl = result._imageUrls?.length ? JSON.stringify(result._imageUrls) : null;

      const res = await apiRequest("POST", "/api/listings", {
        title: result.title || "Untitled",
        description: platforms[bestName]?.description || result.title || "—",
        brand: result.brand && result.brand !== "Unknown" ? result.brand : null,
        size: result.size || null,
        condition: result.condition || "good",
        category: result.category || null,
        costPrice: Number(costPrice) || 0,
        listedPrice: bestPrice,
        platform: bestName,
        status: "active",
        aiTexts,
        priceSuggestions,
        imageUrl,
      });
      const saved = await res.json();
      setSavedBag(saved.bagNumber);
      setStep("saved");
      queryClient.invalidateQueries({ queryKey: ["/api/listings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/bags"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats/dashboard"] });
    } catch (e: any) {
      toast({ title: "Save failed", description: e.message, variant: "destructive" });
    } finally { setSaving(false); }
  };

  const copy = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 2500);
  };

  const cost = Number(costPrice) || 0;

  const reset = () => {
    setStep("input"); setImages([]); setDescription("");
    setResult(null); setCostPrice(""); setSavedBag(null);
  };

  return (
    <div className="flex flex-col h-full">
      <header className="flex items-center gap-3 px-6 py-4 border-b border-border/50 sticky top-0 bg-background/80 backdrop-blur-xl z-10">
        <SidebarTrigger />
        <div className="flex-1">
          <h1 className="text-base font-semibold">New Listing</h1>
          <p className="text-xs text-muted-foreground">
            {step === "input" && "Drop photos + describe the item"}
            {step === "analyzing" && "AI is analyzing..."}
            {step === "review" && "Review prices & copy descriptions"}
            {step === "saved" && "Saved to inventory"}
          </p>
        </div>
        {/* Step indicator */}
        <div className="flex items-center gap-1.5">
          {(["input", "review", "saved"] as Step[]).map((s, i) => (
            <div key={s} className={`w-2 h-2 rounded-full transition-all ${
              step === s ? "bg-primary w-4" :
              (step === "analyzing" && s === "input") || (step === "saved" && i < 2) || (step === "review" && i < 1)
                ? "bg-primary/40" : "bg-muted"
            }`} />
          ))}
        </div>
      </header>

      <main className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto px-5 py-6 space-y-4">

          {/* ══════════════════════════════════════
              STEP 1: INPUT
          ══════════════════════════════════════ */}
          {step === "input" && (
            <>
              {/* Mode Selector */}
              <div className="flex bg-muted/30 p-1 rounded-2xl mb-4">
                <button onClick={() => setMode("single")} className={`flex-1 text-xs font-semibold py-2.5 rounded-xl transition-all ${mode==='single' ? "bg-background shadow-sm text-primary" : "text-muted-foreground hover:bg-black/5 dark:hover:bg-white/5"}`}>Manual</button>
                <button onClick={() => setMode("depop")} className={`flex-1 text-xs font-semibold py-2.5 rounded-xl transition-all ${mode==='depop' ? "bg-background shadow-sm text-primary" : "text-muted-foreground hover:bg-black/5 dark:hover:bg-white/5"}`}>Depop URL</button>
                <button onClick={() => setMode("batch")} className={`flex-1 text-xs font-semibold py-2.5 rounded-xl transition-all ${mode==='batch' ? "bg-background shadow-sm text-primary" : "text-muted-foreground hover:bg-black/5 dark:hover:bg-white/5"}`}>Batch Magic ⚡️</button>
              </div>

              {/* SINGLE MODE */}
              {mode === "single" && (
                <>
                  <div
                    className={`rounded-3xl border-2 border-dashed cursor-pointer overflow-hidden transition-all duration-200 ${
                      images.length ? "border-primary/40 bg-primary/3" : "border-border/60 hover:border-primary/40 hover:bg-muted/20"
                    }`}
                    onClick={() => fileRef.current?.click()}
                    onDragOver={e => e.preventDefault()}
                    onDrop={e => { e.preventDefault(); addImages(e.dataTransfer.files); }}
                  >
                    <input ref={fileRef} type="file" accept="image/*" multiple className="hidden"
                      onChange={e => addImages(e.target.files)} />
                    {images.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-14 gap-3">
                        <div className="w-14 h-14 rounded-2xl flex items-center justify-center float"
                          style={{ background: "linear-gradient(135deg, hsl(250 80% 65% / 0.25), hsl(195 80% 60% / 0.25))" }}>
                          <Camera size={26} className="text-primary/50" />
                        </div>
                        <p className="text-sm font-medium">Drop photos here</p>
                        <p className="text-xs text-muted-foreground">AI identifies brand, size, condition — up to 8 photos</p>
                      </div>
                    ) : (
                      <div className="p-4 grid grid-cols-4 gap-3">
                        {images.map((img, i) => (
                          <div key={i} className="relative aspect-square rounded-2xl overflow-hidden group">
                            <img src={img.preview} alt="" className="w-full h-full object-cover" />
                            <button onClick={e => { e.stopPropagation(); removeImage(i); }}
                              className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-black/50 flex items-center justify-center text-white opacity-0 group-hover:opacity-100 transition-opacity">
                              <X size={11} />
                            </button>
                          </div>
                        ))}
                        {images.length < 8 && (
                          <div className="aspect-square rounded-2xl border-2 border-dashed border-border/50 flex items-center justify-center text-muted-foreground hover:border-primary/40 transition-colors">
                            <Plus size={18} />
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  <Textarea
                    value={description}
                    onChange={e => setDescription(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter" && e.metaKey) analyze(); }}
                    placeholder="Describe the item — brand, size, condition, color, anything you know."
                    rows={3}
                    className="rounded-2xl border-border/60 bg-background/50 resize-none text-sm mt-4"
                  />

                  <Button
                    onClick={analyze}
                    disabled={!description.trim() && images.length === 0}
                    className="w-full h-12 rounded-2xl text-sm font-medium gap-2 mt-4"
                    style={{ background: "linear-gradient(135deg, hsl(250 80% 58%), hsl(195 80% 52%), hsl(280 70% 58%))" }}
                  >
                    <Sparkles size={16} />
                    Analyze & Get Prices
                    <ArrowRight size={14} className="ml-auto" />
                  </Button>
                </>
              )}

              {/* DEPOP IMPORT MODE */}
              {mode === "depop" && (
                <div className="space-y-4">
                  <div className="glass-card rounded-3xl p-6 mb-4 border border-border/50">
                    <h3 className="font-semibold text-sm mb-2">Import from Master Listing</h3>
                    <p className="text-xs text-muted-foreground mb-4">Paste your exact Depop link to automatically pull images, title, description, and price seamlessly into your Multi-Platform Sourcing Hub.</p>
                    <Input 
                      placeholder="https://www.depop.com/products/..." 
                      value={depopUrl} onChange={e => setDepopUrl(e.target.value)}
                      className="rounded-xl h-11 border-border/50"
                    />
                  </div>
                  <Button onClick={handleDepopImport} disabled={!depopUrl} className="w-full h-12 rounded-2xl text-sm font-medium gap-2" style={{ background: PLATFORM_COLORS.depop }}>
                    <ArrowRight size={16} />
                    Sync from Depop
                  </Button>
                </div>
              )}

              {/* BATCH MAGIC MODE */}
              {mode === "batch" && (
                <div className="space-y-4">
                  <div className="glass-card rounded-3xl p-6 text-center border-2 border-primary/20 border-dashed">
                    <div className="w-14 h-14 mx-auto rounded-2xl flex items-center justify-center float mb-4"
                      style={{ background: "linear-gradient(135deg, hsl(250 80% 65%), hsl(280 70% 65%))" }}>
                      <Sparkles size={26} className="text-white" />
                    </div>
                    <h3 className="font-semibold text-sm">Batch AI Generator</h3>
                    <p className="text-xs text-muted-foreground mt-1 mb-4">Select up to 20 raw clothing photos. We will remove the background, place them on your trademark background, crop them perfectly, and create AI draft listings for each!</p>
                    
                    <Button onClick={() => fileRef.current?.click()} className="h-10 rounded-xl px-10">Select Photos (Max 20)</Button>
                    <input ref={fileRef} type="file" accept="image/*" multiple className="hidden"
                      onChange={e => handleBatchMagic(e.target.files)} />
                  </div>

                  <div className="glass-card rounded-2xl p-4 bg-muted/10 border border-border/50">
                    <p className="text-xs font-semibold mb-2 text-muted-foreground uppercase">Settings</p>
                    <label className="text-xs font-medium cursor-pointer flex gap-3 items-center">
                       <div className="w-8 h-8 bg-muted rounded-full flex items-center justify-center border border-border shrink-0">🖼️</div>
                       <div>
                         <p>Update Custom Background</p>
                         <p className="text-[10px] text-muted-foreground">Upload your trademark background pattern</p>
                       </div>
                       <input type="file" accept="image/*" className="hidden" onChange={e => e.target.files?.[0] && handleBackgroundUpload(e.target.files[0])} />
                    </label>
                  </div>
                </div>
              )}
            </>
          )}

          {/* ══════════════════════════════════════
              STEP 2: ANALYZING
          ══════════════════════════════════════ */}
          {step === "analyzing" && (
            <div className="glass-card rounded-3xl p-8 flex flex-col items-center gap-5 text-center">
              <div className="w-14 h-14 rounded-2xl flex items-center justify-center float"
                style={{ background: "linear-gradient(135deg, hsl(250 80% 58%), hsl(280 70% 58%))" }}>
                <Sparkles size={24} className="text-white" />
              </div>
              <div>
                <p className="font-semibold text-sm mb-1">{batching ? "Processing Batch Image Magic..." : "Analyzing your item..."}</p>
                <p className="text-xs text-muted-foreground">{batching ? "Stripping backgrounds, positioning on template, generating drafts..." : "Checking prices & fetching details..."}</p>
              </div>
              <div className="w-full space-y-2">
                {batching ? ["Removing backgrounds from photos", "Compositing custom patterns", "Generating descriptions via AI"].map((label, i) => (
                  <div key={label} className="flex items-center gap-3">
                    <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" style={{ animationDelay: `${i * 0.3}s` }} />
                    <Skeleton className="flex-1 h-3 skeleton" style={{ animationDelay: `${i * 0.2}s` }} />
                    <p className="text-xs text-muted-foreground shrink-0">{label}</p>
                  </div>
                )) : ["Identifying brand & details", "Checking live market prices", "Building descriptions"].map((label, i) => (
                  <div key={label} className="flex items-center gap-3">
                    <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" style={{ animationDelay: `${i * 0.3}s` }} />
                    <Skeleton className="flex-1 h-3 skeleton" style={{ animationDelay: `${i * 0.2}s` }} />
                    <p className="text-xs text-muted-foreground shrink-0">{label}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ══════════════════════════════════════
              STEP 3: REVIEW
          ══════════════════════════════════════ */}
          {step === "review" && result && (
            <>
              {/* Item summary */}
              <div className="glass-card rounded-3xl p-5">
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div>
                    <h2 className="text-base font-semibold leading-snug">{result.title}</h2>
                    <div className="flex flex-wrap gap-x-2 gap-y-0.5 mt-1 text-xs text-muted-foreground">
                      {result.brand && result.brand !== "Unknown" && <span className="font-medium text-foreground">{result.brand}</span>}
                      {result.category && <span>· {result.category}</span>}
                      {result.size && <span>· Size {result.size}</span>}
                      {result.condition && <span>· {result.condition}</span>}
                      {result.color && <span>· {result.color}</span>}
                    </div>
                  </div>
                  {result.profitabilityRating && (
                    <span className={`text-[10px] font-bold px-2.5 py-1 rounded-lg shrink-0 uppercase ${
                      result.profitabilityRating === "high"
                        ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                        : "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                    }`}>{result.profitabilityRating}</span>
                  )}
                </div>
                {result.tips && (
                  <p className="text-xs text-muted-foreground bg-primary/5 border border-primary/10 rounded-xl px-3 py-2">
                    💡 {result.tips}
                  </p>
                )}
              </div>

              {/* Cost price → profit preview */}
              <div className="glass-card rounded-3xl p-5">
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block mb-3">
                  За сколько купил? ($)
                </label>
                <div className="flex items-center gap-3">
                  <div className="relative flex-1">
                    <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground text-sm font-medium">$</span>
                    <Input
                      type="number"
                      value={costPrice}
                      onChange={e => setCostPrice(e.target.value)}
                      placeholder="0"
                      className="pl-7 rounded-xl h-11 text-base font-mono"
                      autoFocus
                    />
                  </div>
                  {cost > 0 && (
                    <div className="flex gap-2">
                      {PLATFORMS.map(p => {
                        const pData = result.platforms?.[p];
                        if (!pData) return null;
                        const net = pData.netAfterFees ?? (pData.listPrice * PLATFORM_NETS[p]);
                        const profit = net - cost;
                        return (
                          <div key={p} className="text-center rounded-xl px-2.5 py-1.5 min-w-[52px]"
                            style={{ background: `${PLATFORM_COLORS[p]}18`, border: `1px solid ${PLATFORM_COLORS[p]}33` }}>
                            <p className="text-[9px] font-bold uppercase" style={{ color: PLATFORM_COLORS[p] }}>{p}</p>
                            <p className={`text-xs font-bold font-mono ${profit > 0 ? "text-emerald-500" : "text-red-400"}`}>
                              {profit > 0 ? "+" : ""}{profit.toFixed(0)}
                            </p>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              {/* Platform prices + descriptions */}
              <div className="space-y-3">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-1">
                  Prices & descriptions — copy to each platform
                </p>
                {PLATFORMS.map(p => {
                  const pData = result.platforms?.[p];
                  if (!pData) return null;
                  const net = pData.netAfterFees ?? (pData.listPrice * PLATFORM_NETS[p]);
                  const profit = cost > 0 ? net - cost : null;
                  const textToCopy = `${pData.title}\n\n${pData.description}`;
                  return (
                    <div key={p} className="glass-card rounded-2xl overflow-hidden">
                      <div className="h-1" style={{ background: PLATFORM_COLORS[p] }} />
                      <div className="p-4">
                        {/* Header row */}
                        <div className="flex items-start justify-between gap-3 mb-3">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <span className={`badge-${p} text-[10px] font-bold px-2 py-0.5 rounded-full uppercase`}>{p}</span>
                              <span className="text-[10px] text-muted-foreground">{pData.feeNote}</span>
                            </div>
                            <p className="text-xs font-semibold text-foreground leading-snug">{pData.title}</p>
                          </div>
                          <div className="text-right shrink-0">
                            <p className="text-xl font-bold font-mono">${pData.listPrice}</p>
                            <p className="text-[10px] text-muted-foreground">net ${typeof net === 'number' ? net.toFixed(0) : net}</p>
                            {profit !== null && (
                              <p className={`text-[11px] font-semibold ${profit >= 0 ? "text-emerald-500" : "text-red-400"}`}>
                                {profit >= 0 ? "+" : ""}{profit.toFixed(0)} profit
                              </p>
                            )}
                          </div>
                        </div>

                        {/* Market note */}
                        {pData.marketNote && (
                          <p className="text-[10px] text-primary bg-primary/5 rounded-lg px-2.5 py-1.5 mb-2">
                            📊 {pData.marketNote}
                          </p>
                        )}

                        {/* Description — full, scrollable */}
                        <div className="text-[11px] text-muted-foreground leading-relaxed whitespace-pre-wrap bg-muted/20 rounded-xl p-3 mb-3 max-h-40 overflow-y-auto">
                          {pData.description}
                        </div>

                        {/* Copy button */}
                        <button
                          onClick={() => copy(textToCopy, p)}
                          className="flex items-center gap-2 w-full rounded-xl py-2 px-3 text-xs font-semibold transition-all"
                          style={{
                            background: copied === p ? "#22c55e18" : `${PLATFORM_COLORS[p]}14`,
                            border: `1px solid ${copied === p ? "#22c55e44" : PLATFORM_COLORS[p] + "33"}`,
                            color: copied === p ? "#16a34a" : PLATFORM_COLORS[p],
                          }}
                        >
                          {copied === p ? <CheckCheck size={13} /> : <Copy size={13} />}
                          {copied === p ? "Copied! Paste into " + p : "Copy title + description for " + p}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Hashtags */}
              {result.hashtags?.length > 0 && (
                <div className="glass-card rounded-2xl p-4">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Hashtags</p>
                    <button onClick={() => copy(result.hashtags.join(" "), "hashtags")}
                      className="flex items-center gap-1 text-[11px] font-medium text-primary hover:opacity-70">
                      {copied === "hashtags" ? <CheckCheck size={11} className="text-emerald-500" /> : <Copy size={11} />}
                      {copied === "hashtags" ? "Copied" : "Copy all"}
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {result.hashtags.map((tag: string) => (
                      <span key={tag} className="text-[11px] bg-primary/8 text-primary px-2.5 py-1 rounded-full border border-primary/15">
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* CONFIRM button */}
              <div className="pt-2 pb-6">
                <Button
                  onClick={confirm}
                  disabled={saving}
                  className="w-full h-14 rounded-2xl text-base font-semibold gap-3"
                  style={{ background: "linear-gradient(135deg, hsl(250 80% 58%), hsl(280 70% 58%))" }}
                >
                  {saving ? (
                    <><div className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" /> Saving...</>
                  ) : (
                    <><Check size={18} /> Confirm — save to inventory</>
                  )}
                </Button>
                <p className="text-xs text-muted-foreground text-center mt-2">
                  Auto-assigns a bag number · Appears in Listings
                </p>
                <button onClick={reset} className="text-xs text-muted-foreground hover:text-foreground w-full text-center mt-3">
                  ← Start over
                </button>
              </div>
            </>
          )}

              {/* ══════════════════════════════════════
              STEP 4: SAVED
          ══════════════════════════════════════ */}
          {step === "saved" && (
            <div className="glass-card rounded-3xl p-8 flex flex-col items-center gap-5 text-center">
              <div className="w-16 h-16 rounded-2xl flex items-center justify-center"
                style={{ background: "linear-gradient(135deg, hsl(150 65% 40%), hsl(195 80% 45%))" }}>
                <Check size={32} className="text-white" />
              </div>
              <div>
                <h2 className="text-lg font-semibold mb-1">{batching ? `Successfully created ${batchCount} Items!` : "Saved to inventory!"}</h2>
                {savedBag && (
                  <div className="inline-flex items-center gap-2 bg-primary/10 border border-primary/20 rounded-2xl px-4 py-2 mt-2">
                    <Package size={16} className="text-primary" />
                    <span className="font-bold text-primary">Bag #{savedBag}</span>
                    <span className="text-xs text-muted-foreground">assigned</span>
                  </div>
                )}
              </div>

              <div className="glass rounded-2xl p-4 text-left w-full space-y-2">
                <p className="text-xs font-semibold mb-1">Next steps:</p>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="w-5 h-5 rounded-full bg-primary/20 text-primary text-[10px] font-bold flex items-center justify-center shrink-0">1</span>
                  List on your platforms using the descriptions above
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="w-5 h-5 rounded-full bg-primary/20 text-primary text-[10px] font-bold flex items-center justify-center shrink-0">2</span>
                  When sold → go to Listings → mark as Sold → enter net amount received
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="w-5 h-5 rounded-full bg-primary/20 text-primary text-[10px] font-bold flex items-center justify-center shrink-0">3</span>
                  {savedBag ? `Grab Bag #${savedBag} → go to USPS → show QR code → label prints` : "Go to USPS with bag → show QR → print label"}
                </div>
              </div>

              <div className="flex gap-3 w-full">
                <Button variant="outline" className="flex-1 rounded-xl" onClick={() => navigate("/listings")}>
                  View in Listings
                </Button>
                <Button className="flex-1 rounded-xl gap-2"
                  style={{ background: "linear-gradient(135deg, hsl(250 80% 58%), hsl(280 70% 58%))" }}
                  onClick={reset}>
                  <Plus size={15} /> Add another
                </Button>
              </div>
            </div>
          )}

        </div>
      </main>
    </div>
  );
}
