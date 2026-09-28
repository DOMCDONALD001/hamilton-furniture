import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../lib/api";
import { compressImageForUpload } from "../../lib/compressImage";
import { useToast } from "../../components/AdminUI";

type DropPhoto = {
  id: string;
  url: string;
  note: string | null;
  created_at: string;
};

export function AdminPhotoDrop() {
  const toast = useToast();
  const [photos, setPhotos] = useState<DropPhoto[]>([]);
  const [note, setNote] = useState("");
  const [uploading, setUploading] = useState(false);
  const [loading, setLoading] = useState(true);
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);

  async function load() {
    const data = await api<{ photos: DropPhoto[] }>("/api/admin/photo-drop");
    setPhotos(data.photos || []);
  }

  useEffect(() => {
    load()
      .catch(() => toast.push("Could not load dropspace", "err"))
      .finally(() => setLoading(false));
  }, []);

  async function uploadFiles(files: FileList | File[]) {
    const list = Array.from(files).filter((f) => f.type.startsWith("image/") || f.size > 0);
    if (!list.length) {
      toast.push("No image selected", "err");
      return;
    }
    setUploading(true);
    let ok = 0;
    try {
      for (const file of list) {
        toast.push(`Uploading ${file.name || "photo"}…`, "info");
        const optimized = await compressImageForUpload(file, {
          maxEdge: 2200,
          maxBytes: 2.8 * 1024 * 1024,
        });
        const fd = new FormData();
        fd.append("file", optimized);
        if (note.trim()) fd.append("note", note.trim());
        await api("/api/admin/photo-drop", { method: "POST", body: fd });
        ok += 1;
      }
      setNote("");
      await load();
      toast.push(ok === 1 ? "Photo saved to dropspace" : `${ok} photos saved to dropspace`);
    } catch (err) {
      toast.push(err instanceof Error ? err.message : "Upload failed", "err");
      await load().catch(() => {});
    } finally {
      setUploading(false);
    }
  }

  async function remove(id: string) {
    try {
      await api(`/api/admin/photo-drop/${id}`, { method: "DELETE" });
      setPhotos((prev) => prev.filter((p) => p.id !== id));
      toast.push("Photo removed", "info");
    } catch (err) {
      toast.push(err instanceof Error ? err.message : "Could not delete", "err");
    }
  }

  return (
    <div className="dropspace-page">
      <div className="toolbar" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
        <div>
          <h1 style={{ margin: 0 }}>Photo dropspace</h1>
          <p className="muted" style={{ margin: "0.35rem 0 0", maxWidth: 520 }}>
            Take pics on your phone here, then attach them when you add inventory on a computer.
          </p>
        </div>
        <Link className="btn btn-outline btn-sm" to="/admin/products">
          Open inventory →
        </Link>
      </div>

      <div className="dropspace-capture admin-panel">
        <h3 style={{ marginTop: 0 }}>Add photos</h3>
        <div className="field">
          <label>Optional note (e.g. “blue sofa — living room”)</label>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="What is this piece?"
            maxLength={200}
          />
        </div>

        <div className="dropspace-actions">
          <button
            className="btn btn-primary dropspace-big-btn"
            type="button"
            disabled={uploading}
            onClick={() => cameraRef.current?.click()}
          >
            {uploading ? "Uploading…" : "Take photo"}
          </button>
          <button
            className="btn btn-outline dropspace-big-btn"
            type="button"
            disabled={uploading}
            onClick={() => galleryRef.current?.click()}
          >
            Choose from gallery
          </button>
        </div>

        <input
          ref={cameraRef}
          type="file"
          accept="image/*"
          capture="environment"
          hidden
          onChange={(e) => {
            if (e.target.files?.length) uploadFiles(e.target.files);
            e.target.value = "";
          }}
        />
        <input
          ref={galleryRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files?.length) uploadFiles(e.target.files);
            e.target.value = "";
          }}
        />

        <p className="muted" style={{ fontSize: "0.85rem", marginBottom: 0 }}>
          Bookmark this page on your phone: after you log into admin, open{" "}
          <strong>Photo dropspace</strong>. Photos stay here until you attach them to a product.
        </p>
      </div>

      <div className="admin-panel">
        <div className="toolbar" style={{ justifyContent: "space-between" }}>
          <h3 style={{ margin: 0 }}>
            Staged photos ({photos.length})
          </h3>
          <button className="btn btn-outline btn-sm" type="button" onClick={() => load()}>
            Refresh
          </button>
        </div>

        {loading ? (
          <p className="muted">Loading…</p>
        ) : photos.length === 0 ? (
          <p className="muted" style={{ marginBottom: 0 }}>
            No photos yet. Use Take photo above — they’ll show up here for inventory.
          </p>
        ) : (
          <div className="dropspace-grid">
            {photos.map((p) => (
              <article className="dropspace-card" key={p.id}>
                <a href={p.url} target="_blank" rel="noreferrer" className="dropspace-thumb">
                  <img src={p.url} alt={p.note || "Staged photo"} />
                </a>
                <div className="dropspace-card-body">
                  {p.note ? <strong>{p.note}</strong> : <span className="muted">No note</span>}
                  <span className="muted" style={{ fontSize: "0.8rem" }}>
                    {new Date(p.created_at).toLocaleString()}
                  </span>
                  <button
                    className="btn btn-outline btn-sm"
                    type="button"
                    onClick={() => remove(p.id)}
                  >
                    Delete
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
