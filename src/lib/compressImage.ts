/** Resize/compress images before upload — Chromebook/camera photos often exceed API limits. */
export async function compressImageForUpload(
  file: File,
  options: { maxEdge?: number; maxBytes?: number; quality?: number } = {},
): Promise<File> {
  const maxEdge = options.maxEdge ?? 2000;
  const maxBytes = options.maxBytes ?? 2.5 * 1024 * 1024;
  const quality = options.quality ?? 0.82;

  if (!file.type.startsWith("image/") && !/\.(jpe?g|png|webp|gif|heic|heif)$/i.test(file.name)) {
    return file;
  }

  // Already small enough — skip work
  if (file.size <= maxBytes && file.type === "image/jpeg") {
    return file;
  }

  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return file;

  try {
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, width, height);

    let q = quality;
    let blob: Blob | null = null;
    for (let i = 0; i < 6; i++) {
      blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", q),
      );
      if (!blob) break;
      if (blob.size <= maxBytes) break;
      q = Math.max(0.45, q - 0.1);
    }

    if (!blob) return file;

    const base = file.name.replace(/\.[^.]+$/, "") || "photo";
    return new File([blob], `${base}.jpg`, {
      type: "image/jpeg",
      lastModified: Date.now(),
    });
  } finally {
    bitmap.close();
  }
}
