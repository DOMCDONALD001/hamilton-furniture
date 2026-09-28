import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, type Category, type Product } from "../lib/api";
import { ProductCard } from "../components/Layout";

export function ShopPage() {
  const [params, setParams] = useSearchParams();
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const q = params.get("q") || "";
  const category = params.get("category") || "";
  const sort = params.get("sort") || "newest";
  const condition = params.get("condition") || "";
  const min = params.get("min") || "";
  const max = params.get("max") || "";

  const activeFilterCount = useMemo(() => {
    let n = 0;
    if (category) n += 1;
    if (condition) n += 1;
    if (min) n += 1;
    if (max) n += 1;
    if (sort && sort !== "newest") n += 1;
    return n;
  }, [category, condition, min, max, sort]);

  useEffect(() => {
    api<{ categories: Category[] }>("/api/categories").then((d) =>
      setCategories(d.categories),
    );
  }, []);

  useEffect(() => {
    setLoading(true);
    const qs = new URLSearchParams();
    if (q) qs.set("q", q);
    if (category) qs.set("category", category);
    if (sort) qs.set("sort", sort);
    if (condition) qs.set("condition", condition);
    if (min) qs.set("min", min);
    if (max) qs.set("max", max);
    qs.set("limit", "24");
    api<{ products: Product[]; total: number }>(`/api/products?${qs}`)
      .then((d) => {
        setProducts(d.products);
        setTotal(d.total);
      })
      .catch(() => {
        setProducts([]);
        setTotal(0);
      })
      .finally(() => setLoading(false));
  }, [q, category, sort, condition, min, max]);

  function update(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next);
  }

  function clearFilters() {
    const next = new URLSearchParams(params);
    for (const key of ["category", "condition", "min", "max", "sort"]) {
      next.delete(key);
    }
    setParams(next);
  }

  const filterPanel = (
    <>
      <div className="filter-group">
        <label>Category</label>
        <select value={category} onChange={(e) => update("category", e.target.value)}>
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c.id} value={c.slug}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
      <div className="filter-group">
        <label>Condition</label>
        <select value={condition} onChange={(e) => update("condition", e.target.value)}>
          <option value="">Any</option>
          <option value="new">New</option>
          <option value="like_new">Like new</option>
          <option value="good">Good</option>
          <option value="fair">Fair</option>
          <option value="refurbished">Refurbished</option>
        </select>
      </div>
      <div className="filter-group">
        <label>Sort</label>
        <select value={sort} onChange={(e) => update("sort", e.target.value)}>
          <option value="newest">Newest</option>
          <option value="price_asc">Price: low to high</option>
          <option value="price_desc">Price: high to low</option>
          <option value="name">Name</option>
        </select>
      </div>
      <div className="filter-group">
        <label>Min price</label>
        <input
          type="number"
          min={0}
          value={min}
          placeholder="0"
          onChange={(e) => update("min", e.target.value)}
        />
      </div>
      <div className="filter-group">
        <label>Max price</label>
        <input
          type="number"
          min={0}
          value={max}
          placeholder="Any"
          onChange={(e) => update("max", e.target.value)}
        />
      </div>
      {activeFilterCount > 0 && (
        <button className="btn btn-outline btn-sm filter-clear" type="button" onClick={clearFilters}>
          Clear filters
        </button>
      )}
    </>
  );

  return (
    <div className="shell">
      <div className="section-head">
        <div>
          <h2>{q ? `Results for “${q}”` : "Shop inventory"}</h2>
          <p>
            {total} listing{total === 1 ? "" : "s"} · marketplace browse
          </p>
        </div>
      </div>

      <div className="market-layout">
        <aside className="filters filters-desktop">
          <h3>Filters</h3>
          {filterPanel}
        </aside>

        <div className="filters-mobile">
          <button
            type="button"
            className={`filters-toggle${filtersOpen ? " is-open" : ""}`}
            aria-expanded={filtersOpen}
            onClick={() => setFiltersOpen((o) => !o)}
          >
            <span>
              Filters{activeFilterCount > 0 ? ` · ${activeFilterCount} on` : ""}
            </span>
            <span className="filters-toggle-chevron" aria-hidden>
              {filtersOpen ? "▴" : "▾"}
            </span>
          </button>
          {filtersOpen && (
            <div className="filters-dropdown">
              {filterPanel}
              <button
                className="btn btn-dark btn-sm"
                type="button"
                style={{ width: "100%", marginTop: "0.35rem" }}
                onClick={() => setFiltersOpen(false)}
              >
                Show {total} result{total === 1 ? "" : "s"}
              </button>
            </div>
          )}
        </div>

        <div>
          {loading ? (
            <div className="empty">Loading listings…</div>
          ) : products.length ? (
            <div className="product-grid">
              {products.map((p) => (
                <ProductCard key={p.id} product={p} />
              ))}
            </div>
          ) : (
            <div className="empty">No products match these filters.</div>
          )}
        </div>
      </div>
    </div>
  );
}
