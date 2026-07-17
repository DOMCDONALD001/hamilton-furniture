import { Link } from "react-router-dom";
import { money } from "../lib/api";
import { useCart } from "../lib/cart";

export function CartPage() {
  const { items, setQty, remove, subtotal, count } = useCart();

  if (!items.length) {
    return (
      <div className="shell empty">
        <h2>Your cart is empty</h2>
        <p>Browse the marketplace and add furniture you love.</p>
        <Link className="btn btn-dark" to="/shop" style={{ marginTop: "1rem" }}>
          Shop inventory
        </Link>
      </div>
    );
  }

  return (
    <div className="shell">
      <div className="section-head">
        <div>
          <h2>Cart</h2>
          <p>
            {count} item{count === 1 ? "" : "s"}
          </p>
        </div>
      </div>
      <div className="cart-layout">
        <div className="panel">
          {items.map((item) => (
            <div className="cart-line" key={`${item.product_id}::${item.color || ""}`}>
              <img src={item.image || "/api/images/placeholder"} alt="" />
              <div>
                <Link to={`/product/${item.slug}`}>
                  <strong>{item.name}</strong>
                </Link>
                {item.color && <div className="muted">Color: {item.color}</div>}
                <div className="muted">{money(item.price_cents)} each</div>
                <div style={{ display: "flex", gap: "0.6rem", marginTop: "0.5rem" }}>
                  <div className="qty">
                    <button
                      type="button"
                      onClick={() => setQty(item.product_id, item.quantity - 1, item.color)}
                    >
                      −
                    </button>
                    <span style={{ padding: "0 0.4rem" }}>{item.quantity}</span>
                    <button
                      type="button"
                      onClick={() => setQty(item.product_id, item.quantity + 1, item.color)}
                    >
                      +
                    </button>
                  </div>
                  <button
                    className="btn btn-outline btn-sm"
                    type="button"
                    onClick={() => remove(item.product_id, item.color)}
                  >
                    Remove
                  </button>
                </div>
              </div>
              <strong>{money(item.price_cents * item.quantity)}</strong>
            </div>
          ))}
        </div>
        <aside className="panel">
          <h3 style={{ marginTop: 0 }}>Order summary</h3>
          <div className="summary-row">
            <span>Subtotal</span>
            <span>{money(subtotal)}</span>
          </div>
          <div className="summary-row">
            <span>Delivery & tax</span>
            <span>Calculated at checkout</span>
          </div>
          <div className="summary-row total">
            <span>Estimated</span>
            <span>{money(subtotal)}</span>
          </div>
          <Link className="btn btn-primary" to="/checkout" style={{ width: "100%", marginTop: "1rem" }}>
            Proceed to checkout
          </Link>
        </aside>
      </div>
    </div>
  );
}
