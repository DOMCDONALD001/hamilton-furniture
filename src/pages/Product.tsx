import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  api,
  conditionLabel,
  money,
  productColors,
  type Category,
  type Product,
} from "../lib/api";
import { useCart } from "../lib/cart";
import { ProductCard } from "../components/Layout";

export function ProductPage() {
  const { slug } = useParams();
  const { add } = useCart();
  const [product, setProduct] = useState<Product | null>(null);
  const [category, setCategory] = useState<Category | null>(null);
  const [related, setRelated] = useState<Product[]>([]);
  const [qty, setQty] = useState(1);
  const [selectedColor, setSelectedColor] = useState<string>("");
  const [activeImage, setActiveImage] = useState(0);
  const [toast, setToast] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!slug) return;
    setError("");
    setActiveImage(0);
    api<{ product: Product; category: Category | null; related: Product[] }>(
      `/api/products/${slug}`,
    )
      .then((d) => {
        setProduct(d.product);
        setCategory(d.category);
        setRelated(d.related);
        const colors = productColors(d.product);
        setSelectedColor(colors.length === 1 ? colors[0] : "");
        setQty(1);
      })
      .catch((e) => setError(e.message));
  }, [slug]);

  if (error) return <div className="shell empty">{error}</div>;
  if (!product) return <div className="shell empty">Loading product…</div>;

  const colors = productColors(product);
  const onSale =
    product.compare_at_cents != null && product.compare_at_cents > product.price_cents;
  const images =
    (product.images?.length ?? 0) > 0
      ? product.images!.map((img) => img.url)
      : [product.primary_image || "/api/images/placeholder"];
  const image = images[Math.min(activeImage, images.length - 1)] || images[0];

  function addToCart() {
    if (colors.length > 1 && !selectedColor) {
      setToast("Choose a color first");
      setTimeout(() => setToast(""), 2000);
      return;
    }
    add(
      {
        product_id: product!.id,
        name: product!.name,
        price_cents: product!.price_cents,
        image: images[0],
        slug: product!.slug,
        color: selectedColor || colors[0] || null,
      },
      qty,
    );
    setToast("Added to cart");
    setTimeout(() => setToast(""), 2000);
  }

  return (
    <div className="shell">
      <div className="pdp">
        <div className="gallery gallery-multi">
          <div className="gallery-main">
            <img src={image} alt={product.name} />
            {images.length > 1 && (
              <>
                <button
                  type="button"
                  className="gallery-nav gallery-prev"
                  aria-label="Previous photo"
                  onClick={() =>
                    setActiveImage((i) => (i - 1 + images.length) % images.length)
                  }
                >
                  ‹
                </button>
                <button
                  type="button"
                  className="gallery-nav gallery-next"
                  aria-label="Next photo"
                  onClick={() => setActiveImage((i) => (i + 1) % images.length)}
                >
                  ›
                </button>
              </>
            )}
          </div>
          {images.length > 1 && (
            <div className="gallery-thumbs" role="listbox" aria-label="Product photos">
              {images.map((src, i) => (
                <button
                  key={src + i}
                  type="button"
                  role="option"
                  aria-selected={i === activeImage}
                  className={`gallery-thumb${i === activeImage ? " is-active" : ""}`}
                  onClick={() => setActiveImage(i)}
                >
                  <img src={src} alt="" />
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="pdp-info">
          <div className="breadcrumbs">
            <Link to="/shop">Shop</Link>
            {category && (
              <>
                {" / "}
                <Link to={`/shop?category=${category.slug}`}>{category.name}</Link>
              </>
            )}
          </div>
          <h1>{product.name}</h1>
          <div className="muted">
            SKU {product.sku} · {conditionLabel(product.condition)}
            {product.brand ? ` · ${product.brand}` : ""}
          </div>
          <div className="pdp-price">
            <span className="price">{money(product.price_cents)}</span>
            {onSale && (
              <span className="price-was">{money(product.compare_at_cents!)}</span>
            )}
          </div>
          <p style={{ color: "var(--ink-soft)" }}>{product.description}</p>
          <div className="specs">
            {product.dimensions && (
              <div className="spec">
                <span>Dimensions</span>
                {product.dimensions}
              </div>
            )}
            {product.material && (
              <div className="spec">
                <span>Material</span>
                {product.material}
              </div>
            )}
            {colors.length === 1 && (
              <div className="spec">
                <span>Color</span>
                {colors[0]}
              </div>
            )}
            <div className="spec">
              <span>Availability</span>
              {product.stock > 0 ? `${product.stock} in stock` : "Out of stock"}
            </div>
          </div>

          {colors.length > 1 && (
            <div style={{ marginBottom: "1rem" }}>
              <div style={{ fontWeight: 700, marginBottom: 8 }}>
                Color{selectedColor ? `: ${selectedColor}` : ""}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {colors.map((c) => (
                  <button
                    key={c}
                    type="button"
                    className={`chip ${selectedColor === c ? "active" : ""}`}
                    onClick={() => setSelectedColor(c)}
                  >
                    {c}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="buy-box">
            <div style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
              <div className="qty">
                <button type="button" onClick={() => setQty((q) => Math.max(1, q - 1))}>
                  −
                </button>
                <span style={{ padding: "0 0.5rem", fontWeight: 700 }}>{qty}</span>
                <button
                  type="button"
                  onClick={() => setQty((q) => Math.min(product.stock, q + 1))}
                >
                  +
                </button>
              </div>
              <button
                className="btn btn-primary"
                style={{ flex: 1 }}
                disabled={product.stock < 1}
                onClick={addToCart}
              >
                Add to cart
              </button>
            </div>
            <Link className="btn btn-outline" to="/cart">
              View cart
            </Link>
          </div>
        </div>
      </div>

      {related.length > 0 && (
        <>
          <div className="section-head">
            <div>
              <h2>Related listings</h2>
              <p>More from this category</p>
            </div>
          </div>
          <div className="product-grid" style={{ marginBottom: "3rem" }}>
            {related.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        </>
      )}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
