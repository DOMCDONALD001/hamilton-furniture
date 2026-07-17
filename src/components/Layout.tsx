import { Link, NavLink, useNavigate } from "react-router-dom";
import type { FormEvent } from "react";
import { useEffect, useState } from "react";
import { useCart } from "../lib/cart";
import { api, type Category } from "../lib/api";

export function StoreHeader() {
  const { count } = useCart();
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [categories, setCategories] = useState<Category[]>([]);

  useEffect(() => {
    api<{ categories: Category[] }>("/api/categories")
      .then((d) => setCategories(d.categories))
      .catch(() => {});
  }, []);

  function onSearch(e: FormEvent) {
    e.preventDefault();
    navigate(q.trim() ? `/shop?q=${encodeURIComponent(q.trim())}` : "/shop");
  }

  return (
    <>
      <div className="topbar">
        Local delivery across the Hamilton area · Members: use <strong>MEMBER15</strong> · Guests:{" "}
        <strong>WELCOME10</strong>
      </div>
      <header className="site-header">
        <div className="shell">
          <div className="header-row">
            <Link to="/" className="brand">
              <span className="brand-mark">Hamilton Odds N Ends</span>
              <span className="brand-sub">Furniture</span>
            </Link>
            <form className="search-wrap" onSubmit={onSearch}>
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search sofas, tables, desks, odds & ends…"
                aria-label="Search products"
              />
              <button type="submit">Search</button>
            </form>
            <div className="header-actions">
              <Link className="icon-btn" to="/auctions">
                Auctions
              </Link>
              <Link className="icon-btn" to="/account">
                Account
              </Link>
              <Link className="icon-btn" to="/orders">
                Track order
              </Link>
              <Link className="icon-btn" to="/cart">
                Cart
                {count > 0 && <span className="badge">{count}</span>}
              </Link>
            </div>
          </div>
          <nav className="nav-cats" aria-label="Categories">
            <NavLink to="/shop" className={({ isActive }) => `chip ${isActive ? "active" : ""}`} end>
              All
            </NavLink>
            <NavLink to="/auctions" className={({ isActive }) => `chip ${isActive ? "active" : ""}`}>
              Auctions
            </NavLink>
            {categories.map((c) => (
              <NavLink
                key={c.id}
                to={`/shop?category=${c.slug}`}
                className={({ isActive }) => `chip ${isActive ? "active" : ""}`}
              >
                {c.name}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>
    </>
  );
}

export function StoreFooter() {
  const [store, setStore] = useState<{
    store_phone?: string;
    store_email?: string;
    store_address?: string;
  }>({});

  useEffect(() => {
    api<typeof store>("/api/store").then(setStore).catch(() => {});
  }, []);

  return (
    <footer className="site-footer">
      <div className="shell footer-grid">
        <div>
          <h3>Hamilton Odds N Ends Furniture</h3>
          <p style={{ margin: 0, color: "#b7c0ba" }}>
            Quality furniture and unique finds for every room — buy, sell, and deliver
            with a hometown marketplace feel.
          </p>
        </div>
        <div>
          <h3>Visit</h3>
          <p style={{ margin: 0, color: "#b7c0ba" }}>{store.store_address}</p>
          <p style={{ margin: "0.4rem 0 0", color: "#b7c0ba" }}>{store.store_phone}</p>
        </div>
        <div>
          <h3>Help</h3>
          <p style={{ margin: 0 }}>
            <Link to="/shop">Shop inventory</Link>
            <br />
            <Link to="/orders">Track an order</Link>
            <br />
            <a href={`mailto:${store.store_email || "hello@hamiltonoddsnends.com"}`}>
              {store.store_email || "Email us"}
            </a>
          </p>
        </div>
      </div>
    </footer>
  );
}

export function ProductCard({
  product,
}: {
  product: {
    id: string;
    name: string;
    slug: string;
    price_cents: number;
    compare_at_cents: number | null;
    condition: string;
    primary_image?: string | null;
    brand?: string | null;
  };
}) {
  const onSale =
    product.compare_at_cents != null && product.compare_at_cents > product.price_cents;
  return (
    <Link to={`/product/${product.slug}`} className="product-card">
      <div className="thumb">
        <img
          src={product.primary_image || "/api/images/placeholder"}
          alt={product.name}
          loading="lazy"
        />
        <span className="pill">{product.condition.replace("_", " ")}</span>
        {onSale && <span className="pill sale">Sale</span>}
      </div>
      <div className="product-body">
        <div className="meta">{product.brand || "Hamilton Odds N Ends"}</div>
        <h3>{product.name}</h3>
        <div className="price-row">
          <span className="price">
            {(product.price_cents / 100).toLocaleString("en-US", {
              style: "currency",
              currency: "USD",
            })}
          </span>
          {onSale && (
            <span className="price-was">
              {(product.compare_at_cents! / 100).toLocaleString("en-US", {
                style: "currency",
                currency: "USD",
              })}
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}
