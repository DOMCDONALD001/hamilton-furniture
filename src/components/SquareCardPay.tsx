import { useEffect, useRef, useState, type MutableRefObject } from "react";

type PaymentsConfig = {
  enabled: boolean;
  applicationId: string | null;
  locationId: string | null;
  environment: "sandbox" | "production";
};

type SquareCardInstance = {
  attach: (selector: string) => Promise<void>;
  destroy: () => Promise<void>;
  tokenize: () => Promise<{
    status: string;
    token?: string;
    errors?: Array<{ message?: string }>;
  }>;
};

declare global {
  interface Window {
    Square?: {
      payments: (
        applicationId: string,
        locationId: string,
      ) => Promise<{
        card: () => Promise<SquareCardInstance>;
      }>;
    };
  }
}

function loadSquareScript(environment: "sandbox" | "production") {
  const src =
    environment === "production"
      ? "https://web.squarecdn.com/v1/square.js"
      : "https://sandbox.web.squarecdn.com/v1/square.js";
  const existing = document.querySelector<HTMLScriptElement>(`script[src="${src}"]`);
  if (existing) {
    return existing.dataset.loaded === "1"
      ? Promise.resolve()
      : new Promise<void>((resolve, reject) => {
          existing.addEventListener("load", () => resolve());
          existing.addEventListener("error", () => reject(new Error("Square SDK failed to load")));
        });
  }
  return new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.onload = () => {
      script.dataset.loaded = "1";
      resolve();
    };
    script.onerror = () => reject(new Error("Square SDK failed to load"));
    document.head.appendChild(script);
  });
}

export function SquareCardPay({
  config,
  onReadyChange,
  cardRef,
}: {
  config: PaymentsConfig;
  onReadyChange?: (ready: boolean) => void;
  cardRef: MutableRefObject<SquareCardInstance | null>;
}) {
  const containerId = useRef(`square-card-${Math.random().toString(36).slice(2)}`);
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let card: SquareCardInstance | null = null;

    async function init() {
      if (!config.enabled || !config.applicationId || !config.locationId) {
        onReadyChange?.(false);
        return;
      }
      setError("");
      setReady(false);
      onReadyChange?.(false);
      try {
        await loadSquareScript(config.environment);
        if (cancelled || !window.Square) throw new Error("Square SDK unavailable");
        const payments = await window.Square.payments(
          config.applicationId,
          config.locationId,
        );
        card = await payments.card();
        await card.attach(`#${containerId.current}`);
        if (cancelled) {
          await card.destroy();
          return;
        }
        cardRef.current = card;
        setReady(true);
        onReadyChange?.(true);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Could not load card form");
        onReadyChange?.(false);
      }
    }

    init();
    return () => {
      cancelled = true;
      cardRef.current = null;
      if (card) card.destroy().catch(() => {});
    };
  }, [config.enabled, config.applicationId, config.locationId, config.environment]);

  if (!config.enabled) return null;

  return (
    <div className="square-pay">
      <label>Card payment</label>
      <div id={containerId.current} className="square-card-box" />
      {!ready && !error && <p className="muted" style={{ margin: "0.5rem 0 0", fontSize: "0.85rem" }}>Loading secure card form…</p>}
      {error && <p style={{ color: "var(--danger)", margin: "0.5rem 0 0" }}>{error}</p>}
      {config.environment === "sandbox" && (
        <p className="muted" style={{ margin: "0.5rem 0 0", fontSize: "0.8rem" }}>
          Sandbox mode — use test card 4111 1111 1111 1111, any future expiry, any CVV/ZIP.
        </p>
      )}
    </div>
  );
}

export type { PaymentsConfig, SquareCardInstance };
