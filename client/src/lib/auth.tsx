import { createContext, useContext, useState, ReactNode } from "react";

interface AuthUser { id: number; email: string; name?: string; }
interface AuthCtx { user: AuthUser | null; token: string | null; login: (u: AuthUser, t: string) => void; logout: () => void; loading: boolean; }

const AuthContext = createContext<AuthCtx>({ user: null, token: null, login: () => {}, logout: () => {}, loading: false });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(null);

  const login = (u: AuthUser, t: string) => { setUser(u); setToken(t); };
  const logout = () => { setUser(null); setToken(null); };

  return <AuthContext.Provider value={{ user, token, login, logout, loading: false }}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
