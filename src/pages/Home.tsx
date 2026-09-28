import { useEffect, useState, type CSSProperties } from "react";
import { Link } from "react-router-dom";
import { api, money, type Offer, type Product } from "../lib/api";
import { ProductCard } from "../components/Layout";
import { AuctionCardView, type AuctionCard } from "./Auctions";
import { withStoreDefaults, type StoreContent } from "../lib/store";

type OfferCard = Offer & { members_only?: boolean; locked?: boolean };

export function HomePage() {
  const [featured, setFeatured] = useState<Product[]>([]);
  const [offers, setOffers] = useState<OfferCard[]>([]);
  const [auctions, setAuctions] = useState<AuctionCard[]>([]);
  const [store, setStore] = useState(withStoreDefaults());

  useEffect(() => {
    api<{ products: Product[] }>("/api/products?featured=1&limit=8")
      .then((d) => setFeatured(d.products))
      .catch(() => {});
    api<{ offers: OfferCard[] }>("/api/offers")
      .then((d) => setOffers(d.offers))
      .catch(() => {});
    api<{ auctions: AuctionCard[] }>("/api/auctions?status=live")
      .then((d) => setAuctions(d.auctions.slice(0, 4)))
      .catch(() => {});
    api<StoreContent>("/api/store")
      .then((d) => setStore(withStoreDefaults(d)))
      .catch(() => {});
  }, []);

  return (
    <div className="shell">
      <section
        className={`hero ${store.hero_image ? "hero-has-image" : ""}`}
        style={
          store.hero_image
            ? ({
                ["--hero-image" as string]: `url(${store.hero_image})`,
                ["--hero-position" as string]:
                  store.hero_image_position === "left"
                    ? "left center"
                    : store.hero_image_position === "right"
                      ? "right center"
                      : "center center",
              } as CSSProperties)
            : undefined
        }
      >
        <div className="hero-copy">
          <div className="hero-kicker">{store.hero_kicker}</div>
          <h1>{store.hero_headline}</h1>
          <p>{store.hero_subtext}</p>
          <div className="cta-row">
            <Link className="btn btn-primary" to="/shop">
              {store.hero_cta_primary}
            </Link>
            <Link className="btn btn-ghost" to="/auctions">
              {store.hero_cta_secondary}
            </Link>
          </div>
        </div>
      </section>

      {auctions.length > 0 && (
        <>
          <div className="section-head">
            <div>
              <h2>{store.auctions_title}</h2>
              <p>{store.auctions_subtitle}</p>
            </div>
            <Link className="btn btn-outline btn-sm" to="/auctions">
              All auctions
            </Link>
          </div>
          <div className="product-grid">
            {auctions.map((a) => (
              <AuctionCardView key={a.id} auction={a} />
            ))}
          </div>
        </>
      )}

      {offers.length > 0 && (
        <>
          <div className="section-head">
            <div>
              <h2>{store.offers_title}</h2>
              <p>{store.offers_subtitle}</p>
            </div>
          </div>
          <div className="offer-strip">
            {offers.map((o) => (
              <div className={`offer-card ${o.locked ? "offer-locked" : ""}`} key={o.id}>
                <strong>{o.name}</strong>
                <div style={{ color: "#c9c3b6", fontSize: "0.9rem", marginTop: 4 }}>
                  {o.description ||
                    (o.type === "percent"
                      ? `${o.value}% off`
                      : o.type === "fixed"
                        ? `${money(o.value)} off`
                        : "Free shipping")}
                </div>
                {o.code && <code>{o.code}</code>}
                {o.members_only && (
                  <div style={{ marginTop: 8, fontSize: "0.8rem", color: "#e8d4b0" }}>
                    {o.locked ? (
                      <>
                        Members only · <Link to="/account?mode=register">Create account</Link>
                      </>
                    ) : (
                      "Unlocked for your account"
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      <div className="section-head">
        <div>
          <h2>{store.featured_title}</h2>
          <p>{store.featured_subtitle}</p>
        </div>
        <Link className="btn btn-outline btn-sm" to="/shop">
          View all
        </Link>
      </div>
      <div className="product-grid">
        {featured.map((p, i) => (
          <div key={p.id} style={{ animationDelay: `${i * 0.05}s` }}>
            <ProductCard product={p} />
          </div>
        ))}
        {!featured.length && <div className="empty">Loading inventory…</div>}
      </div>
    </div>
  );
}
