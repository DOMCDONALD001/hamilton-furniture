import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, money, type Offer, type Product } from "../lib/api";
import { ProductCard } from "../components/Layout";
import { AuctionCardView, type AuctionCard } from "./Auctions";

type OfferCard = Offer & { members_only?: boolean; locked?: boolean };

export function HomePage() {
  const [featured, setFeatured] = useState<Product[]>([]);
  const [offers, setOffers] = useState<OfferCard[]>([]);
  const [auctions, setAuctions] = useState<AuctionCard[]>([]);

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
  }, []);

  return (
    <div className="shell">
      <section className="hero">
        <div>
          <div className="hero-kicker">Hamilton · Odds N Ends · Furniture</div>
          <h1>Hamilton Odds N Ends Furniture</h1>
          <p>
            Browse living room, bedroom, dining, and one-of-a-kind finds — buy now or bid in our
            live auctions.
          </p>
          <div className="cta-row">
            <Link className="btn btn-primary" to="/shop">
              Shop inventory
            </Link>
            <Link className="btn btn-ghost" to="/auctions">
              View auctions
            </Link>
          </div>
        </div>
      </section>

      {auctions.length > 0 && (
        <>
          <div className="section-head">
            <div>
              <h2>Live auctions</h2>
              <p>Bid before the clock runs out</p>
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
              <h2>Active offers</h2>
              <p>Promo codes at checkout — some are members only</p>
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
          <h2>Featured picks</h2>
          <p>Hand-selected pieces ready for delivery or pickup</p>
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
