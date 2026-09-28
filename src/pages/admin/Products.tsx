import type { FormEvent, KeyboardEvent } from "react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  api,
  money,
  productColors,
  productTags,
  SEARCH_TAG_PRESETS,
  type Category,
  type Product,
  type ProductImage,
} from "../../lib/api";
import { compressImageForUpload } from "../../lib/compressImage";
import { ConfirmModal, Modal, useToast } from "../../components/AdminUI";
import {
  downloadQrPng,
  printProductTags,
  printShelfLabels,
  productBuyUrl,
  qrDataUrl,
  type HangTagSize,
} from "../../lib/qr-tag";
import { resolveSiteOrigin } from "../../lib/site-url";

const MAX_TAG_COPIES = 50;

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
  tags: [] as string[],
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
  const [tagDraft, setTagDraft] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [qrProduct, setQrProduct] = useState<Product | null>(null);
  const [qrPreview, setQrPreview] = useState("");
  const [qrBusy, setQrBusy] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [tagCopies, setTagCopies] = useState(1);
  const [modalCopies, setModalCopies] = useState(1);
  const [tagSize, setTagSize] = useState<HangTagSize>("small");
  const [createOpen, setCreateOpen] = useState(false);
  const [createStep, setCreateStep] = useState(0);
  const [creating, setCreating] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkPercent, setBulkPercent] = useState("10");
  const [bulkBusy, setBulkBusy] = useState(false);
  const [dropOpen, setDropOpen] = useState(false);
  const [dropPhotos, setDropPhotos] = useState<
    Array<{ id: string; url: string; note: string | null; created_at: string }>
  >([]);
  const [dropBusy, setDropBusy] = useState(false);
  const [tagBulkOpen, setTagBulkOpen] = useState(false);
  const [bulkTagPicks, setBulkTagPicks] = useState<string[]>([]);
  const [bulkTagMode, setBulkTagMode] = useState<"add" | "remove">("add");
  const [saleOn, setSaleOn] = useState(false);
  const [salePercent, setSalePercent] = useState("");
  const [siteOrigin, setSiteOrigin] = useState(resolveSiteOrigin());

  async function load(search = q) {
    const qs = search ? `?q=${encodeURIComponent(search)}` : "";
    const data = await api<{ products: Product[] }>(`/api/admin/products${qs}`);
    setProducts(data.products);
  }

  useEffect(() => {
    load().catch(() => toast.push("Failed to load products", "err"));
    api<{ categories: Category[] }>("/api/categories").then((d) => setCategories(d.categories));
    api<{ site_url?: string }>("/api/store")
      .then((d) => setSiteOrigin(resolveSiteOrigin(d.site_url)))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!qrProduct) {
      setQrPreview("");
      return;
    }
    let cancelled = false;
    qrDataUrl(productBuyUrl(qrProduct.slug, siteOrigin), 280)
      .then((url) => {
        if (!cancelled) setQrPreview(url);
      })
      .catch(() => {
        if (!cancelled) toast.push("Could not generate QR code", "err");
      });
    return () => {
      cancelled = true;
    };
  }, [qrProduct, siteOrigin]);

  function clampCopies(n: number) {
    return Math.max(1, Math.min(MAX_TAG_COPIES, Math.floor(n) || 1));
  }

  function toggleSelected(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (products.length && selectedIds.size === products.length) {
      setSelectedIds(new Set());
      return;
    }
    setSelectedIds(new Set(products.map((p) => p.id)));
  }

  async function printOneTag(p: Product, copies = modalCopies, size: HangTagSize = "full") {
    setQrBusy(true);
    try {
      const n = clampCopies(copies);
      await printProductTags([p], undefined, { copies: n, size, origin: siteOrigin });
      toast.push(
        size === "full"
          ? n === 1
            ? "Full-page hang tag ready"
            : `${n} full-page hang tags ready`
          : n === 1
            ? "Print dialog opened"
            : `Print sheet ready for ${n} tags`,
      );
    } catch (err) {
      toast.push(err instanceof Error ? err.message : "Print failed", "err");
    } finally {
      setQrBusy(false);
    }
  }

  async function downloadOneQr(p: Product) {
    setQrBusy(true);
    try {
      await downloadQrPng(p, undefined, siteOrigin);
      toast.push("QR PNG downloaded");
    } catch (err) {
      toast.push(err instanceof Error ? err.message : "Download failed", "err");
    } finally {
      setQrBusy(false);
    }
  }

  async function printTagSheet(
    list: Product[],
    copies: number,
    emptyMsg: string,
    size: HangTagSize = tagSize,
  ) {
    if (!list.length) {
      toast.push(emptyMsg, "info");
      return;
    }
    setQrBusy(true);
    try {
      const n = clampCopies(copies);
      const total = list.length * n;
      await printProductTags(list, undefined, { copies: n, size, origin: siteOrigin });
      toast.push(
        size === "full"
          ? `Full-page hang tags ready (${total} page${total === 1 ? "" : "s"})`
          : `Print sheet ready for ${total} tag${total === 1 ? "" : "s"}${
              n > 1 ? ` (${list.length} products × ${n})` : ""
            }`,
      );
    } catch (err) {
      toast.push(err instanceof Error ? err.message : "Print failed", "err");
    } finally {
      setQrBusy(false);
    }
  }

  async function printSelectedTags() {
    const selected = products.filter((p) => selectedIds.has(p.id));
    await printTagSheet(selected, tagCopies, "Select products first (checkboxes on the left)");
  }

  async function printShelfSheet(list: Product[], copies: number, emptyMsg: string) {
    if (!list.length) {
      toast.push(emptyMsg, "info");
      return;
    }
    setQrBusy(true);
    try {
      const n = clampCopies(copies);
      await printShelfLabels(list, { copies: n, origin: siteOrigin });
      toast.push(`Shelf labels ready (${list.length * n})`);
    } catch (err) {
      toast.push(err instanceof Error ? err.message : "Print failed", "err");
    } finally {
      setQrBusy(false);
    }
  }

  async function printSelectedShelf() {
    const selected = products.filter((p) => selectedIds.has(p.id));
    await printShelfSheet(selected, tagCopies, "Select products first");
  }

  async function printAllShelf() {
    await printShelfSheet(products, tagCopies, "No products to print");
  }

  async function printAllTags() {
    await printTagSheet(products, tagCopies, "No products to print");
  }

  function startCreate() {
    setEditing(null);
    setForm(emptyForm);
    setColorDraft("");
    setTagDraft("");
    setSaleOn(false);
    setSalePercent("");
    setCreateStep(0);
    setCreateOpen(true);
  }

  function startEdit(p: Product) {
    setCreateOpen(false);
    setEditing(p);
    const onSale =
      p.compare_at_cents != null && p.compare_at_cents > p.price_cents;
    setSaleOn(onSale);
    setSalePercent(
      onSale && p.compare_at_cents
        ? String(Math.round((1 - p.price_cents / p.compare_at_cents) * 100))
        : "",
    );
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
      tags: productTags(p),
      featured: !!p.featured,
      status: p.status,
    });
    setColorDraft("");
    setTagDraft("");
  }

  function applySalePercent(pctRaw: string, basePrice?: string) {
    const pct = Number(pctRaw);
    const original = Number(basePrice ?? (form.compare_at || form.price));
    if (!Number.isFinite(pct) || pct <= 0 || pct >= 100 || !Number.isFinite(original) || original <= 0) {
      return;
    }
    const sale = Math.round(original * (1 - pct / 100) * 100) / 100;
    setForm((f) => ({
      ...f,
      compare_at: String(original),
      price: String(sale),
    }));
    setSaleOn(true);
    setSalePercent(String(pct));
  }

  function toggleSale(on: boolean) {
    setSaleOn(on);
    if (!on) {
      setForm((f) => ({
        ...f,
        price: f.compare_at || f.price,
        compare_at: "",
      }));
      setSalePercent("");
      return;
    }
    setForm((f) => {
      const current = Number(f.price);
      if (!Number.isFinite(current) || current <= 0) return f;
      return {
        ...f,
        compare_at: f.compare_at || String(current),
      };
    });
  }

  function buildPayload() {
    const priceCents = Math.round(Number(form.price) * 100);
    let compareCents = form.compare_at ? Math.round(Number(form.compare_at) * 100) : null;
    if (saleOn) {
      if (!compareCents || compareCents <= priceCents) {
        compareCents = Math.round(Number(form.compare_at || form.price) * 100);
      }
    } else {
      compareCents = null;
    }
    return {
      name: form.name,
      sku: form.sku || undefined,
      description: form.description,
      category_id: form.category_id || null,
      price_cents: priceCents,
      compare_at_cents: saleOn && compareCents && compareCents > priceCents ? compareCents : null,
      cost_cents: form.cost ? Math.round(Number(form.cost) * 100) : null,
      stock: Number(form.stock),
      condition: form.condition,
      brand: form.brand || null,
      dimensions: form.dimensions || null,
      material: form.material || null,
      colors: form.colors,
      tags: form.tags,
      featured: form.featured,
      status: form.status,
    };
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

  function hasTag(tag: string) {
    return form.tags.some((t) => t.toLowerCase() === tag.toLowerCase());
  }

  function toggleTag(tag: string) {
    const value = tag.trim();
    if (!value) return;
    setForm((f) => {
      if (f.tags.some((t) => t.toLowerCase() === value.toLowerCase())) {
        return { ...f, tags: f.tags.filter((t) => t.toLowerCase() !== value.toLowerCase()) };
      }
      return { ...f, tags: [...f.tags, value] };
    });
  }

  function addCustomTag() {
    const value = tagDraft.trim();
    if (!value) return;
    if (hasTag(value)) {
      toast.push("That search tag is already on this product", "info");
      setTagDraft("");
      return;
    }
    setForm((f) => ({ ...f, tags: [...f.tags, value] }));
    setTagDraft("");
  }

  function onTagKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      addCustomTag();
    }
  }

  function removeTag(name: string) {
    setForm((f) => ({
      ...f,
      tags: f.tags.filter((t) => t.toLowerCase() !== name.toLowerCase()),
    }));
  }

  function toggleBulkTagPick(tag: string) {
    setBulkTagPicks((prev) => {
      if (prev.some((t) => t.toLowerCase() === tag.toLowerCase())) {
        return prev.filter((t) => t.toLowerCase() !== tag.toLowerCase());
      }
      return [...prev, tag];
    });
  }

  function openTagBulk() {
    setBulkTagPicks([]);
    setBulkTagMode("add");
    setTagBulkOpen(true);
  }

  async function applyBulkTags() {
    const selected = products.filter((p) => selectedIds.has(p.id));
    if (!selected.length) {
      toast.push("Select products first", "info");
      return;
    }
    if (!bulkTagPicks.length) {
      toast.push("Pick at least one search tag", "info");
      return;
    }
    setBulkBusy(true);
    try {
      let updated = 0;
      for (const p of selected) {
        const current = productTags(p);
        let next: string[];
        if (bulkTagMode === "add") {
          next = [...current];
          for (const tag of bulkTagPicks) {
            if (!next.some((t) => t.toLowerCase() === tag.toLowerCase())) next.push(tag);
          }
        } else {
          const removeSet = new Set(bulkTagPicks.map((t) => t.toLowerCase()));
          next = current.filter((t) => !removeSet.has(t.toLowerCase()));
        }
        await api(`/api/admin/products/${p.id}`, {
          method: "PUT",
          body: JSON.stringify({
            name: p.name,
            sku: p.sku,
            description: p.description,
            category_id: p.category_id,
            price_cents: p.price_cents,
            compare_at_cents: p.compare_at_cents,
            cost_cents: p.cost_cents,
            stock: p.stock,
            condition: p.condition,
            brand: p.brand,
            dimensions: p.dimensions,
            material: p.material,
            colors: productColors(p),
            tags: next,
            featured: p.featured,
            status: p.status,
          }),
        });
        updated += 1;
      }
      toast.push(
        bulkTagMode === "add"
          ? `Added tags to ${updated} product${updated === 1 ? "" : "s"}`
          : `Removed tags from ${updated} product${updated === 1 ? "" : "s"}`,
      );
      setTagBulkOpen(false);
      await load();
    } catch (err) {
      toast.push(err instanceof Error ? err.message : "Tag update failed", "err");
    } finally {
      setBulkBusy(false);
    }
  }

  function renderSearchTagsField() {
    const custom = form.tags.filter(
      (t) => !SEARCH_TAG_PRESETS.some((p) => p.toLowerCase() === t.toLowerCase()),
    );
    return (
      <div className="field">
        <label>Search tags</label>
        <p className="muted" style={{ margin: "0 0 8px", fontSize: "0.85rem" }}>
          Tap terms shoppers might type (e.g. couch) so this item shows up even if the title
          says sectional.
        </p>
        <div className="search-tag-grid">
          {SEARCH_TAG_PRESETS.map((tag) => {
            const on = hasTag(tag);
            return (
              <button
                key={tag}
                type="button"
                className={`search-tag-btn${on ? " is-on" : ""}`}
                onClick={() => toggleTag(tag)}
                aria-pressed={on}
              >
                {tag}
              </button>
            );
          })}
        </div>
        {custom.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, margin: "10px 0 8px" }}>
            {custom.map((t) => (
              <span key={t} className="color-chip">
                {t}
                <button
                  type="button"
                  onClick={() => removeTag(t)}
                  aria-label={`Remove ${t}`}
                  className="color-chip-x"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <input
            value={tagDraft}
            onChange={(e) => setTagDraft(e.target.value)}
            onKeyDown={onTagKey}
            placeholder="Custom tag, e.g. brown leather"
          />
          <button className="btn btn-outline btn-sm" type="button" onClick={addCustomTag}>
            Add
          </button>
        </div>
      </div>
    );
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    const payload = buildPayload();
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

  async function createFromWizard() {
    if (!form.name.trim() || !form.price) {
      toast.push("Name and price are required", "err");
      return;
    }
    setCreating(true);
    try {
      const created = await api<{ product: Product }>("/api/admin/products", {
        method: "POST",
        body: JSON.stringify(buildPayload()),
      });
      toast.push("Product created — add photos next");
      setCreateOpen(false);
      await load();
      const refreshed = await api<{ products: Product[] }>("/api/admin/products");
      const p =
        refreshed.products.find((x) => x.id === created.product?.id) ||
        refreshed.products.find((x) => x.name === form.name);
      if (p) startEdit(p);
      else setEditing(null);
    } catch (err) {
      toast.push(err instanceof Error ? err.message : "Create failed", "err");
    } finally {
      setCreating(false);
    }
  }

  async function applyBulkDiscount() {
    const selected = products.filter((p) => selectedIds.has(p.id));
    const pct = Number(bulkPercent);
    if (!selected.length) {
      toast.push("Select products first", "info");
      return;
    }
    if (!Number.isFinite(pct) || pct <= 0 || pct >= 100) {
      toast.push("Enter a discount between 1 and 99%", "err");
      return;
    }
    setBulkBusy(true);
    try {
      let updated = 0;
      for (const p of selected) {
        const original = p.compare_at_cents && p.compare_at_cents > p.price_cents
          ? p.compare_at_cents
          : p.price_cents;
        const sale = Math.round(original * (1 - pct / 100));
        await api(`/api/admin/products/${p.id}`, {
          method: "PUT",
          body: JSON.stringify({
            name: p.name,
            sku: p.sku,
            description: p.description,
            category_id: p.category_id,
            price_cents: sale,
            compare_at_cents: original,
            cost_cents: p.cost_cents,
            stock: p.stock,
            condition: p.condition,
            brand: p.brand,
            dimensions: p.dimensions,
            material: p.material,
            colors: productColors(p),
            tags: productTags(p),
            featured: p.featured,
            status: p.status,
          }),
        });
        updated += 1;
      }
      toast.push(`Discounted ${updated} product${updated === 1 ? "" : "s"} by ${pct}%`);
      setBulkOpen(false);
      await load();
    } catch (err) {
      toast.push(err instanceof Error ? err.message : "Bulk discount failed", "err");
    } finally {
      setBulkBusy(false);
    }
  }

  async function clearBulkSale() {
    const selected = products.filter((p) => selectedIds.has(p.id));
    if (!selected.length) {
      toast.push("Select products first", "info");
      return;
    }
    setBulkBusy(true);
    try {
      for (const p of selected) {
        const restore =
          p.compare_at_cents && p.compare_at_cents > p.price_cents
            ? p.compare_at_cents
            : p.price_cents;
        await api(`/api/admin/products/${p.id}`, {
          method: "PUT",
          body: JSON.stringify({
            name: p.name,
            sku: p.sku,
            description: p.description,
            category_id: p.category_id,
            price_cents: restore,
            compare_at_cents: null,
            cost_cents: p.cost_cents,
            stock: p.stock,
            condition: p.condition,
            brand: p.brand,
            dimensions: p.dimensions,
            material: p.material,
            colors: productColors(p),
            tags: productTags(p),
            featured: p.featured,
            status: p.status,
          }),
        });
      }
      toast.push("Sale prices cleared on selected products");
      setBulkOpen(false);
      await load();
    } catch (err) {
      toast.push(err instanceof Error ? err.message : "Clear failed", "err");
    } finally {
      setBulkBusy(false);
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
    try {
      toast.push("Uploading photo…", "info");
      const optimized = await compressImageForUpload(file);
      const fd = new FormData();
      fd.append("file", optimized);
      await api(`/api/admin/products/${editing.id}/images`, {
        method: "POST",
        body: fd,
      });
      await load();
      const refreshed = await api<{ products: Product[] }>("/api/admin/products");
      const p = refreshed.products.find((x) => x.id === editing.id);
      if (p) setEditing(p);
      toast.push("Image uploaded");
    } catch (err) {
      toast.push(
        err instanceof Error ? err.message : "Image upload failed",
        "err",
      );
    }
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

  async function openDropPicker() {
    if (!editing) return;
    try {
      const data = await api<{
        photos: Array<{ id: string; url: string; note: string | null; created_at: string }>;
      }>("/api/admin/photo-drop");
      setDropPhotos(data.photos || []);
      setDropOpen(true);
    } catch (err) {
      toast.push(err instanceof Error ? err.message : "Could not load dropspace", "err");
    }
  }

  async function attachDropPhoto(photoId: string) {
    if (!editing) return;
    setDropBusy(true);
    try {
      await api(`/api/admin/photo-drop/${photoId}/attach`, {
        method: "POST",
        body: JSON.stringify({ product_id: editing.id }),
      });
      setDropPhotos((prev) => prev.filter((p) => p.id !== photoId));
      await load();
      const refreshed = await api<{ products: Product[] }>("/api/admin/products");
      const p = refreshed.products.find((x) => x.id === editing.id);
      if (p) setEditing(p);
      toast.push("Photo added from dropspace");
    } catch (err) {
      toast.push(err instanceof Error ? err.message : "Could not attach photo", "err");
    } finally {
      setDropBusy(false);
    }
  }

  return (
    <div>
      <h1>Inventory</h1>
      <div className="toolbar">
        <input
          placeholder="Search name, SKU, or tag"
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
        <Link className="btn btn-outline btn-sm" to="/admin/photos">
          Photo dropspace
        </Link>
        <button
          className="btn btn-outline btn-sm"
          type="button"
          disabled={!selectedIds.size}
          onClick={() => setBulkOpen(true)}
        >
          Discount selected ({selectedIds.size || 0})
        </button>
        <button
          className="btn btn-outline btn-sm"
          type="button"
          disabled={!selectedIds.size}
          onClick={openTagBulk}
        >
          Tag selected ({selectedIds.size || 0})
        </button>
        <label className="qr-copies-field" title="How many identical hang tags per product">
          <span>Copies</span>
          <input
            type="number"
            min={1}
            max={MAX_TAG_COPIES}
            value={tagCopies}
            onChange={(e) => setTagCopies(clampCopies(Number(e.target.value)))}
          />
        </label>
        <label className="qr-copies-field" title="Hang tag print size">
          <span>Size</span>
          <select
            value={tagSize}
            onChange={(e) => setTagSize(e.target.value as HangTagSize)}
            style={{
              minWidth: "7.5rem",
              padding: "0.35rem 0.45rem",
              borderRadius: 8,
              border: "1px solid #3a413c",
              background: "#1a1f1c",
              color: "#f2efe9",
            }}
          >
            <option value="small">Small (multi/page)</option>
            <option value="full">Full page</option>
          </select>
        </label>
        <button
          className="btn btn-outline btn-sm"
          type="button"
          disabled={qrBusy || !selectedIds.size}
          onClick={() => printSelectedTags()}
        >
          Print selected ({selectedIds.size || 0})
        </button>
        <button
          className="btn btn-outline btn-sm"
          type="button"
          disabled={qrBusy || !products.length}
          onClick={() => printAllTags()}
        >
          Print all hang tags
        </button>
        <button
          className="btn btn-outline btn-sm"
          type="button"
          disabled={qrBusy || !selectedIds.size}
          onClick={() => printSelectedShelf()}
        >
          Shelf labels selected
        </button>
        <button
          className="btn btn-outline btn-sm"
          type="button"
          disabled={qrBusy || !products.length}
          onClick={() => printAllShelf()}
        >
          Shelf labels all
        </button>
      </div>

      <div className="split-layout">
        <div className="admin-panel" style={{ overflow: "auto" }}>
          <table className="admin-table">
            <thead>
              <tr>
                <th style={{ width: 36 }}>
                  <input
                    type="checkbox"
                    checked={products.length > 0 && selectedIds.size === products.length}
                    ref={(el) => {
                      if (el) {
                        el.indeterminate =
                          selectedIds.size > 0 && selectedIds.size < products.length;
                      }
                    }}
                    onChange={toggleSelectAll}
                    aria-label="Select all products for QR print"
                    title="Select all for mass QR print"
                  />
                </th>
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
                <tr key={p.id} className={selectedIds.has(p.id) ? "row-selected" : undefined}>
                  <td>
                    <input
                      type="checkbox"
                      checked={selectedIds.has(p.id)}
                      onChange={() => toggleSelected(p.id)}
                      aria-label={`Select ${p.name}`}
                    />
                  </td>
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
                      <strong>{p.name}</strong>
                    </button>
                    <div className="muted">{p.sku}</div>
                    {productColors(p).length > 0 && (
                      <div className="muted" style={{ fontSize: "0.8rem" }}>
                        {productColors(p).join(" · ")}
                      </div>
                    )}
                    {productTags(p).length > 0 && (
                      <div className="muted" style={{ fontSize: "0.75rem", marginTop: 2 }}>
                        Tags: {productTags(p).join(", ")}
                      </div>
                    )}
                  </td>
                  <td>
                    <div>{money(p.price_cents)}</div>
                    {p.compare_at_cents != null && p.compare_at_cents > p.price_cents && (
                      <div className="muted" style={{ fontSize: "0.75rem" }}>
                        <s>{money(p.compare_at_cents)}</s> ·{" "}
                        {Math.round((1 - p.price_cents / p.compare_at_cents) * 100)}% off
                      </div>
                    )}
                  </td>
                  <td>{p.stock}</td>
                  <td>
                    <span className="status">{p.status}</span>
                  </td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <button
                      className="btn btn-outline btn-sm"
                      type="button"
                      onClick={() => {
                        setModalCopies(1);
                        setQrProduct(p);
                      }}
                    >
                      QR tag
                    </button>{" "}
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
            <h3 style={{ marginTop: 0, marginBottom: 0 }}>
              {editing ? "Edit product" : "Select a product to edit"}
            </h3>
            {editing && (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button
                  className="btn btn-outline btn-sm"
                  type="button"
                  onClick={() => {
                    setModalCopies(1);
                    setQrProduct(editing);
                  }}
                >
                  QR tag
                </button>
                <button className="btn btn-dark btn-sm" type="button" onClick={() => openStorefront(editing)}>
                  View product page
                </button>
              </div>
            )}
          </div>

          {!editing ? (
            <div style={{ marginTop: "1.25rem" }}>
              <p className="muted">
                Click <strong>+ Add product</strong> for the guided setup, or Edit an item from the
                list.
              </p>
              <button className="btn btn-primary" type="button" onClick={startCreate}>
                + Add product
              </button>
            </div>
          ) : (
            <>
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

          <div className="admin-panel" style={{ margin: "0.75rem 0", padding: "0.85rem 1rem" }}>
            <label style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
              <input
                type="checkbox"
                checked={saleOn}
                onChange={(e) => toggleSale(e.target.checked)}
              />
              <strong>On sale / discounted</strong>
            </label>
            {saleOn ? (
              <>
                <div className="grid-2">
                  <div className="field">
                    <label>Original price ($)</label>
                    <input
                      required
                      type="number"
                      step="0.01"
                      value={form.compare_at}
                      onChange={(e) => setForm({ ...form, compare_at: e.target.value })}
                    />
                  </div>
                  <div className="field">
                    <label>Sale price ($)</label>
                    <input
                      required
                      type="number"
                      step="0.01"
                      value={form.price}
                      onChange={(e) => setForm({ ...form, price: e.target.value })}
                    />
                  </div>
                </div>
                <div className="field">
                  <label>Quick % off original</label>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {["10", "15", "20", "25", "30", "40", "50"].map((p) => (
                      <button
                        key={p}
                        className="btn btn-outline btn-sm"
                        type="button"
                        onClick={() => applySalePercent(p)}
                      >
                        {p}%
                      </button>
                    ))}
                    <input
                      type="number"
                      min={1}
                      max={99}
                      placeholder="%"
                      value={salePercent}
                      onChange={(e) => setSalePercent(e.target.value)}
                      style={{ width: 72 }}
                    />
                    <button
                      className="btn btn-outline btn-sm"
                      type="button"
                      onClick={() => applySalePercent(salePercent)}
                    >
                      Apply
                    </button>
                  </div>
                </div>
                {Number(form.compare_at) > Number(form.price) && Number(form.price) > 0 && (
                  <p className="muted" style={{ margin: 0, fontSize: "0.85rem" }}>
                    Shoppers see {money(Math.round(Number(form.price) * 100))}{" "}
                    <s>{money(Math.round(Number(form.compare_at) * 100))}</s> (
                    {Math.round((1 - Number(form.price) / Number(form.compare_at)) * 100)}% off)
                  </p>
                )}
              </>
            ) : (
              <div className="field" style={{ marginBottom: 0 }}>
                <label>Price ($)</label>
                <input
                  required
                  type="number"
                  step="0.01"
                  value={form.price}
                  onChange={(e) => setForm({ ...form, price: e.target.value })}
                />
              </div>
            )}
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
                  className="color-chip"
                >
                  {c}
                  <button
                    type="button"
                    onClick={() => removeColor(c)}
                    aria-label={`Remove ${c}`}
                    className="color-chip-x"
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
          {renderSearchTagsField()}
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

          <div className="product-photos-panel">
              <div className="product-photos-head">
                <div>
                  <h4 style={{ margin: 0 }}>Product photos</h4>
                  <p className="muted" style={{ margin: "0.25rem 0 0", fontSize: "0.85rem" }}>
                    Large, clear photos sell furniture — add several angles. First primary shows in the shop.
                  </p>
                </div>
              </div>

              {(() => {
                const photos = editing.images || [];
                const primary = photos.find((img) => img.is_primary) || photos[0];
                return (
                  <>
                    <div className="product-photo-hero">
                      {primary ? (
                        <img src={primary.url} alt={editing.name} />
                      ) : (
                        <div className="product-photo-empty">
                          <strong>No photos yet</strong>
                          <span className="muted">Upload a clear front shot first</span>
                        </div>
                      )}
                      {primary?.is_primary ? (
                        <span className="product-photo-badge">Primary</span>
                      ) : null}
                    </div>

                    <div className="product-photo-upload-row">
                      <label className="product-photo-upload">
                        <input
                          type="file"
                          accept="image/*"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) uploadImage(file);
                            e.target.value = "";
                          }}
                        />
                        <strong>+ Add photo</strong>
                        <span className="muted">
                          JPG/PNG/WebP · Chromebook-safe (auto-compressed)
                        </span>
                      </label>
                      <button
                        className="btn btn-outline product-photo-drop-btn"
                        type="button"
                        onClick={openDropPicker}
                      >
                        Use dropspace photo
                      </button>
                    </div>

                    {photos.length > 0 && (
                      <div className="image-grid product-photo-grid">
                        {photos.map((img: ProductImage) => (
                          <div
                            className={`image-tile${img.is_primary ? " is-primary" : ""}`}
                            key={img.id}
                          >
                            <img src={img.url} alt="" />
                            <div className="actions">
                              {!img.is_primary && (
                                <button
                                  className="btn btn-sm btn-primary"
                                  type="button"
                                  onClick={() => makePrimary(img.id)}
                                >
                                  Make primary
                                </button>
                              )}
                              <button
                                className="btn btn-sm btn-danger"
                                type="button"
                                onClick={() => deleteImage(img.id)}
                              >
                                Remove
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                );
              })()}
            </div>

          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn btn-primary" type="submit">
              Save
            </button>
            <button className="btn btn-danger" type="button" onClick={() => setConfirmDelete(editing.id)}>
              Delete
            </button>
          </div>
            </>
          )}
        </form>
      </div>

      <Modal
        open={!!qrProduct}
        title={qrProduct ? `QR tag · ${qrProduct.name}` : "QR tag"}
        onClose={() => setQrProduct(null)}
        footer={
          qrProduct ? (
            <>
              <button
                className="btn btn-outline"
                type="button"
                disabled={qrBusy}
                onClick={() => downloadOneQr(qrProduct)}
              >
                Download PNG
              </button>
              <button
                className="btn btn-outline"
                type="button"
                disabled={qrBusy}
                onClick={() => printOneTag(qrProduct, modalCopies, "small")}
              >
                Print small
              </button>
              <button
                className="btn btn-primary"
                type="button"
                disabled={qrBusy}
                onClick={() => printOneTag(qrProduct, modalCopies, "full")}
              >
                Print full page
                {modalCopies > 1 ? ` ×${modalCopies}` : ""}
              </button>
            </>
          ) : null
        }
      >
        {qrProduct && (
          <div className="qr-tag-preview">
            <p className="muted" style={{ marginTop: 0 }}>
              Choose <strong>small</strong> (several per sheet) or <strong>full page</strong> (one
              giant SCAN TO BUY poster per page). Location: Tupelo, MS 38801.
            </p>
            <div className="qr-tag-card">
              <div className="qr-tag-location">Tupelo, MS 38801</div>
              <div className="qr-tag-hero">SCAN TO BUY</div>
              <ol className="qr-tag-steps">
                <li>Open your phone camera</li>
                <li>Point at this QR code</li>
                <li>Tap the link → buy online</li>
              </ol>
              {qrPreview ? (
                <img src={qrPreview} alt={`QR code for ${qrProduct.name}`} />
              ) : (
                <div className="muted">Generating QR…</div>
              )}
              <strong>{qrProduct.name}</strong>
              <div>{money(qrProduct.price_cents)}</div>
              <div className="muted">SKU {qrProduct.sku}</div>
            </div>
            <label className="qr-copies-field" style={{ marginTop: 12 }}>
              <span>Copies to print</span>
              <input
                type="number"
                min={1}
                max={MAX_TAG_COPIES}
                value={modalCopies}
                onChange={(e) => setModalCopies(clampCopies(Number(e.target.value)))}
              />
            </label>
            <p className="muted" style={{ fontSize: "0.8rem", wordBreak: "break-all" }}>
              {productBuyUrl(qrProduct.slug, siteOrigin)}
            </p>
            <button
              className="btn btn-outline btn-sm"
              type="button"
              onClick={() => {
                navigator.clipboard?.writeText(productBuyUrl(qrProduct.slug, siteOrigin));
                toast.push("Buy link copied");
              }}
            >
              Copy buy link
            </button>
          </div>
        )}
      </Modal>

      <Modal
        open={createOpen}
        title="Add product"
        onClose={() => setCreateOpen(false)}
        footer={
          <>
            <button
              className="btn btn-outline"
              type="button"
              disabled={creating || createStep === 0}
              onClick={() => setCreateStep((s) => Math.max(0, s - 1))}
            >
              Back
            </button>
            {createStep < 2 ? (
              <button
                className="btn btn-primary"
                type="button"
                onClick={() => {
                  if (createStep === 0 && !form.name.trim()) {
                    toast.push("Enter a product name", "err");
                    return;
                  }
                  if (createStep === 1 && !form.price) {
                    toast.push("Enter a price", "err");
                    return;
                  }
                  setCreateStep((s) => s + 1);
                }}
              >
                Continue
              </button>
            ) : (
              <button
                className="btn btn-primary"
                type="button"
                disabled={creating}
                onClick={() => void createFromWizard()}
              >
                {creating ? "Creating…" : "Create product"}
              </button>
            )}
          </>
        }
      >
        <div className="muted" style={{ marginBottom: "0.85rem", fontSize: "0.85rem" }}>
          Step {createStep + 1} of 3 ·{" "}
          {createStep === 0 ? "Basics" : createStep === 1 ? "Pricing & sale" : "Details"}
        </div>

        {createStep === 0 && (
          <>
            <div className="field">
              <label>Product name</label>
              <input
                autoFocus
                required
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. Ashley sectional sofa"
              />
            </div>
            <div className="grid-2">
              <div className="field">
                <label>SKU (optional)</label>
                <input
                  value={form.sku}
                  onChange={(e) => setForm({ ...form, sku: e.target.value })}
                  placeholder="Auto if blank"
                />
              </div>
              <div className="field">
                <label>Category</label>
                <select
                  value={form.category_id}
                  onChange={(e) => setForm({ ...form, category_id: e.target.value })}
                >
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
              <label>Short description</label>
              <textarea
                rows={3}
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="What shoppers should know"
              />
            </div>
          </>
        )}

        {createStep === 1 && (
          <>
            <label style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12 }}>
              <input
                type="checkbox"
                checked={saleOn}
                onChange={(e) => toggleSale(e.target.checked)}
              />
              <strong>Put this item on sale</strong>
            </label>
            {saleOn ? (
              <>
                <div className="grid-2">
                  <div className="field">
                    <label>Original price ($)</label>
                    <input
                      type="number"
                      step="0.01"
                      value={form.compare_at}
                      onChange={(e) => setForm({ ...form, compare_at: e.target.value })}
                    />
                  </div>
                  <div className="field">
                    <label>Sale price ($)</label>
                    <input
                      type="number"
                      step="0.01"
                      value={form.price}
                      onChange={(e) => setForm({ ...form, price: e.target.value })}
                    />
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
                  {["10", "15", "20", "25", "30"].map((p) => (
                    <button
                      key={p}
                      className="btn btn-outline btn-sm"
                      type="button"
                      onClick={() => applySalePercent(p)}
                    >
                      {p}% off
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <div className="field">
                <label>Price ($)</label>
                <input
                  type="number"
                  step="0.01"
                  value={form.price}
                  onChange={(e) => setForm({ ...form, price: e.target.value })}
                />
              </div>
            )}
            <div className="grid-2">
              <div className="field">
                <label>Your cost ($)</label>
                <input
                  type="number"
                  step="0.01"
                  value={form.cost}
                  onChange={(e) => setForm({ ...form, cost: e.target.value })}
                />
              </div>
              <div className="field">
                <label>Stock qty</label>
                <input
                  type="number"
                  value={form.stock}
                  onChange={(e) => setForm({ ...form, stock: e.target.value })}
                />
              </div>
            </div>
          </>
        )}

        {createStep === 2 && (
          <>
            <div className="grid-2">
              <div className="field">
                <label>Condition</label>
                <select
                  value={form.condition}
                  onChange={(e) => setForm({ ...form, condition: e.target.value })}
                >
                  <option value="new">New</option>
                  <option value="like_new">Like new</option>
                  <option value="good">Good</option>
                  <option value="fair">Fair</option>
                  <option value="refurbished">Refurbished</option>
                </select>
              </div>
              <div className="field">
                <label>Status</label>
                <select
                  value={form.status}
                  onChange={(e) => setForm({ ...form, status: e.target.value })}
                >
                  <option value="active">Active</option>
                  <option value="draft">Draft</option>
                </select>
              </div>
            </div>
            <div className="field">
              <label>Brand</label>
              <input
                value={form.brand}
                onChange={(e) => setForm({ ...form, brand: e.target.value })}
              />
            </div>
            <div className="field">
              <label>Colors</label>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
                {form.colors.map((c) => (
                  <span key={c} className="color-chip">
                    {c}
                    <button type="button" onClick={() => removeColor(c)} className="color-chip-x">
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
                  placeholder="Add a color"
                />
                <button className="btn btn-outline btn-sm" type="button" onClick={addColor}>
                  Add
                </button>
              </div>
            </div>
            {renderSearchTagsField()}
            <p className="muted" style={{ marginBottom: 0 }}>
              After create you’ll land on the edit screen to upload photos.
            </p>
          </>
        )}
      </Modal>

      <Modal
        open={bulkOpen}
        title="Discount selected products"
        onClose={() => setBulkOpen(false)}
        footer={
          <>
            <button className="btn btn-outline" type="button" onClick={() => setBulkOpen(false)}>
              Cancel
            </button>
            <button
              className="btn btn-outline"
              type="button"
              disabled={bulkBusy}
              onClick={() => void clearBulkSale()}
            >
              Clear sales
            </button>
            <button
              className="btn btn-primary"
              type="button"
              disabled={bulkBusy}
              onClick={() => void applyBulkDiscount()}
            >
              {bulkBusy ? "Updating…" : `Apply ${bulkPercent || "?"}% off`}
            </button>
          </>
        }
      >
        <p style={{ marginTop: 0 }}>
          Applies a sale to <strong>{selectedIds.size}</strong> selected product
          {selectedIds.size === 1 ? "" : "s"}. Original price is kept as the crossed-out compare
          price.
        </p>
        <div className="field">
          <label>Percent off</label>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            {["10", "15", "20", "25", "30", "40", "50"].map((p) => (
              <button
                key={p}
                className={`btn btn-sm ${bulkPercent === p ? "btn-primary" : "btn-outline"}`}
                type="button"
                onClick={() => setBulkPercent(p)}
              >
                {p}%
              </button>
            ))}
            <input
              type="number"
              min={1}
              max={99}
              value={bulkPercent}
              onChange={(e) => setBulkPercent(e.target.value)}
              style={{ width: 80 }}
            />
          </div>
        </div>
      </Modal>

      <Modal
        open={tagBulkOpen}
        title="Tag selected products"
        onClose={() => setTagBulkOpen(false)}
        footer={
          <>
            <button className="btn btn-outline" type="button" onClick={() => setTagBulkOpen(false)}>
              Cancel
            </button>
            <button
              className="btn btn-primary"
              type="button"
              disabled={bulkBusy || !bulkTagPicks.length}
              onClick={() => void applyBulkTags()}
            >
              {bulkBusy
                ? "Updating…"
                : bulkTagMode === "add"
                  ? `Add tags (${bulkTagPicks.length})`
                  : `Remove tags (${bulkTagPicks.length})`}
            </button>
          </>
        }
      >
        <p style={{ marginTop: 0 }}>
          Apply search tags to <strong>{selectedIds.size}</strong> selected product
          {selectedIds.size === 1 ? "" : "s"} so they show up for terms like “couch” even when
          the title doesn’t say that.
        </p>
        <div className="field">
          <label>Action</label>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              className={`btn btn-sm ${bulkTagMode === "add" ? "btn-primary" : "btn-outline"}`}
              type="button"
              onClick={() => setBulkTagMode("add")}
            >
              Add tags
            </button>
            <button
              className={`btn btn-sm ${bulkTagMode === "remove" ? "btn-primary" : "btn-outline"}`}
              type="button"
              onClick={() => setBulkTagMode("remove")}
            >
              Remove tags
            </button>
          </div>
        </div>
        <div className="field">
          <label>Select tags</label>
          <div className="search-tag-grid">
            {SEARCH_TAG_PRESETS.map((tag) => {
              const on = bulkTagPicks.some((t) => t.toLowerCase() === tag.toLowerCase());
              return (
                <button
                  key={tag}
                  type="button"
                  className={`search-tag-btn${on ? " is-on" : ""}`}
                  onClick={() => toggleBulkTagPick(tag)}
                  aria-pressed={on}
                >
                  {tag}
                </button>
              );
            })}
          </div>
        </div>
      </Modal>

      <Modal
        open={dropOpen}
        title="Use dropspace photo"
        onClose={() => setDropOpen(false)}
        wide
      >
        <p className="muted" style={{ marginTop: 0 }}>
          Photos you uploaded from your phone. Tap one to attach it to{" "}
          <strong>{editing?.name || "this product"}</strong>.
        </p>
        {!dropPhotos.length ? (
          <p className="muted">
            Dropspace is empty.{" "}
            <Link to="/admin/photos">Take photos on your phone →</Link>
          </p>
        ) : (
          <div className="dropspace-pick-grid">
            {dropPhotos.map((p) => (
              <button
                key={p.id}
                type="button"
                className="dropspace-pick-card"
                disabled={dropBusy}
                onClick={() => attachDropPhoto(p.id)}
              >
                <img src={p.url} alt={p.note || "Drop photo"} />
                <span>{p.note || "No note"}</span>
              </button>
            ))}
          </div>
        )}
      </Modal>

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
