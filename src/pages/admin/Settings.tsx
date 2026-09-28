import type { FormEvent } from "react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../lib/api";
import { compressImageForUpload } from "../../lib/compressImage";
import { useToast } from "../../components/AdminUI";

const STORE_DEFAULTS = {
  brand_name: "Hamilton's Odds N Ends",
  brand_sub: "Furniture",
  topbar_text:
    "Local delivery across the Tupelo area · Members: use MEMBER15 · Guests: WELCOME10",
  hero_kicker: "Hamilton's · Odds N Ends · Furniture",
  hero_headline: "Hamilton's Odds N Ends Furniture",
  hero_subtext:
    "Browse living room, bedroom, dining, and one-of-a-kind finds — buy now or bid in our live auctions.",
  hero_cta_primary: "Shop inventory",
  hero_cta_secondary: "View auctions",
  hero_image_position: "center",
  featured_title: "Featured picks",
  featured_subtitle: "Hand-selected pieces ready for delivery or pickup",
  auctions_title: "Live auctions",
  auctions_subtitle: "Bid before the clock runs out",
  offers_title: "Active offers",
  offers_subtitle: "Promo codes at checkout — some are members only",
  footer_blurb:
    "Quality furniture and unique finds for every room — buy, sell, and deliver with a hometown marketplace feel.",
  store_phone: "",
  store_email: "",
  store_address: "",
  site_url: "https://hamiltonsoddsandends.com",
  tax_rate_bps: "725",
  notify_email: "hamiltonsbikes216@gmail.com",
  email_from: "orders@hamiltonsoddsandends.com",
  email_from_name: "Hamilton's Odds N Ends Furniture",
  /** "1" show In-store sale tab; "0" hide (default) */
  show_pos_tab: "0",
  /** Temporary: Square live switch + credentials */
  square_live: "0",
  square_sandbox_application_id: "",
  square_sandbox_location_id: "",
  square_sandbox_access_token: "",
  square_application_id: "",
  square_location_id: "",
  square_access_token: "",
};

type StoreForm = typeof STORE_DEFAULTS;

