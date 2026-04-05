import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/lib/auth";
import { Lock, Sparkles } from "lucide-react";

const CORRECT_PASSWORD = "Kitti29032002";

export default function Auth() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState(false);
  const [shake, setShake] = useState(false);
  const { login } = useAuth();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (password === CORRECT_PASSWORD) {
      login({ id: 1, email: "owner", name: "ReFlip" }, "owner-token");
    } else {
      setError(true);
      setShake(true);
      setTimeout(() => setShake(false), 600);
      setTimeout(() => setError(false), 2000);
      setPassword("");
    }
  };

  return (
    <div className="min-h-screen gradient-mesh flex items-center justify-center p-6">
      {/* Background orbs */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-[-20%] left-[-10%] w-[600px] h-[600px] rounded-full float"
          style={{ background: "radial-gradient(circle, hsl(250 80% 65% / 0.3) 0%, transparent 70%)" }} />
        <div className="absolute bottom-[-10%] right-[-5%] w-[500px] h-[500px] rounded-full float"
          style={{ background: "radial-gradient(circle, hsl(195 80% 60% / 0.3) 0%, transparent 70%)", animationDelay: "2s" }} />
        <div className="absolute top-[40%] right-[20%] w-[300px] h-[300px] rounded-full float"
          style={{ background: "radial-gradient(circle, hsl(280 70% 60% / 0.2) 0%, transparent 70%)", animationDelay: "1s" }} />
      </div>

      <div className={`w-full max-w-sm relative z-10 slide-up ${shake ? "animate-bounce" : ""}`}>
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex flex-col items-center gap-4 mb-6">
            <div className="w-16 h-16 rounded-3xl flex items-center justify-center float"
              style={{ background: "linear-gradient(135deg, hsl(250 80% 58%), hsl(195 80% 55%), hsl(280 70% 60%))" }}>
              <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
                <path d="M7 8h8a5 5 0 0 1 0 10H7V8Z" stroke="white" strokeWidth="2.5" fill="none" />
                <path d="M13 18l6 4" stroke="white" strokeWidth="2.5" strokeLinecap="round" />
              </svg>
            </div>
            <div>
              <h1 className="text-3xl font-light tracking-tight">
                Re<span className="gradient-text font-medium">Flip</span>
              </h1>
              <p className="text-xs text-muted-foreground mt-1">Reseller Intelligence</p>
            </div>
          </div>
        </div>

        {/* Card */}
        <div className="glass-card rounded-3xl p-7">
          <div className="flex items-center gap-2 mb-5">
            <div className="w-7 h-7 rounded-xl bg-muted flex items-center justify-center">
              <Lock size={13} className="text-muted-foreground" />
            </div>
            <p className="text-sm font-medium">Enter password to continue</p>
          </div>

          <form onSubmit={submit} className="space-y-3">
            <Input
              type="password"
              value={password}
              onChange={e => { setPassword(e.target.value); setError(false); }}
              placeholder="••••••••••••"
              autoFocus
              className={`rounded-2xl h-12 text-base tracking-widest border-2 transition-colors ${
                error ? "border-red-400 bg-red-50 dark:bg-red-900/10" : "border-border/60 bg-background/50"
              }`}
            />
            {error && (
              <p className="text-xs text-red-500 text-center">Incorrect password</p>
            )}
            <Button
              type="submit"
              className="w-full h-12 rounded-2xl text-sm font-medium"
              style={{ background: "linear-gradient(135deg, hsl(250 80% 58%), hsl(280 70% 60%))" }}
            >
              Enter
            </Button>
          </form>
        </div>

        <div className="mt-5 glass rounded-2xl px-4 py-3 flex items-center gap-2.5">
          <Sparkles size={14} className="text-primary shrink-0" />
          <p className="text-xs text-muted-foreground">Your private reselling dashboard</p>
        </div>
      </div>
    </div>
  );
}
