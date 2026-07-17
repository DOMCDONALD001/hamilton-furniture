import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { ReactNode } from "react";
import type { CartItem } from "./api";

function lineKey(productId: string, color?: string | null) {
  return `${productId}::${color || ""}`;
}

type CartCtx = {
  items: CartItem[];
  add: (item: Omit<CartItem, "quantity">, qty?: number) => void;
  setQty: (productId: string, quantity: number, color?: string | null) => void;
  remove: (productId: string, color?: string | null) => void;
  clear: () => void;
  count: number;
  subtotal: number;
};

const CartContext = createContext<CartCtx | null>(null);
const KEY = "hamilton_cart_v1";

export function CartProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<CartItem[]>(() => {
    try {
      const raw = localStorage.getItem(KEY);
      return raw ? (JSON.parse(raw) as CartItem[]) : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    localStorage.setItem(KEY, JSON.stringify(items));
  }, [items]);

  const add = useCallback((item: Omit<CartItem, "quantity">, qty = 1) => {
    setItems((prev) => {
      const key = lineKey(item.product_id, item.color);
      const existing = prev.find((p) => lineKey(p.product_id, p.color) === key);
      if (existing) {
        return prev.map((p) =>
          lineKey(p.product_id, p.color) === key
            ? { ...p, quantity: p.quantity + qty }
            : p,
        );
      }
      return [...prev, { ...item, quantity: qty }];
    });
  }, []);

  const setQty = useCallback((productId: string, quantity: number, color?: string | null) => {
    const key = lineKey(productId, color);
    setItems((prev) =>
      prev
        .map((p) =>
          lineKey(p.product_id, p.color) === key ? { ...p, quantity } : p,
        )
        .filter((p) => p.quantity > 0),
    );
  }, []);

  const remove = useCallback((productId: string, color?: string | null) => {
    const key = lineKey(productId, color);
    setItems((prev) => prev.filter((p) => lineKey(p.product_id, p.color) !== key));
  }, []);

  const clear = useCallback(() => setItems([]), []);

  const value = useMemo(
    () => ({
      items,
      add,
      setQty,
      remove,
      clear,
      count: items.reduce((s, i) => s + i.quantity, 0),
      subtotal: items.reduce((s, i) => s + i.price_cents * i.quantity, 0),
    }),
    [items, add, setQty, remove, clear],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart outside provider");
  return ctx;
}