export function AdminSettings() {
  const toast = useToast();
  const [settings, setSettings] = useState<StoreForm>({ ...STORE_DEFAULTS });
  const [heroImage, setHeroImage] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [adminEmail, setAdminEmail] = useState("");
  const [saved, setSaved] = useState(false);
  const [tokenSet, setTokenSet] = useState(false);
  const [sandboxTokenSet, setSandboxTokenSet] = useState(false);
  const [activeEnv, setActiveEnv] = useState<"sandbox" | "production">("sandbox");
  const [activeConfigured, setActiveConfigured] = useState(false);
  const [pw, setPw] = useState({ current: "", next: "", confirm: "" });

  useEffect(() => {
    api<{ settings: Record<string, string> }>("/api/admin/settings").then((d) => {
      const next = { ...STORE_DEFAULTS };
      for (const key of Object.keys(STORE_DEFAULTS) as (keyof StoreForm)[]) {
        if (key === "square_access_token" || key === "square_sandbox_access_token") continue;
        if (d.settings[key] != null && d.settings[key] !== "") {
          next[key] = d.settings[key];
        }
      }
      setSettings(next);
      setTokenSet(d.settings.square_access_token_set === "1");
      setSandboxTokenSet(d.settings.square_sandbox_access_token_set === "1");
      setActiveEnv(d.settings.square_active_environment === "production" ? "production" : "sandbox");
      setActiveConfigured(d.settings.square_active_configured === "1");
      if (d.settings.hero_image_key) {
        setHeroImage(`/api/images/${d.settings.hero_image_key}`);
      }
    });
    api<{ email: string | null }>("/api/admin/me").then((d) => {
      if (d.email) setAdminEmail(d.email);
    });
  }, []);

  function field<K extends keyof StoreForm>(key: K, value: StoreForm[K]) {
    setSettings((s) => ({ ...s, [key]: value }));
  }

  async function uploadHero(file: File) {
    setUploading(true);
    try {
      const optimized = await compressImageForUpload(file, {
        maxEdge: 2400,
        maxBytes: 3 * 1024 * 1024,
      });
      const fd = new FormData();
      fd.append("file", optimized);
      const data = await api<{ hero_image: string }>("/api/admin/hero-image", {
        method: "POST",
        body: fd,
      });
      setHeroImage(data.hero_image);
      toast.push("Hero image uploaded");
    } catch (err) {
      toast.push(err instanceof Error ? err.message : "Upload failed", "err");
    } finally {
      setUploading(false);
    }
  }

  async function removeHero() {
    try {
      await api("/api/admin/hero-image", { method: "DELETE" });
      setHeroImage(null);
      toast.push("Hero image removed", "info");
    } catch (err) {
      toast.push(err instanceof Error ? err.message : "Could not remove image", "err");
    }
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    if (settings.square_live === "1") {
      if (!settings.square_application_id.trim() || !settings.square_location_id.trim()) {
        toast.push("Live mode needs Application ID and Location ID", "err");
        return;
      }
      if (!tokenSet && !settings.square_access_token.trim()) {
        toast.push("Live mode needs a production Access Token", "err");
        return;
      }
    } else if (
      !settings.square_sandbox_application_id.trim() ||
      !settings.square_sandbox_location_id.trim()
    ) {
      toast.push("Sandbox needs Application ID and Location ID", "err");
      return;
    } else if (!sandboxTokenSet && !settings.square_sandbox_access_token.trim()) {
      toast.push("Sandbox needs an Access Token (or keep the one already on the server)", "err");
      return;
    }
    try {
      await api("/api/admin/settings", {
        method: "PUT",
        body: JSON.stringify(settings),
      });
      const refreshed = await api<{ settings: Record<string, string> }>("/api/admin/settings");
      setTokenSet(refreshed.settings.square_access_token_set === "1");
      setSandboxTokenSet(refreshed.settings.square_sandbox_access_token_set === "1");
      setActiveEnv(
        refreshed.settings.square_active_environment === "production" ? "production" : "sandbox",
      );
      setActiveConfigured(refreshed.settings.square_active_configured === "1");
      setSettings((s) => ({
        ...s,
        square_access_token: "",
        square_sandbox_access_token: "",
        square_sandbox_application_id:
          refreshed.settings.square_sandbox_application_id || s.square_sandbox_application_id,
        square_sandbox_location_id:
          refreshed.settings.square_sandbox_location_id || s.square_sandbox_location_id,
      }));
      setSaved(true);
      toast.push(
        settings.square_live === "1"
          ? "Saved — Live Square payments are ON"
          : "Store settings saved (Square sandbox)",
      );
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      toast.push(err instanceof Error ? err.message : "Could not save", "err");
    }
  }

  async function changePassword(e: FormEvent) {
    e.preventDefault();
    if (pw.next !== pw.confirm) {
      toast.push("New passwords do not match", "err");
      return;
    }
    try {
      await api("/api/admin/change-password", {
        method: "POST",
        body: JSON.stringify({
          current_password: pw.current,
          new_password: pw.next,
        }),
      });
      setPw({ current: "", next: "", confirm: "" });
      toast.push("Password updated");
    } catch (err) {
      toast.push(err instanceof Error ? err.message : "Could not update password", "err");
    }
  }

  return (
    <div>
      <div className="toolbar" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
        <h1 style={{ margin: 0 }}>Settings</h1>
        <Link className="btn btn-outline btn-sm" to="/" target="_blank" rel="noreferrer">
          View store page
        </Link>
      </div>

      <form className="admin-panel" style={{ maxWidth: 720 }} onSubmit={save}>
        <h3 style={{ marginTop: 0 }}>Store page content</h3>
        <p className="muted" style={{ marginTop: 0 }}>
          These fields control what shoppers see on the homepage, header, and footer.
        </p>

        <div className="grid-2">
          <div className="field">
            <label>Brand name</label>
            <input
              value={settings.brand_name}
              onChange={(e) => field("brand_name", e.target.value)}
            />
          </div>
          <div className="field">
            <label>Brand subtitle</label>
            <input
              value={settings.brand_sub}
              onChange={(e) => field("brand_sub", e.target.value)}
            />
          </div>
        </div>

        <div className="field">
          <label>Top announcement bar</label>
          <input
            value={settings.topbar_text}
            onChange={(e) => field("topbar_text", e.target.value)}
          />
        </div>

        <h3>Hero banner (green spot)</h3>
        <p className="muted" style={{ marginTop: 0 }}>
          Upload a wide photo of your showroom or furniture. It fills the dark banner edge-to-edge
          with a soft overlay so the headline stays readable.
        </p>
        <div className="hero-upload-preview">
          {heroImage ? (
            <img src={heroImage} alt="Hero preview" />
          ) : (
            <div className="muted">No hero image yet — upload one to fill the homepage banner.</div>
          )}
        </div>
        <div className="field">
          <label>Hero image</label>
          <input
            type="file"
            accept="image/*"
            disabled={uploading}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) uploadHero(file);
              e.target.value = "";
            }}
          />
        </div>
        <div className="grid-2">
          <div className="field">
            <label>Image focus</label>
            <select
              value={settings.hero_image_position}
              onChange={(e) => field("hero_image_position", e.target.value)}
            >
              <option value="center">Center</option>
              <option value="right">Favor right (faces / product)</option>
              <option value="left">Favor left</option>
            </select>
          </div>
          <div className="field" style={{ display: "flex", alignItems: "end" }}>
            {heroImage && (
              <button className="btn btn-outline btn-sm" type="button" onClick={removeHero}>
                Remove image
              </button>
            )}
          </div>
        </div>

        <div className="field">
          <label>Hero kicker</label>
          <input
            value={settings.hero_kicker}
            onChange={(e) => field("hero_kicker", e.target.value)}
          />
        </div>
        <div className="field">
          <label>Hero headline</label>
          <input
            value={settings.hero_headline}
            onChange={(e) => field("hero_headline", e.target.value)}
          />
        </div>
        <div className="field">
          <label>Hero supporting text</label>
          <textarea
            rows={3}
            value={settings.hero_subtext}
            onChange={(e) => field("hero_subtext", e.target.value)}
          />
        </div>
        <div className="grid-2">
          <div className="field">
            <label>Primary button text</label>
            <input
              value={settings.hero_cta_primary}
              onChange={(e) => field("hero_cta_primary", e.target.value)}
            />
          </div>
          <div className="field">
            <label>Secondary button text</label>
            <input
              value={settings.hero_cta_secondary}
              onChange={(e) => field("hero_cta_secondary", e.target.value)}
            />
          </div>
        </div>

        <div className="grid-2">
          <div className="field">
            <label>Featured section title</label>
            <input
              value={settings.featured_title}
              onChange={(e) => field("featured_title", e.target.value)}
            />
          </div>
          <div className="field">
            <label>Featured section subtitle</label>
            <input
              value={settings.featured_subtitle}
              onChange={(e) => field("featured_subtitle", e.target.value)}
            />
          </div>
        </div>
        <div className="grid-2">
          <div className="field">
            <label>Auctions section title</label>
            <input
              value={settings.auctions_title}
              onChange={(e) => field("auctions_title", e.target.value)}
            />
          </div>
          <div className="field">
            <label>Auctions section subtitle</label>
            <input
              value={settings.auctions_subtitle}
              onChange={(e) => field("auctions_subtitle", e.target.value)}
            />
          </div>
        </div>
        <div className="grid-2">
          <div className="field">
            <label>Offers section title</label>
            <input
              value={settings.offers_title}
              onChange={(e) => field("offers_title", e.target.value)}
            />
          </div>
          <div className="field">
            <label>Offers section subtitle</label>
            <input
              value={settings.offers_subtitle}
              onChange={(e) => field("offers_subtitle", e.target.value)}
            />
          </div>
        </div>

        <div className="field">
          <label>Footer blurb</label>
          <textarea
            rows={3}
            value={settings.footer_blurb}
            onChange={(e) => field("footer_blurb", e.target.value)}
          />
        </div>

        <h3>Contact & tax</h3>
        <div className="field">
          <label>Public site URL (hang tags, emails, QR codes)</label>
          <input
            type="url"
            value={settings.site_url}
            onChange={(e) => field("site_url", e.target.value)}
            placeholder="https://hamiltonsoddsandends.com"
          />
        </div>
        <div className="field">
          <label>Store phone</label>
          <input
            value={settings.store_phone}
            onChange={(e) => field("store_phone", e.target.value)}
          />
        </div>
        <div className="field">
          <label>Store email</label>
          <input
            value={settings.store_email}
            onChange={(e) => field("store_email", e.target.value)}
            placeholder="hello@hamiltonsoddsandends.com"
          />
        </div>
        <div className="field">
          <label>Store address</label>
          <input
            value={settings.store_address}
            onChange={(e) => field("store_address", e.target.value)}
          />
        </div>
        <div className="field">
          <label>Tax rate (basis points, 725 = 7.25%)</label>
          <input
            value={settings.tax_rate_bps}
            onChange={(e) => field("tax_rate_bps", e.target.value)}
          />
        </div>

        <h3>Order email alerts</h3>
        <p className="muted" style={{ marginTop: 0 }}>
          Customers get a confirmation when they pay, and another email whenever you update their
          order status. You also get a separate store alert.
        </p>
        <div className="field">
          <label>Notify me at (your inbox)</label>
          <input
            type="email"
            value={settings.notify_email}
            onChange={(e) => field("notify_email", e.target.value)}
            placeholder="hamiltonsbikes216@gmail.com"
          />
        </div>
        <div className="field">
          <label>From email (must be on your verified Resend domain)</label>
          <input
            type="email"
            value={settings.email_from}
            onChange={(e) => field("email_from", e.target.value)}
            placeholder="orders@hamiltonsoddsandends.com"
          />
        </div>
        <div className="field">
          <label>From name</label>
          <input
            value={settings.email_from_name}
            onChange={(e) => field("email_from_name", e.target.value)}
          />
        </div>
        <p className="muted" style={{ fontSize: "0.85rem" }}>
          <strong>Required for customer emails:</strong> verify your domain at{" "}
          <a href="https://resend.com/domains" target="_blank" rel="noreferrer">
            resend.com/domains
          </a>
          , then set From to something like <code>orders@yourdomain.com</code>. Until then Resend
          can only email <em>your</em> Gmail — customers will not receive confirms.
        </p>

        <h3>Admin features</h3>
        <label style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12 }}>
          <input
            type="checkbox"
            checked={settings.show_pos_tab === "1"}
            onChange={(e) => field("show_pos_tab", e.target.checked ? "1" : "0")}
          />
          Show <strong>In-store sale</strong> tab in the admin menu
        </label>
        <p className="muted" style={{ fontSize: "0.85rem", marginTop: 0 }}>
          Leave this off if you are not using walk-in POS right now. Turn it back on anytime.
        </p>

        <div className="square-live-panel">
          <h3 style={{ marginTop: 0 }}>Square payments (temporary)</h3>
          <p className="muted" style={{ marginTop: 0 }}>
            Sandbox credentials are prefilled from the server. Flip Live on and fill production keys
            when you are ready to charge real cards. Flip off anytime to return to sandbox.
          </p>

          <div className="square-live-row">
            <div>
              <div className="square-live-label">Sandbox</div>
              <div className="muted" style={{ fontSize: "0.8rem" }}>
                Test cards only
              </div>
            </div>
            <label className="square-switch" title="Toggle live Square payments">
              <input
                type="checkbox"
                checked={settings.square_live === "1"}
                onChange={(e) => field("square_live", e.target.checked ? "1" : "0")}
              />
              <span className="square-switch-track" />
            </label>
            <div style={{ textAlign: "right" }}>
              <div className="square-live-label">Live</div>
              <div className="muted" style={{ fontSize: "0.8rem" }}>
                Real money
              </div>
            </div>
          </div>

          <p
            className={`square-status ${activeEnv === "production" ? "is-live" : "is-sandbox"}`}
          >
            Currently charging with:{" "}
            <strong>{activeEnv === "production" ? "LIVE (production)" : "Sandbox"}</strong>
            {activeConfigured ? " · credentials OK" : " · not fully configured"}
          </p>

          <h4 style={{ margin: "0 0 0.5rem", fontSize: "0.95rem" }}>Sandbox credentials</h4>
          <div className="field">
            <label>Sandbox Application ID</label>
            <input
              value={settings.square_sandbox_application_id}
              onChange={(e) => field("square_sandbox_application_id", e.target.value)}
              placeholder="sandbox-sq0idb-…"
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          <div className="field">
            <label>Sandbox Location ID</label>
            <input
              value={settings.square_sandbox_location_id}
              onChange={(e) => field("square_sandbox_location_id", e.target.value)}
              placeholder="L…"
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          <div className="field">
            <label>
              Sandbox Access Token
              {sandboxTokenSet && !settings.square_sandbox_access_token
                ? " (saved on server — leave blank to keep)"
                : ""}
            </label>
            <input
              type="password"
              value={settings.square_sandbox_access_token}
              onChange={(e) => field("square_sandbox_access_token", e.target.value)}
              placeholder={sandboxTokenSet ? "••••••••••••••••" : "EAAAl…"}
              autoComplete="new-password"
              spellCheck={false}
            />
          </div>

          <h4 style={{ margin: "1.25rem 0 0.5rem", fontSize: "0.95rem" }}>
            Live / production credentials
          </h4>
          <div className="field">
            <label>Production Application ID</label>
            <input
              value={settings.square_application_id}
              onChange={(e) => field("square_application_id", e.target.value)}
              placeholder="sq0idp-…"
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          <div className="field">
            <label>Production Location ID</label>
            <input
              value={settings.square_location_id}
              onChange={(e) => field("square_location_id", e.target.value)}
              placeholder="L…"
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          <div className="field">
            <label>
              Production Access Token
              {tokenSet && !settings.square_access_token
                ? " (saved — leave blank to keep)"
                : ""}
            </label>
            <input
              type="password"
              value={settings.square_access_token}
              onChange={(e) => field("square_access_token", e.target.value)}
              placeholder={tokenSet ? "••••••••••••••••" : "EAAAl…"}
              autoComplete="new-password"
              spellCheck={false}
            />
          </div>
          <p className="muted" style={{ fontSize: "0.85rem", marginBottom: 0 }}>
            Get production keys from{" "}
            <a href="https://developer.squareup.com/apps" target="_blank" rel="noreferrer">
              Square Developer → your app → Production
            </a>
            . Access tokens stay on the server and are never shown again after save.
          </p>
        </div>

        <button className="btn btn-primary" type="submit" style={{ marginTop: "1.25rem" }}>
          Save store page settings
        </button>
        {saved && <span style={{ marginLeft: 12 }}>Saved</span>}
      </form>

      <form className="admin-panel" style={{ maxWidth: 720, marginTop: "1rem" }} onSubmit={changePassword}>
        <h3 style={{ marginTop: 0 }}>Owner account</h3>
        <p className="muted" style={{ marginTop: 0 }}>
          Signed in as <strong>{adminEmail || "—"}</strong>
        </p>
        <div className="field">
          <label>Current password</label>
          <input
            type="password"
            required
            autoComplete="current-password"
            value={pw.current}
            onChange={(e) => setPw({ ...pw, current: e.target.value })}
          />
        </div>
        <div className="field">
          <label>New password</label>
          <input
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            value={pw.next}
            onChange={(e) => setPw({ ...pw, next: e.target.value })}
          />
        </div>
        <div className="field">
          <label>Confirm new password</label>
          <input
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            value={pw.confirm}
            onChange={(e) => setPw({ ...pw, confirm: e.target.value })}
          />
        </div>
        <button className="btn btn-primary" type="submit">
          Update password
        </button>
      </form>
    </div>
  );
}
