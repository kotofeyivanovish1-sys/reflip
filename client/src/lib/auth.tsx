import { createContext, useContext, useState, useEffect, ReactNode } from "react";

interface AuthUser { id: number; email: string; name?: string; }
interface AuthCtx {
  user: AuthUser | null;
  token: string | null;
  login: (u: AuthUser, t: string) => void;
  logout: () => void;
  loading: boolean;
}

const AuthContext = createContext<AuthCtx>({
  user: null, token: null,
  login: () => {}, logout: () => {},
  loading: true,
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Restore session from localStorage on mount
  useEffect(() => {
    try {
      const savedToken = localStorage.getItem("reflip_token");
      const savedUser = localStorage.getItem("reflip_user");
      if (savedToken && savedUser) {
        setToken(savedToken);
        setUser(JSON.parse(savedUser));
      }
    } catch {}
    setLoading(false);
  }, []);

  const login = (u: AuthUser, t: string) => {
    setUser(u);
    setToken(t);
    try {
      localStorage.setItem("reflip_token", t);
      localStorage.setItem("reflip_user", JSON.stringify(u));
    } catch {}
  };

  const logout = () => {
    setUser(null);
    setToken(null);
    try {
      localStorage.removeItem("reflip_token");
      localStorage.removeItem("reflip_user");
    } catch {}
  };

  return (
    <AuthContext.Provider value={{ user, token, login, logout, loading }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
