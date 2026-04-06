import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/lib/auth";
import { Sparkles, Eye, EyeOff, ArrowRight, User, Mail, Lock } from "lucide-react";

type Mode = "login" | "register";

export default function Auth() {
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const { login } = useAuth();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const endpoint = mode === "login" ? "/api/auth/login" : "/api/auth/register";
      const body: any = { email: email.trim().toLowerCase(), password };
      if (mode === "register" && name.trim()) body.name = name.trim();

      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Something went wrong");
        return;
      }
      login(data.user, data.token);
    } catch {
      setError("Network error — check your connection");
    } finally {
      setLoading(false);
    }
  };

  const switchMode = () => {
    setMode(m => m === "login" ? "register" : "login");
    setError("");
    setEmail("");
    setPassword("");
    setName("");
  };

  return (
    <div className="min-h-screen gradient-mesh flex items-center justify-center p-4">
      {/* Background orbs */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-[-20%] left-[-10%] w-[600px] h-[600px] rounded-full float"
          style={{ background: "radial-gradient(circle, hsl(250 80% 65% / 0.3) 0%, transparent 70%)" }} />
        <div className="absolute bottom-[-10%] right-[-5%] w-[500px] h-[500px] rounded-full float"
          style={{ background: "radial-gradient(circle, hsl(195 80% 60% / 0.3) 0%, transparent 70%)", animationDelay: "2s" }} />
        <div className="absolute top-[40%] right-[20%] w-[300px] h-[300px] rounded-full float"
          style={{ background: "radial-gradient(circle, hsl(280 70% 60% / 0.2) 0%, transparent 70%)", animationDelay: "1s" }} />
      </div>

      <div className="w-full max-w-sm relative z-10 slide-up">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex flex-col items-center gap-3">
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
              <p className="text-xs text-muted-foreground mt-0.5">Reseller Intelligence</p>
            </div>
          </div>
        </div>

        {/* Mode tabs */}
        <div className="glass rounded-2xl p-1 flex gap-1 mb-4">
          <button
            onClick={() => setMode("login")}
            className={`flex-1 text-sm py-2 rounded-xl font-medium transition-all duration-200 ${
              mode === "login"
                ? "bg-background shadow-sm text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Sign in
          </button>
          <button
            onClick={() => setMode("register")}
            className={`flex-1 text-sm py-2 rounded-xl font-medium transition-all duration-200 ${
              mode === "register"
                ? "bg-background shadow-sm text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Create account
          </button>
        </div>

        {/* Card */}
        <div className="glass-card rounded-3xl p-6">
          <form onSubmit={submit} className="space-y-3">
            {/* Name field — only for register */}
            {mode === "register" && (
              <div className="relative slide-up">
                <User size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  type="text"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="Your name (optional)"
                  className="pl-9 rounded-2xl h-12 text-sm border-border/60 bg-background/50"
                  autoComplete="name"
                />
              </div>
            )}

            {/* Email */}
            <div className="relative">
              <Mail size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="email"
                value={email}
                onChange={e => { setEmail(e.target.value); setError(""); }}
                placeholder="your@email.com"
                required
                autoFocus={mode === "login"}
                autoComplete="email"
                className="pl-9 rounded-2xl h-12 text-sm border-border/60 bg-background/50"
              />
            </div>

            {/* Password */}
            <div className="relative">
              <Lock size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={e => { setPassword(e.target.value); setError(""); }}
                placeholder={mode === "register" ? "Min 6 characters" : "••••••••"}
                required
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                className="pl-9 pr-10 rounded-2xl h-12 text-sm border-border/60 bg-background/50"
              />
              <button
                type="button"
                onClick={() => setShowPassword(v => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
              >
                {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>

            {/* Error */}
            {error && (
              <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl px-3 py-2">
                <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
              </div>
            )}

            {/* Submit */}
            <Button
              type="submit"
              disabled={loading || !email || !password}
              className="w-full h-12 rounded-2xl text-sm font-medium gap-2 mt-1"
              style={{ background: "linear-gradient(135deg, hsl(250 80% 58%), hsl(280 70% 60%))" }}
            >
              {loading ? (
                <div className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
              ) : (
                <>
                  {mode === "login" ? "Sign in" : "Create account"}
                  <ArrowRight size={15} />
                </>
              )}
            </Button>
          </form>
        </div>

        {/* Bottom hint */}
        <div className="mt-4 glass rounded-2xl px-4 py-3 flex items-center gap-2.5">
          <Sparkles size={14} className="text-primary shrink-0" />
          <p className="text-xs text-muted-foreground">
            {mode === "login"
              ? "Your listings and history are saved to your account"
              : "Your data stays private and syncs across devices"}
          </p>
        </div>
      </div>
    </div>
  );
}
