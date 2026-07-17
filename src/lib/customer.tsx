import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { api } from "./api";

export type Customer = {
  id: string;
  email: string;
  name: string;
  phone: string | null;
};

type CustomerCtx = {
  customer: Customer | null;
  loading: boolean;
  refresh: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  register: (data: {
    name: string;
    email: string;
    password: string;
    phone?: string;
  }) => Promise<void>;
  logout: () => Promise<void>;
};

const Ctx = createContext<CustomerCtx | null>(null);

export function CustomerProvider({ children }: { children: ReactNode }) {
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const data = await api<{ customer: Customer | null }>("/api/account/me");
      setCustomer(data.customer);
    } catch {
      setCustomer(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const login = useCallback(async (email: string, password: string) => {
    const data = await api<{ customer: Customer }>("/api/account/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    setCustomer(data.customer);
  }, []);

  const register = useCallback(
    async (payload: { name: string; email: string; password: string; phone?: string }) => {
      const data = await api<{ customer: Customer }>("/api/account/register", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      setCustomer(data.customer);
    },
    [],
  );

  const logout = useCallback(async () => {
    await api("/api/account/logout", { method: "POST" });
    setCustomer(null);
  }, []);

  const value = useMemo(
    () => ({ customer, loading, refresh, login, register, logout }),
    [customer, loading, refresh, login, register, logout],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCustomer() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useCustomer outside provider");
  return ctx;
}
