import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import type { FormEvent } from "react";
import { useEffect, useId, useRef, useState } from "react";
import { useCart } from "../lib/cart";
import { api, type Category } from "../lib/api";
import { withStoreDefaults, type StoreContent } from "../lib/store";

export function StoreHeader() {
  const { count } = useCart();
  const navigate = useNavigate();
  const location = useLocation();
  const menuId = useId();
  const [q, setQ] = useState("");
  const [categories, setCategories] = useState<Category[]>([]);
  const [store, setStore] = useState(withStoreDefaults());
  const [compact, setCompact] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [chromeHeight, setChromeHeight] = useState(0);

  const sentinelRef = useRef<HTMLDivElement>(null);
  const chromeRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const menuSearchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api<{ categories: Category[] }>("/api/categories")
      .then((d) => setCategories(d.categories))
      .catch(() => {});
    api<StoreContent>("/api/store")
      .then((d) => setStore(withStoreDefaults(d)))
      .catch(() => {});
  }, []);

  // Compact only after real scroll — keep topbar + category chips at page top
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        setCompact(!entry.isIntersecting);
      },
      { threshold: 0, rootMargin: "0px" },
    );
    io.observe(sentinel);
    return () => io.disconnect();
  }, []);

  // Spacer matches fixed header height so page content never jumps under it
  useEffect(() => {
    const el = chromeRef.current;
    if (!el) return;
    const measure = () => setChromeHeight(el.getBoundingClientRect().height);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [compact, menuOpen]);

  // Close drawer on navigation
  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname, location.search]);

  // Lock body scroll while menu is open
  useEffect(() => {
    if (!menuOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [menuOpen]);

  useEffect(() => {
    if (!menuOpen) return;
    const t = window.setTimeout(() => menuSearchRef.current?.focus(), 50);
    return () => window.clearTimeout(t);
  }, [menuOpen]);

  function onSearch(e: FormEvent) {
    e.preventDefault();
    navigate(q.trim() ? `/shop?q=${encodeURIComponent(q.trim())}` : "/shop");
    setMenuOpen(false);
  }

  function openMenu() {
    setMenuOpen(true);
  }

  function closeMenu() {
    setMenuOpen(false);
  }

  return (
    <>
      <div ref={sentinelRef} className="site-chrome-sentinel" aria-hidden="true" />
      <div
        className="site-chrome-spacer"
        style={{ height: chromeHeight || undefined }}
        aria-hidden="true"
      />

      <div
        ref={chromeRef}
        className={`site-chrome${compact ? " is-compact" : ""}${menuOpen ? " menu-open" : ""}`}
      >
        <div className="topbar">{store.topbar_text}</div>
        <header className="site-header">
          <div className="shell header-shell">
            <div className="header-row">
              <button
                type="button"
                className="icon-btn menu-toggle"
                aria-label={menuOpen ? "Close menu" : "Open menu"}
                aria-expanded={menuOpen}
                aria-controls={menuId}
                onClick={() => (menuOpen ? closeMenu() : openMenu())}
              >
                <span className="menu-toggle-bars" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                </span>
              </button>

              <Link to="/" className="brand" onClick={closeMenu}>
                <span className="brand-mark">{store.brand_name}</span>
                <span className="brand-sub">{store.brand_sub}</span>
              </Link>

              <form className="search-wrap search-wrap-desktop" onSubmit={onSearch}>
                <input
                  ref={searchInputRef}
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Search sofas, tables, desks, odds & ends…"
                  aria-label="Search products"
                />
                <button type="submit">Search</button>
              </form>

              <div className="header-actions">
                <button
                  type="button"
                  className="icon-btn search-launch"
                  aria-label="Search"
                  onClick={openMenu}
                >
                  Search
                </button>
                <Link className="icon-btn hide-sm" to="/auctions">
                  Auctions
                </Link>
                <Link className="icon-btn" to="/account">
                  Account
                </Link>
                <Link className="icon-btn hide-sm" to="/orders">
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

        <div
          className="nav-drawer-backdrop"
          hidden={!menuOpen}
          onClick={closeMenu}
          aria-hidden="true"
        />
        <aside
          id={menuId}
          className="nav-drawer"
          aria-hidden={!menuOpen}
          aria-label="Store menu"
        >
          <div className="nav-drawer-head">
            <strong>Menu</strong>
            <button type="button" className="icon-btn" onClick={closeMenu}>
              Close
            </button>
          </div>
          <form className="search-wrap search-wrap-drawer" onSubmit={onSearch}>
            <input
              ref={menuSearchRef}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search furniture…"
              aria-label="Search products"
            />
            <button type="submit">Go</button>
          </form>
          <nav className="nav-drawer-links">
            <Link to="/shop" onClick={closeMenu}>
              Shop all
            </Link>
            <Link to="/auctions" onClick={closeMenu}>
              Auctions
            </Link>
            <Link to="/account" onClick={closeMenu}>
              Account
            </Link>
            <Link to="/orders" onClick={closeMenu}>
              Track order
            </Link>
            <Link to="/cart" onClick={closeMenu}>
              Cart{count > 0 ? ` (${count})` : ""}
            </Link>
          </nav>
          {categories.length > 0 && (
            <div className="nav-drawer-cats">
              <p className="nav-drawer-label">Categories</p>
              {categories.map((c) => (
                <Link key={c.id} to={`/shop?category=${c.slug}`} onClick={closeMenu}>
                  {c.name}
                </Link>
              ))}
            </div>
          )}
        </aside>
      </div>
    </>
  );
}

export function StoreFooter() {
  const [store, setStore] = useState(withStoreDefaults());

  useEffect(() => {
    api<StoreContent>("/api/store")
      .then((d) => setStore(withStoreDefaults(d)))
      .catch(() => {});
  }, []);

  const fullName = `${store.brand_name} ${store.brand_sub}`.trim();

  return (
    <footer className="site-footer">
      <div className="shell footer-grid">
        <div>
          <h3>{fullName}</h3>
          <p style={{ margin: 0, color: "#b7c0ba" }}>{store.footer_blurb}</p>
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
            <Link to="/claims">Return / damage claim</Link>
            <br />
            <a href={`mailto:${store.store_email || "hello@hamiltonsoddsandends.com"}`}>
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
        <div className="meta">{product.brand || "Hamilton's Odds N Ends"}</div>
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
