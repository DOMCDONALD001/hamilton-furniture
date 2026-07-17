import type { FormEvent, KeyboardEvent } from "react";
import { useEffect, useState } from "react";
import { api, money, productColors, type Category, type Product, type ProductImage } from "../../lib/api";
import { ConfirmModal, useToast } from "../../components/AdminUI";

const emptyForm = {
  name: "",
  sku: "",
  description: "",
  category_id: "",
  price: "",
  compare_at: "",
  cost: "",
  stock: "1",
  condition: "new",
  brand: "",
  dimensions: "",
  material: "",
  colors: [] as string[],
  featured: false,
  status: "active",
};

export function AdminProducts() {
  const toast = useToast();
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<Product | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [colorDraft, setColorDraft] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  async function load(search = q) {
    const qs = search ? `?q=${encodeURIComponent(search)}` : "";
    const data = await api<{ products: Product[] }>(`/api/admin/products${qs}`);
    setProducts(data.products);
  }

  useEffect(() => {
    load().catch(() => toast.push("Failed to load products", "err"));
    api<{ categories: Category[] }>("/api/categories").then((d) => setCategories(d.categories));
  }, []);

  function startCreate() {
    setEditing(null);
    setForm(emptyForm);
    setColorDraft("");
  }

  function startEdit(p: Product) {
    setEditing(p);
    setForm({
      name: p.name,
      sku: p.sku,
      description: p.description,
      category_id: p.category_id || "",
      price: String(p.price_cents / 100),
      compare_at: p.compare_at_cents != null ? String(p.compare_at_cents / 100) : "",
      cost: p.cost_cents != null ? String(p.cost_cents / 100) : "",
      stock: String(p.stock),
      condition: p.condition,
      brand: p.brand || "",
      dimensions: p.dimensions || "",
      material: p.material || "",
      colors: productColors(p),
      featured: !!p.featured,
      status: p.status,
    });
    setColorDraft("");
  }

  function openStorefront(p: Product) {
    window.open(`/product/${p.slug}`, "_blank", "noopener,noreferrer");
  }

  function addColor() {
    const value = colorDraft.trim();
    if (!value) return;
    if (form.colors.some((c) => c.toLowerCase() === value.toLowerCase())) {
      toast.push("That color is already listed", "info");
      setColorDraft("");
      return;
    }
    setForm({ ...form, colors: [...form.colors, value] });
    setColorDraft("");
  }

  function onColorKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      addColor();
    }
  }

  function removeColor(name: string) {
    setForm({ ...form, colors: form.colors.filter((c) => c !== name) });
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    const payload = {
      name: form.name,
      sku: form.sku || undefined,
      description: form.description,
      category_id: form.category_id || null,
      price_cents: Math.round(Number(form.price) * 100),
      compare_at_cents: form.compare_at ? Math.round(Number(form.compare_at) * 100) : null,
      cost_cents: form.cost ? Math.round(Number(form.cost) * 100) : null,
      stock: Number(form.stock),
      condition: form.condition,
      brand: form.brand || null,
      dimensions: form.dimensions || null,
      material: form.material || null,
      colors: form.colors,
      featured: form.featured,
      status: form.status,
    };
    try {
      if (editing) {
        await api(`/api/admin/products/${editing.id}`, {
          method: "PUT",
          body: JSON.stringify(payload),
        });
        toast.push("Product updated");
      } else {
        await api("/api/admin/products", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        toast.push("Product created");
        startCreate();
      }
      await load();
      if (editing) {
        const refreshed = await api<{ products: Product[] }>("/api/admin/products");
        const p = refreshed.products.find((x) => x.id === editing.id);
        if (p) setEditing(p);
      }
    } catch (err) {
      toast.push(err instanceof Error ? err.message : "Save failed", "err");
    }
  }

  async function remove(id: string) {
    await api(`/api/admin/products/${id}`, { method: "DELETE" });
    if (editing?.id === id) startCreate();
    await load();
    toast.push("Product deleted", "info");
  }

  async function uploadImage(file: File) {
    if (!editing) return;
    const fd = new FormData();
    fd.append("file", file);
    await api(`/api/admin/products/${editing.id}/images`, {
      method: "POST",
      body: fd,
    });
    await load();
    const refreshed = await api<{ products: Product[] }>("/api/admin/products");
    const p = refreshed.products.find((x) => x.id === editing.id);
    if (p) setEditing(p);
    toast.push("Image uploaded");
  }

  async function deleteImage(imageId: string) {
    await api(`/api/admin/images/${imageId}`, { method: "DELETE" });
    await load();
    if (editing) {
      const refreshed = await api<{ products: Product[] }>("/api/admin/products");
      const p = refreshed.products.find((x) => x.id === editing.id);
      if (p) setEditing(p);
    }
    toast.push("Image removed", "info");
  }

  async function makePrimary(imageId: string) {
    await api(`/api/admin/images/${imageId}/primary`, { method: "POST" });
    await load();
    if (editing) {
      const refreshed = await api<{ products: Product[] }>("/api/admin/products");
      const p = refreshed.products.find((x) => x.id === editing.id);
      if (p) setEditing(p);
    }
    toast.push("Primary photo set");
  }

  return (
    <div>
      <h1>Inventory</h1>
      <div className="toolbar">
        <input
          placeholder="Search name or SKU"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{ minWidth: 220 }}
        />
        <button className="btn btn-outline btn-sm" type="button" onClick={() => load()}>
          Search
        </button>
        <button className="btn btn-primary btn-sm" type="button" onClick={startCreate}>
          + Add product
        </button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.1fr 0.9fr", gap: "1rem" }}>
        <div className="admin-panel" style={{ overflow: "auto" }}>
          <table className="admin-table">
            <thead>
              <tr>
                <th></th>
                <th>Product</th>
                <th>Price</th>
                <th>Stock</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {products.map((p) => (
                <tr key={p.id}>
                  <td>
                    <button
                      type="button"
                      onClick={() => openStorefront(p)}
                      title="View product page"
                      style={{
                        border: 0,
                        background: "transparent",
                        padding: 0,
                        cursor: "pointer",
                      }}
                    >
                      <img className="thumb-sm" src={p.primary_image || "/api/images/placeholder"} alt="" />
                    </button>
                  </td>
                  <td>
                    <button
                      type="button"
                      onClick={() => openStorefront(p)}
                      style={{
                        border: 0,
                        background: "transparent",
                        padding: 0,
                        cursor: "pointer",
                        textAlign: "left",
                      }}
                    >
                      <strong style={{ color: "var(--forest, #1f3d2f)" }}>{p.name}</strong>
                    </button>
                    <div className="muted">{p.sku}</div>
                    {productColors(p).length > 0 && (
                      <div className="muted" style={{ fontSize: "0.8rem" }}>
                        {productColors(p).join(" · ")}
                      </div>
                    )}
                  </td>
                  <td>{money(p.price_cents)}</td>
                  <td>{p.stock}</td>
                  <td>
                    <span className="status">{p.status}</span>
                  </td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <button className="btn btn-outline btn-sm" type="button" onClick={() => openStorefront(p)}>
                      View
                    </button>{" "}
                    <button className="btn btn-outline btn-sm" type="button" onClick={() => startEdit(p)}>
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <form className="admin-panel" onSubmit={save}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
            <h3 style={{ marginTop: 0, marginBottom: 0 }}>{editing ? "Edit product" : "New product"}</h3>
            {editing && (
              <button className="btn btn-dark btn-sm" type="button" onClick={() => openStorefront(editing)}>
                View product page
              </button>
            )}
          </div>
          <div className="field" style={{ marginTop: 12 }}>
            <label>Name</label>
            <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div className="grid-2">
            <div className="field">
              <label>SKU</label>
              <input value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} />
            </div>
            <div className="field">
              <label>Category</label>
              <select value={form.category_id} onChange={(e) => setForm({ ...form, category_id: e.target.value })}>
                <option value="">Uncategorized</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="field">
            <label>Description</label>
            <textarea rows={4} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </div>
          <div className="grid-2">
            <div className="field">
              <label>Price ($)</label>
              <input required type="number" step="0.01" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} />
            </div>
            <div className="field">
              <label>Compare-at ($)</label>
              <input type="number" step="0.01" value={form.compare_at} onChange={(e) => setForm({ ...form, compare_at: e.target.value })} />
            </div>
          </div>
          <div className="grid-2">
            <div className="field">
              <label>Cost ($)</label>
              <input type="number" step="0.01" value={form.cost} onChange={(e) => setForm({ ...form, cost: e.target.value })} />
            </div>
            <div className="field">
              <label>Stock</label>
              <input required type="number" value={form.stock} onChange={(e) => setForm({ ...form, stock: e.target.value })} />
            </div>
          </div>
          <div className="grid-2">
            <div className="field">
              <label>Condition</label>
              <select value={form.condition} onChange={(e) => setForm({ ...form, condition: e.target.value })}>
                <option value="new">New</option>
                <option value="like_new">Like new</option>
                <option value="good">Good</option>
                <option value="fair">Fair</option>
                <option value="refurbished">Refurbished</option>
              </select>
            </div>
            <div className="field">
              <label>Status</label>
              <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                <option value="active">Active</option>
                <option value="draft">Draft</option>
                <option value="out_of_stock">Out of stock</option>
                <option value="archived">Archived</option>
              </select>
            </div>
          </div>
          <div className="field">
            <label>Brand</label>
            <input value={form.brand} onChange={(e) => setForm({ ...form, brand: e.target.value })} />
          </div>
          <div className="field">
            <label>Colors</label>
            <p className="muted" style={{ margin: "0 0 8px", fontSize: "0.85rem" }}>
              Add every color this item comes in. Shoppers pick one on the product page.
            </p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
              {form.colors.map((c) => (
                <span
                  key={c}
                  className="pill"
                  style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
                >
                  {c}
                  <button
                    type="button"
                    onClick={() => removeColor(c)}
                    aria-label={`Remove ${c}`}
                    style={{
                      border: 0,
                      background: "transparent",
                      cursor: "pointer",
                      fontWeight: 700,
                      lineHeight: 1,
                      padding: 0,
                    }}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                value={colorDraft}
                onChange={(e) => setColorDraft(e.target.value)}
                onKeyDown={onColorKey}
                placeholder="e.g. Charcoal, Walnut"
              />
              <button className="btn btn-outline btn-sm" type="button" onClick={addColor}>
                Add
              </button>
            </div>
          </div>
          <div className="field">
            <label>Dimensions</label>
            <input value={form.dimensions} onChange={(e) => setForm({ ...form, dimensions: e.target.value })} />
          </div>
          <div className="field">
            <label>Material</label>
            <input value={form.material} onChange={(e) => setForm({ ...form, material: e.target.value })} />
          </div>
          <label style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12 }}>
            <input type="checkbox" checked={form.featured} onChange={(e) => setForm({ ...form, featured: e.target.checked })} />
            Featured on homepage
          </label>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn btn-primary" type="submit">
              Save
            </button>
            {editing && (
              <button className="btn btn-danger" type="button" onClick={() => setConfirmDelete(editing.id)}>
                Delete
              </button>
            )}
          </div>

          {editing && (
            <div style={{ marginTop: "1.25rem" }}>
              <h4>Photos</h4>
              <input
                type="file"
                accept="image/*"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) uploadImage(file);
                }}
              />
              <div className="image-grid" style={{ marginTop: 10 }}>
                {(editing.images || []).map((img: ProductImage) => (
                  <div className="image-tile" key={img.id}>
                    <img src={img.url} alt="" />
                    <div className="actions">
                      {!img.is_primary && (
                        <button className="btn btn-sm btn-primary" type="button" onClick={() => makePrimary(img.id)}>
                          Primary
                        </button>
                      )}
                      <button className="btn btn-sm btn-danger" type="button" onClick={() => deleteImage(img.id)}>
                        Remove
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </form>
      </div>

      <ConfirmModal
        open={!!confirmDelete}
        title="Delete product?"
        message="This removes the product and its photos from inventory."
        confirmLabel="Delete"
        danger
        onClose={() => setConfirmDelete(null)}
        onConfirm={() => {
          if (confirmDelete) remove(confirmDelete);
        }}
      />
    </div>
  );
}
