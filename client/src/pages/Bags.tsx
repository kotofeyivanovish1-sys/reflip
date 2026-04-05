import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Package, QrCode, CheckCircle, Clock, Tag, X, Download, Search } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { Input } from "@/components/ui/input";

interface BagWithItem {
  id: number;
  bagNumber: number;
  createdAt: string;
  item?: {
    id: number;
    title: string;
    brand?: string;
    size?: string;
    condition?: string;
    status: string;
    platform: string;
    listedPrice?: number;
    soldPrice?: number;
    costPrice: number;
  };
}

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  active:  { label: "Listed",  color: "text-indigo-500",  bg: "bg-indigo-50 dark:bg-indigo-900/20" },
  pending: { label: "Pending", color: "text-amber-600",   bg: "bg-amber-50 dark:bg-amber-900/20" },
  sold:    { label: "Sold",    color: "text-emerald-500", bg: "bg-emerald-50 dark:bg-emerald-900/20" },
  draft:   { label: "Draft",  color: "text-muted-foreground", bg: "bg-muted" },
};

export default function Bags() {
  const [qrBag, setQrBag] = useState<BagWithItem | null>(null);
  const [qrData, setQrData] = useState<{ qrDataUrl: string; label: string } | null>(null);
  const [qrLoading, setQrLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");

  const { data: bags = [], isLoading } = useQuery<BagWithItem[]>({
    queryKey: ["/api/bags"],
    queryFn: () => apiRequest("GET", "/api/bags").then(r => r.json()),
  });

  const openQR = async (bag: BagWithItem) => {
    setQrBag(bag);
    setQrData(null);
    setQrLoading(true);
    try {
      const r = await apiRequest("GET", `/api/bags/${bag.bagNumber}/qr`);
      const data = await r.json();
      setQrData(data);
    } catch {} finally { setQrLoading(false); }
  };

  const downloadQR = () => {
    if (!qrData) return;
    const a = document.createElement("a");
    a.href = qrData.qrDataUrl;
    a.download = `bag-${qrBag?.bagNumber}.png`;
    a.click();
  };

  const filtered = bags.filter(b => {
    const matchSearch = !search ||
      String(b.bagNumber).includes(search) ||
      b.item?.title?.toLowerCase().includes(search.toLowerCase()) ||
      b.item?.brand?.toLowerCase().includes(search.toLowerCase());
    const matchStatus = filterStatus === "all" || b.item?.status === filterStatus;
    return matchSearch && matchStatus;
  });

  const counts = {
    total: bags.length,
    active: bags.filter(b => b.item?.status === "active").length,
    pending: bags.filter(b => b.item?.status === "pending").length,
    sold: bags.filter(b => b.item?.status === "sold").length,
  };

  return (
    <div className="flex flex-col h-full">
      <header className="flex items-center justify-between gap-3 px-6 py-4 border-b border-border/50 sticky top-0 bg-background/80 backdrop-blur-xl z-10">
        <div className="flex items-center gap-3">
          <SidebarTrigger />
          <div>
            <h1 className="text-base font-semibold">My Bags</h1>
            <p className="text-xs text-muted-foreground">{counts.total} bags · 1 item per bag</p>
          </div>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto px-6 py-6 space-y-5">
        {/* Stats strip */}
        <div className="grid grid-cols-4 gap-3">
          {[
            { label: "Total bags", value: counts.total, color: "hsl(250 80% 60%)" },
            { label: "Listed", value: counts.active, color: "hsl(250 80% 60%)" },
            { label: "Pending", value: counts.pending, color: "hsl(35 90% 55%)" },
            { label: "Sold", value: counts.sold, color: "hsl(150 65% 45%)" },
          ].map(s => (
            <div key={s.label} className="glass-card rounded-2xl p-4 text-center">
              <p className="text-xl font-bold font-mono" style={{ color: s.color }}>{s.value}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{s.label}</p>
            </div>
          ))}
        </div>

        {/* Filters */}
        <div className="flex gap-3 items-center">
          <div className="relative flex-1 max-w-xs">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search bag # or item..."
              className="pl-8 rounded-xl h-9 text-sm"
            />
          </div>
          <div className="flex gap-1">
            {["all", "pending", "active", "sold"].map(s => (
              <button key={s} onClick={() => setFilterStatus(s)}
                className={`text-xs px-3 py-1.5 rounded-full font-medium transition-colors ${
                  filterStatus === s
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:text-foreground"
                }`}>
                {s === "all" ? "All" : STATUS_CONFIG[s]?.label}
              </button>
            ))}
          </div>
        </div>

        {/* Bags grid */}
        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-40 rounded-2xl skeleton" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div className="w-16 h-16 rounded-3xl bg-muted flex items-center justify-center mb-4">
              <Package size={28} className="text-muted-foreground/40" />
            </div>
            <p className="font-medium text-sm mb-1">No bags yet</p>
            <p className="text-xs text-muted-foreground">Every item you add gets its own bag number automatically</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.sort((a, b) => b.bagNumber - a.bagNumber).map(bag => {
              const item = bag.item;
              const status = item?.status || "empty";
              const cfg = STATUS_CONFIG[status];
              const profit = item?.soldPrice ? item.soldPrice - item.costPrice : null;

              return (
                <div key={bag.bagNumber}
                  className={`glass-card rounded-2xl p-4 relative overflow-hidden group transition-all duration-200 hover:scale-[1.02] ${status === "sold" ? "opacity-75" : ""}`}
                  data-testid={`bag-${bag.bagNumber}`}>

                  {/* Top accent bar based on status */}
                  <div className="absolute top-0 left-0 right-0 h-0.5 rounded-t-2xl"
                    style={{ background: status === "sold" ? "hsl(150 65% 45%)" : status === "active" ? "hsl(250 80% 60%)" : "hsl(35 90% 55%)" }} />

                  {/* Bag number badge */}
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <div className="w-10 h-10 rounded-2xl flex items-center justify-center text-white font-bold text-sm shrink-0"
                        style={{ background: "linear-gradient(135deg, hsl(250 80% 58%), hsl(280 70% 58%))" }}>
                        #{bag.bagNumber}
                      </div>
                      <div>
                        <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">Bag</p>
                        <p className="text-xs text-muted-foreground">{bag.createdAt?.split("T")[0]}</p>
                      </div>
                    </div>
                    {cfg && (
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${cfg.bg} ${cfg.color}`}>
                        {cfg.label}
                      </span>
                    )}
                  </div>

                  {/* Item info */}
                  {item ? (
                    <div className="space-y-1.5">
                      <p className="text-sm font-medium leading-tight line-clamp-2">{item.title}</p>
                      <div className="flex flex-wrap gap-1.5 text-[10px]">
                        {item.brand && <span className="bg-muted px-2 py-0.5 rounded-full">{item.brand}</span>}
                        {item.size && <span className="bg-muted px-2 py-0.5 rounded-full">Size {item.size}</span>}
                        <span className={`badge-${item.platform} px-2 py-0.5 rounded-full font-semibold uppercase`}>{item.platform}</span>
                      </div>

                      <div className="flex items-center justify-between mt-2">
                        <div className="text-xs">
                          {item.listedPrice && <span className="font-mono font-semibold">${item.listedPrice}</span>}
                          {profit !== null && (
                            <span className="text-emerald-500 font-medium ml-2">+${profit.toFixed(0)} profit</span>
                          )}
                        </div>
                        {/* QR button */}
                        <button
                          onClick={() => openQR(bag)}
                          className="flex items-center gap-1 text-[10px] font-medium text-primary hover:text-primary/70 transition-colors"
                          data-testid={`qr-btn-${bag.bagNumber}`}>
                          <QrCode size={13} />
                          QR
                        </button>
                      </div>

                      {/* SOLD alert */}
                      {status === "sold" && (
                        <div className="mt-2 bg-emerald-50 dark:bg-emerald-900/20 rounded-xl p-2.5 flex items-center gap-2">
                          <CheckCircle size={13} className="text-emerald-500 shrink-0" />
                          <div>
                            <p className="text-[10px] font-semibold text-emerald-700 dark:text-emerald-400">SOLD — Ship this bag</p>
                            <p className="text-[10px] text-emerald-600/70">Show QR at USPS to print label</p>
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground italic">Empty bag</p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </main>

      {/* QR Dialog */}
      <Dialog open={!!qrBag} onOpenChange={() => { setQrBag(null); setQrData(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <QrCode size={16} className="text-primary" />
              Bag #{qrBag?.bagNumber}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            {/* Item info */}
            {qrBag?.item && (
              <div className="bg-muted/40 rounded-2xl p-3">
                <p className="text-sm font-semibold">{qrBag.item.title}</p>
                <div className="flex gap-2 mt-1 text-xs text-muted-foreground">
                  {qrBag.item.brand && <span>{qrBag.item.brand}</span>}
                  {qrBag.item.size && <span>· Size {qrBag.item.size}</span>}
                  <span>· {qrBag.item.platform}</span>
                </div>
              </div>
            )}

            {/* QR Code */}
            <div className="flex flex-col items-center gap-3">
              {qrLoading ? (
                <div className="w-48 h-48 rounded-2xl skeleton flex items-center justify-center">
                  <p className="text-xs text-muted-foreground">Generating...</p>
                </div>
              ) : qrData ? (
                <>
                  <div className="p-3 bg-white rounded-2xl shadow-lg">
                    <img src={qrData.qrDataUrl} alt={`Bag #${qrBag?.bagNumber} QR`} className="w-44 h-44" />
                  </div>
                  <div className="text-center">
                    <p className="text-xs font-mono font-bold">BAG #{qrBag?.bagNumber}</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">Show this at USPS — they'll scan & print your label</p>
                  </div>
                  <Button onClick={downloadQR} size="sm" className="gap-2 rounded-xl w-full">
                    <Download size={13} /> Save QR to phone
                  </Button>
                </>
              ) : null}
            </div>

            {/* USPS tip */}
            <div className="glass rounded-xl p-3 text-xs text-muted-foreground space-y-1">
              <p className="font-semibold text-foreground text-[11px]">How to use at USPS:</p>
              <p>1. Sell item → app shows "Ship bag #N"</p>
              <p>2. Go to USPS with the bag</p>
              <p>3. Show QR on phone → they scan → label prints</p>
              <p>4. Tape label on bag and hand it over</p>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
