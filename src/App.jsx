import { useEffect, useMemo, useRef, useState } from "react";
import { PDFDocument, StandardFonts, degrees, rgb } from "pdf-lib";
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";
import workerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";

GlobalWorkerOptions.workerSrc = workerSrc;

const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024;
const FILE_COLORS = ["#3b82f6", "#8b5cf6", "#22c55e", "#f97316", "#ec4899"];
const IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp"];
const A4_WIDTH_PT = 595.28;
const WATERMARK_COLORS = {
  red: { label: "Red", hex: "#ef4444", rgb: [0.937, 0.267, 0.267] },
  black: { label: "Black", hex: "#111111", rgb: [0.067, 0.067, 0.067] },
  blue: { label: "Blue", hex: "#3b82f6", rgb: [0.231, 0.51, 0.965] },
  gray: { label: "Gray", hex: "#6b7280", rgb: [0.42, 0.447, 0.502] },
};

function extensionOf(name) {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot).toLowerCase() : "";
}

function detectFileKind(file) {
  const ext = extensionOf(file.name);
  if (ext === ".pdf") return "pdf";
  if (IMAGE_EXTENSIONS.includes(ext)) return "image";
  return null;
}

async function loadImageElementFromObjectUrl(objectUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = objectUrl;
  });
}

async function blobToUint8Array(blob) {
  return new Uint8Array(await blob.arrayBuffer());
}

async function prepareImageSource(file) {
  const objectUrl = URL.createObjectURL(file);
  const img = await loadImageElementFromObjectUrl(objectUrl);
  const width = img.naturalWidth || 1;
  const height = img.naturalHeight || 1;

  const ext = extensionOf(file.name);
  const inputMime = (file.type || "").toLowerCase();
  const isJpg = inputMime === "image/jpeg" || inputMime === "image/jpg" || ext === ".jpg" || ext === ".jpeg";
  const isPng = inputMime === "image/png" || ext === ".png";
  const isWebp = inputMime === "image/webp" || ext === ".webp";

  if (isJpg || isPng) {
    const bytes = await blobToUint8Array(file);
    return {
      thumbnailUrl: objectUrl,
      width,
      height,
      bytes,
      mimeType: isJpg ? "image/jpeg" : "image/png",
    };
  }

  if (isWebp) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0, width, height);
    const pngBlob = await new Promise((resolve, reject) => {
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Failed to convert WebP image."))), "image/png", 1);
    });
    const bytes = await blobToUint8Array(pngBlob);
    return {
      thumbnailUrl: objectUrl,
      width,
      height,
      bytes,
      mimeType: "image/png",
    };
  }

  throw new Error("Unsupported image format.");
}

function createId(prefix = "id") {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return `${prefix}-${crypto.randomUUID()}`;
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function formatBytes(bytes) {
  if (!bytes) return "0 KB";
  const mb = bytes / (1024 * 1024);
  if (mb >= 1) return `${mb.toFixed(2)} MB`;
  return `${(bytes / 1024).toFixed(0)} KB`;
}

function pageLabel(count) {
  return `${count} ${count === 1 ? "page" : "pages"}`;
}

function buildExportName(preset, customName) {
  const today = new Date().toISOString().slice(0, 10);
  if (preset === "merged") return "merged.pdf";
  if (preset === "document_date") return `document_${today}.pdf`;
  const cleaned = (customName || "merged").trim().replace(/\.pdf$/i, "");
  return `${cleaned || "merged"}.pdf`;
}

function App() {
  const [filesMeta, setFilesMeta] = useState([]);
  const [pages, setPages] = useState([]);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [uploadProgress, setUploadProgress] = useState({});
  const [toasts, setToasts] = useState([]);
  const [draggingId, setDraggingId] = useState(null);
  const [dropIndex, setDropIndex] = useState(null);
  const [touchDraggingId, setTouchDraggingId] = useState(null);
  const [touchDropIndex, setTouchDropIndex] = useState(null);
  const [history, setHistory] = useState([]);
  const [removingIds, setRemovingIds] = useState(new Set());
  const [exportOpen, setExportOpen] = useState(false);
  const [filenamePreset, setFilenamePreset] = useState("merged");
  const [customName, setCustomName] = useState("merged");
  const [estimatedBytes, setEstimatedBytes] = useState(0);
  const [isEstimating, setIsEstimating] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [watermarkEnabled, setWatermarkEnabled] = useState(false);
  const [watermarkText, setWatermarkText] = useState("CONFIDENTIAL");
  const [watermarkFontSize, setWatermarkFontSize] = useState(48);
  const [watermarkOpacityPercent, setWatermarkOpacityPercent] = useState(30);
  const [watermarkColor, setWatermarkColor] = useState("gray");
  const [watermarkPosition, setWatermarkPosition] = useState("center_diagonal");

  const fileInputRef = useRef(null);
  const sourceBytesRef = useRef(new Map());
  const colorIndexRef = useRef(0);

  const pageCount = pages.length;
  const fileCount = useMemo(() => new Set(pages.map((p) => p.sourceFileId)).size, [pages]);

  const sourceCounts = useMemo(() => {
    const counts = new Map();
    pages.forEach((page) => {
      counts.set(page.sourceFileId, (counts.get(page.sourceFileId) || 0) + 1);
    });
    return counts;
  }, [pages]);

  const fileMap = useMemo(() => {
    const map = new Map();
    filesMeta.forEach((file) => map.set(file.id, file));
    return map;
  }, [filesMeta]);

  const groupedSegments = useMemo(() => {
    const segments = [];
    let lastSourceId = null;
    pages.forEach((page, index) => {
      if (page.sourceFileId !== lastSourceId) {
        segments.push({
          type: "header",
          key: `header-${page.sourceFileId}-${index}`,
          sourceFileId: page.sourceFileId,
        });
        lastSourceId = page.sourceFileId;
      }
      segments.push({ type: "page", key: page.id, page, index });
    });
    return segments;
  }, [pages]);

  const allSelected = pageCount > 0 && selectedIds.size === pageCount;
  const exportBlockedByWatermark = watermarkEnabled && !watermarkText.trim();

  const pushHistory = () => {
    setHistory((prev) => {
      const snapshot = {
        pages: pages.map((page) => ({ ...page })),
        selectedIds: Array.from(selectedIds),
      };
      return [...prev.slice(-19), snapshot];
    });
  };

  const showToast = (message, type = "error") => {
    const id = createId("toast");
    setToasts((prev) => [...prev, { id, message, type }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3000);
  };

  async function renderPageThumbnail(pdfDoc, pageNumber) {
    const page = await pdfDoc.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 0.34 });
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.floor(viewport.width));
    canvas.height = Math.max(1, Math.floor(viewport.height));
    const context = canvas.getContext("2d", { alpha: false });
    await page.render({ canvasContext: context, viewport }).promise;
    return canvas.toDataURL("image/jpeg", 0.75);
  }

  function reorderPages(currentPages, sourceId, targetIndex) {
    const fromIndex = currentPages.findIndex((p) => p.id === sourceId);
    if (fromIndex < 0 || targetIndex == null) return currentPages;
    let normalizedTarget = targetIndex;
    if (targetIndex > fromIndex) normalizedTarget -= 1;
    if (normalizedTarget === fromIndex || normalizedTarget < 0) return currentPages;
    const updated = [...currentPages];
    const [moved] = updated.splice(fromIndex, 1);
    updated.splice(Math.min(normalizedTarget, updated.length), 0, moved);
    return updated;
  }

  async function handleAddFiles(fileList) {
    const entries = Array.from(fileList || []);
    if (!entries.length) return;

    for (const file of entries) {
      const fileKind = detectFileKind(file);
      if (!fileKind) {
        showToast(`${file.name}: only PDF, JPG, PNG, and WebP files are supported.`);
        continue;
      }

      if (file.size > MAX_FILE_SIZE_BYTES) {
        showToast(`${file.name}: max size is 50MB per file.`);
        continue;
      }

      const sourceFileId = createId("file");
      const color = FILE_COLORS[colorIndexRef.current % FILE_COLORS.length];
      colorIndexRef.current += 1;
      setFilesMeta((prev) => [...prev, { id: sourceFileId, name: file.name, color }]);

      try {
        if (fileKind === "pdf") {
          const bytes = new Uint8Array(await file.arrayBuffer());
          sourceBytesRef.current.set(sourceFileId, { kind: "pdf", bytes: new Uint8Array(bytes) });

          const pdfLibDoc = await PDFDocument.load(bytes, { ignoreEncryption: false });
          const pageTotal = pdfLibDoc.getPageCount();

          const loadingTask = getDocument({ data: bytes });
          const pdfJsDoc = await loadingTask.promise;

          setUploadProgress((prev) => ({
            ...prev,
            [sourceFileId]: { name: file.name, done: 0, total: pageTotal, status: "processing" },
          }));

          const nextPages = [];
          for (let i = 0; i < pageTotal; i += 1) {
            const thumb = await renderPageThumbnail(pdfJsDoc, i + 1);
            const originalRotation = pdfLibDoc.getPage(i).getRotation().angle || 0;
            nextPages.push({
              id: createId("page"),
              sourceFileId,
              sourceFileName: file.name,
              sourcePageIndex: i,
              sourcePageNumber: i + 1,
              thumbnail: thumb,
              sourceKind: "pdf",
              rotation: 0,
              originalRotation,
            });
            setUploadProgress((prev) => ({
              ...prev,
              [sourceFileId]: {
                ...prev[sourceFileId],
                done: i + 1,
                total: pageTotal,
                status: i + 1 === pageTotal ? "done" : "processing",
              },
            }));
          }

          setPages((prev) => [...prev, ...nextPages]);
        } else {
          setUploadProgress((prev) => ({
            ...prev,
            [sourceFileId]: { name: file.name, done: 0, total: 1, status: "processing" },
          }));

          const imageData = await prepareImageSource(file);
          sourceBytesRef.current.set(sourceFileId, {
            kind: "image",
            bytes: imageData.bytes,
            mimeType: imageData.mimeType,
            width: imageData.width,
            height: imageData.height,
          });

          setPages((prev) => [
            ...prev,
            {
              id: createId("page"),
              sourceFileId,
              sourceFileName: file.name,
              sourcePageIndex: 0,
              sourcePageNumber: 1,
              thumbnail: imageData.thumbnailUrl,
              sourceKind: "image",
              rotation: 0,
              originalRotation: 0,
            },
          ]);

          setUploadProgress((prev) => ({
            ...prev,
            [sourceFileId]: { ...prev[sourceFileId], done: 1, total: 1, status: "done" },
          }));
        }
      } catch (error) {
        sourceBytesRef.current.delete(sourceFileId);
        setFilesMeta((prev) => prev.filter((f) => f.id !== sourceFileId));
        const message = String(error?.message || "").toLowerCase();
        if (fileKind === "pdf" && (error?.name === "PasswordException" || message.includes("password"))) {
          showToast("Password protected PDFs are not supported yet");
        } else if (fileKind === "pdf" && message.includes("encrypted")) {
          showToast("Password protected PDFs are not supported yet");
        } else {
          showToast(`${file.name}: invalid or unsupported file.`);
        }
      }
    }

    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function onDropFiles(event) {
    event.preventDefault();
    handleAddFiles(event.dataTransfer.files);
  }

  function toggleSelection(id) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function rotatePage(id) {
    pushHistory();
    setPages((prev) =>
      prev.map((page) => (page.id === id ? { ...page, rotation: (page.rotation + 90) % 360 } : page))
    );
  }

  function removeIdsWithAnimation(ids) {
    if (!ids.length) return;
    pushHistory();
    setRemovingIds((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => next.add(id));
      return next;
    });

    window.setTimeout(() => {
      setPages((prev) => prev.filter((page) => !ids.includes(page.id)));
      setSelectedIds((prev) => {
        const next = new Set(prev);
        ids.forEach((id) => next.delete(id));
        return next;
      });
      setRemovingIds((prev) => {
        const next = new Set(prev);
        ids.forEach((id) => next.delete(id));
        return next;
      });
    }, 200);
  }

  function deleteSelected() {
    const ids = Array.from(selectedIds);
    if (!ids.length) return;
    removeIdsWithAnimation(ids);
  }

  function undoLastAction() {
    const last = history[history.length - 1];
    if (!last) return;
    setHistory((prev) => prev.slice(0, -1));
    setPages(last.pages);
    setSelectedIds(new Set(last.selectedIds));
    setRemovingIds(new Set());
  }

  function onDragStart(event, id) {
    setDraggingId(id);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", id);
  }

  function onDragOverCard(event, index) {
    event.preventDefault();
    setDropIndex(index);
  }

  function onDropReorder(event) {
    event.preventDefault();
    const draggedId = draggingId || event.dataTransfer.getData("text/plain");
    if (!draggedId || dropIndex == null) return;
    const reordered = reorderPages(pages, draggedId, dropIndex);
    if (reordered !== pages) {
      pushHistory();
      setPages(reordered);
    }
    setDraggingId(null);
    setDropIndex(null);
  }

  function onDragEnd() {
    setDraggingId(null);
    setDropIndex(null);
  }

  function startTouchDrag(id) {
    setTouchDraggingId(id);
    setTouchDropIndex(pages.findIndex((p) => p.id === id));
  }

  useEffect(() => {
    if (!touchDraggingId) return undefined;

    const onMove = (event) => {
      const touch = event.touches?.[0];
      if (!touch) return;
      const el = document.elementFromPoint(touch.clientX, touch.clientY);
      const card = el?.closest?.("[data-page-id]");
      if (!card) return;
      const id = card.getAttribute("data-page-id");
      const idx = pages.findIndex((p) => p.id === id);
      if (idx >= 0) setTouchDropIndex(idx);
      event.preventDefault();
    };

    const onEnd = () => {
      if (touchDropIndex == null) {
        setTouchDraggingId(null);
        return;
      }
      const reordered = reorderPages(pages, touchDraggingId, touchDropIndex);
      if (reordered !== pages) {
        pushHistory();
        setPages(reordered);
      }
      setTouchDraggingId(null);
      setTouchDropIndex(null);
    };

    window.addEventListener("touchmove", onMove, { passive: false });
    window.addEventListener("touchend", onEnd);

    return () => {
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
    };
  }, [touchDraggingId, touchDropIndex, pages]);

  useEffect(() => {
    const activeSourceIds = new Set(pages.map((page) => page.sourceFileId));
    setFilesMeta((prev) => prev.filter((file) => activeSourceIds.has(file.id) || uploadProgress[file.id]));
  }, [pages, uploadProgress]);

  async function loadPdfForExport(bytes) {
    try {
      return await PDFDocument.load(new Uint8Array(bytes), { ignoreEncryption: false });
    } catch {
      // Fallback for edge-case PDFs that parse with strict mode off.
      return PDFDocument.load(new Uint8Array(bytes), { ignoreEncryption: true });
    }
  }

  async function buildMergedPdfBytes(pageItems) {
    const merged = await PDFDocument.create();
    const cache = new Map();

    for (const pageInfo of pageItems) {
      const sourceEntry = sourceBytesRef.current.get(pageInfo.sourceFileId);
      if (!sourceEntry) continue;

      if ((pageInfo.sourceKind || sourceEntry.kind) === "image") {
        const finalRotation = (pageInfo.originalRotation + pageInfo.rotation) % 360;
        const sourceWidth = sourceEntry.width || 1;
        const sourceHeight = sourceEntry.height || 1;
        const ratio = sourceHeight / sourceWidth;
        const pageHeight = Math.max(1, A4_WIDTH_PT * ratio);
        const page = merged.addPage([A4_WIDTH_PT, pageHeight]);
        let embeddedImage;
        if (sourceEntry.mimeType === "image/jpeg") {
          embeddedImage = await merged.embedJpg(sourceEntry.bytes);
        } else {
          embeddedImage = await merged.embedPng(sourceEntry.bytes);
        }
        page.drawImage(embeddedImage, { x: 0, y: 0, width: A4_WIDTH_PT, height: pageHeight });
        page.setRotation(degrees(finalRotation));
        continue;
      }

      let sourceDoc = cache.get(pageInfo.sourceFileId);
      if (!sourceDoc) {
        sourceDoc = await loadPdfForExport(sourceEntry.bytes);
        cache.set(pageInfo.sourceFileId, sourceDoc);
      }

      const [copied] = await merged.copyPages(sourceDoc, [pageInfo.sourcePageIndex]);
      const finalRotation = (pageInfo.originalRotation + pageInfo.rotation) % 360;
      copied.setRotation(degrees(finalRotation));
      merged.addPage(copied);
    }

    return merged.save();
  }

  function watermarkCoords(position, pageWidth, pageHeight, textWidth, fontSize) {
    const margin = 28;
    if (position === "top_left") return { x: margin, y: pageHeight - margin - fontSize, rotation: degrees(0) };
    if (position === "top_right") {
      return { x: Math.max(margin, pageWidth - margin - textWidth), y: pageHeight - margin - fontSize, rotation: degrees(0) };
    }
    if (position === "bottom_left") return { x: margin, y: margin, rotation: degrees(0) };
    if (position === "bottom_right") {
      return { x: Math.max(margin, pageWidth - margin - textWidth), y: margin, rotation: degrees(0) };
    }
    return {
      x: Math.max(margin, pageWidth / 2 - textWidth / 2),
      y: Math.max(margin, pageHeight / 2 - fontSize / 2),
      rotation: degrees(45),
    };
  }

  async function applyWatermarkToPdfBytes(bytes) {
    const doc = await PDFDocument.load(bytes);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const text = watermarkText.trim();
    if (!text) return bytes;
    const size = Number(watermarkFontSize) || 48;
    const opacity = Math.min(1, Math.max(0.1, Number(watermarkOpacityPercent) / 100));
    const selectedColor = WATERMARK_COLORS[watermarkColor] || WATERMARK_COLORS.gray;
    const [r, g, b] = selectedColor.rgb;

    const pagesInDoc = doc.getPages();
    pagesInDoc.forEach((page) => {
      const { width, height } = page.getSize();
      const textWidth = font.widthOfTextAtSize(text, size);
      const coords = watermarkCoords(watermarkPosition, width, height, textWidth, size);
      page.drawText(text, {
        x: coords.x,
        y: coords.y,
        size,
        font,
        color: rgb(r, g, b),
        opacity,
        rotate: coords.rotation,
      });
    });

    return doc.save();
  }

  useEffect(() => {
    if (!exportOpen) return;
    let cancelled = false;

    const estimate = async () => {
      setIsEstimating(true);
      try {
        const bytes = await buildMergedPdfBytes(pages);
        if (!cancelled) setEstimatedBytes(bytes.length);
      } catch (error) {
        console.error("Estimate failed:", error);
        if (!cancelled) setEstimatedBytes(0);
      } finally {
        if (!cancelled) setIsEstimating(false);
      }
    };

    estimate();

    return () => {
      cancelled = true;
    };
  }, [exportOpen, pages]);

  async function exportPdf() {
    if (!pages.length) return;
    if (exportBlockedByWatermark) return;
    setIsExporting(true);
    try {
      let bytes = await buildMergedPdfBytes(pages);
      if (watermarkEnabled && watermarkText.trim()) {
        bytes = await applyWatermarkToPdfBytes(bytes);
      }
      const blob = new Blob([bytes], { type: "application/pdf" });
      const filename = buildExportName(filenamePreset, customName);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      if (watermarkEnabled && watermarkText.trim()) {
        showToast("PDF exported with watermark ✓", "success");
      }
      setExportOpen(false);
    } catch (error) {
      console.error("Export failed:", error);
      const message = String(error?.message || "").trim();
      showToast(message ? `Export failed: ${message}` : "Failed to export PDF. Please try again.");
    } finally {
      setIsExporting(false);
    }
  }

  return (
    <div className="min-h-screen bg-page text-gray-100 pb-28">
      <header className="sticky top-0 z-30 border-b border-white/10 bg-[#121212]/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-col gap-1 px-4 py-4 sm:px-6">
          <h1 className="text-lg font-semibold text-white sm:text-xl">
            PaperFuse - 100% Private • Runs in Your Browser • No Uploads
          </h1>
          <p className="text-sm text-gray-300">Your files never leave your device</p>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp"
          multiple
          className="hidden"
          onChange={(e) => handleAddFiles(e.target.files)}
        />

        {!pages.length ? (
          <section
            className="mx-auto flex min-h-[56vh] max-w-3xl cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-accent/40 bg-panel/70 p-8 text-center transition hover:border-accent"
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={onDropFiles}
          >
            <p className="text-xl font-semibold text-white">Drop PDF or image files here</p>
            <p className="mt-2 text-sm text-gray-300">Upload multiple files and merge them in seconds</p>
            <button
              type="button"
              className="tap-target mt-6 rounded-lg bg-accent px-5 py-3 text-sm font-medium text-white transition hover:bg-blue-500"
            >
              Choose Files
            </button>
          </section>
        ) : (
          <>
            <section className="mb-5 rounded-xl border border-white/10 bg-panel/90 p-3 sm:p-4">
              <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                <button
                  type="button"
                  className="tap-target rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-blue-500"
                  onClick={() => fileInputRef.current?.click()}
                >
                  Add More Files
                </button>
                <button
                  type="button"
                  className="tap-target rounded-lg border border-white/15 px-4 py-2 text-sm text-gray-100 hover:bg-white/5"
                  onClick={() => {
                    if (allSelected) setSelectedIds(new Set());
                    else setSelectedIds(new Set(pages.map((p) => p.id)));
                  }}
                >
                  {allSelected ? "Deselect All" : "Select All"}
                </button>
                <button
                  type="button"
                  className="tap-target rounded-lg border border-red-400/40 px-4 py-2 text-sm text-red-200 enabled:hover:bg-red-500/10 disabled:opacity-40"
                  onClick={deleteSelected}
                  disabled={!selectedIds.size}
                >
                  Delete Selected
                </button>
                <button
                  type="button"
                  className="tap-target rounded-lg border border-white/15 px-4 py-2 text-sm text-gray-100 enabled:hover:bg-white/5 disabled:opacity-40"
                  onClick={undoLastAction}
                  disabled={!history.length}
                >
                  Undo
                </button>
                <p className="ml-auto text-sm text-gray-300">
                  {pageLabel(pageCount)} • {fileCount} files
                </p>
              </div>
            </section>

            <section
              className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6"
              onDragOver={(e) => {
                e.preventDefault();
                setDropIndex(pages.length);
              }}
              onDrop={onDropReorder}
            >
              {groupedSegments.map((item) => {
                if (item.type === "header") {
                  const file = fileMap.get(item.sourceFileId);
                  if (!file || !sourceCounts.get(item.sourceFileId)) return null;
                  return (
                    <div
                      key={item.key}
                      className="col-span-full rounded-xl px-4 py-2 text-sm font-medium text-white"
                      style={{ backgroundColor: `${file.color}2b`, borderLeft: `4px solid ${file.color}` }}
                    >
                      {file.name} • {pageLabel(sourceCounts.get(item.sourceFileId))}
                    </div>
                  );
                }

                const page = item.page;
                const file = fileMap.get(page.sourceFileId);
                const fileType = page.sourceKind === "image" ? "IMG" : "PDF";
                const selected = selectedIds.has(page.id);
                const isDragging = draggingId === page.id || touchDraggingId === page.id;
                const isDeleting = removingIds.has(page.id);
                const showPlaceholder =
                  (draggingId || touchDraggingId) &&
                  (dropIndex === item.index || touchDropIndex === item.index);

                return (
                  <div key={item.key} className="relative">
                    {showPlaceholder && (
                      <div className="absolute inset-0 z-0 rounded-xl border-2 border-dashed border-accent/80 bg-accent/15" />
                    )}
                    <article
                      data-page-id={page.id}
                      draggable
                      onDragStart={(e) => onDragStart(e, page.id)}
                      onDragOver={(e) => onDragOverCard(e, item.index)}
                      onDrop={onDropReorder}
                      onDragEnd={onDragEnd}
                      onTouchStart={() => startTouchDrag(page.id)}
                      className={`group relative z-10 animate-fadeInUp rounded-xl border bg-panel p-2 transition-all duration-200 ${
                        isDragging ? "scale-[1.02] shadow-lift" : ""
                      } ${isDeleting ? "opacity-0" : "opacity-100"}`}
                      style={{ borderColor: `${file?.color || "#3b82f6"}88` }}
                    >
                      <div className="relative overflow-hidden rounded-lg bg-black/30">
                        <img
                          src={page.thumbnail}
                          alt={`${page.sourceFileName} page ${page.sourcePageNumber}`}
                          className="aspect-[3/4] w-full object-cover transition"
                          style={{ transform: `rotate(${page.rotation}deg)` }}
                        />
                        <span
                          className="absolute left-2 top-2 rounded px-2 py-1 text-xs font-semibold"
                          style={{ backgroundColor: `${file?.color || "#3b82f6"}cc` }}
                        >
                          {page.sourcePageNumber}
                        </span>
                        <span className="absolute right-2 bottom-2 rounded bg-black/70 px-2 py-1 text-[10px] font-semibold text-gray-100">
                          {fileType}
                        </span>
                        {selected && (
                          <span className="absolute right-2 top-2 rounded-full bg-accent px-2 py-1 text-xs font-semibold text-white">
                            ✓
                          </span>
                        )}
                        <div className="absolute inset-x-2 bottom-2 flex gap-2 opacity-100 transition sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
                          <button
                            type="button"
                            className="tap-target flex-1 rounded-md bg-black/70 px-2 py-2 text-sm text-white hover:bg-black/90"
                            onClick={(e) => {
                              e.stopPropagation();
                              rotatePage(page.id);
                            }}
                            title="Rotate"
                          >
                            ↻
                          </button>
                          <button
                            type="button"
                            className="tap-target flex-1 rounded-md bg-red-600/80 px-2 py-2 text-sm text-white hover:bg-red-600"
                            onClick={(e) => {
                              e.stopPropagation();
                              removeIdsWithAnimation([page.id]);
                            }}
                            title="Delete"
                          >
                            ✕
                          </button>
                        </div>
                      </div>
                      <button
                        type="button"
                        className="mt-2 w-full rounded-md border border-white/10 px-3 py-2 text-xs text-gray-200 hover:bg-white/5"
                        onClick={() => toggleSelection(page.id)}
                      >
                        {selected ? "Selected" : "Select"}
                      </button>
                    </article>
                  </div>
                );
              })}
            </section>
          </>
        )}

        {Object.values(uploadProgress).some((entry) => entry.status !== "done") && (
          <section className="mt-6 rounded-xl border border-white/10 bg-panel/90 p-4">
            <h2 className="mb-3 text-sm font-semibold text-gray-200">Processing thumbnails</h2>
            <div className="space-y-3">
              {Object.entries(uploadProgress).map(([key, progress]) => {
                if (!progress) return null;
                const percent = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;
                return (
                  <div key={key}>
                    <div className="mb-1 flex justify-between text-xs text-gray-300">
                      <span>{progress.name}</span>
                      <span>{percent}%</span>
                    </div>
                    <div className="h-2 rounded-full bg-white/10">
                      <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${percent}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}
      </main>

      {pages.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-[#141414]/95 p-3 backdrop-blur">
          <div className="mx-auto max-w-7xl">
            <button
              type="button"
              onClick={() => setExportOpen(true)}
              className="tap-target w-full rounded-xl bg-accent px-6 py-3 text-sm font-semibold text-white hover:bg-blue-500"
            >
              Merge & Export
            </button>
          </div>
        </div>
      )}

      {exportOpen && (
        <div className="fixed inset-0 z-50 flex items-end bg-black/70 p-0 sm:items-center sm:justify-center sm:p-4">
          <div className="h-full w-full rounded-none border border-white/10 bg-[#161616] p-5 sm:h-auto sm:max-w-lg sm:rounded-2xl">
            <h3 className="text-lg font-semibold text-white">Export PDF</h3>
            <div className="mt-4 space-y-3 text-sm text-gray-200">
              <p>{pageLabel(pages.length)} in export</p>
              <p>Estimated size: {isEstimating ? "Calculating..." : formatBytes(estimatedBytes)}</p>
            </div>

            <div className="mt-5">
              <label className="mb-2 block text-sm font-medium text-gray-200">Filename</label>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className={`tap-target rounded-lg border px-3 py-2 text-xs ${
                    filenamePreset === "merged"
                      ? "border-accent bg-accent/20 text-white"
                      : "border-white/15 text-gray-200"
                  }`}
                  onClick={() => setFilenamePreset("merged")}
                >
                  merged
                </button>
                <button
                  type="button"
                  className={`tap-target rounded-lg border px-3 py-2 text-xs ${
                    filenamePreset === "document_date"
                      ? "border-accent bg-accent/20 text-white"
                      : "border-white/15 text-gray-200"
                  }`}
                  onClick={() => setFilenamePreset("document_date")}
                >
                  document_DATE
                </button>
                <button
                  type="button"
                  className={`tap-target rounded-lg border px-3 py-2 text-xs ${
                    filenamePreset === "custom"
                      ? "border-accent bg-accent/20 text-white"
                      : "border-white/15 text-gray-200"
                  }`}
                  onClick={() => setFilenamePreset("custom")}
                >
                  custom
                </button>
              </div>
              <input
                type="text"
                className="mt-3 w-full rounded-lg border border-white/15 bg-[#101010] px-3 py-2 text-sm text-white outline-none ring-accent focus:ring"
                value={customName}
                onChange={(e) => {
                  setCustomName(e.target.value.replace(/[\\/:*?"<>|]/g, ""));
                  setFilenamePreset("custom");
                }}
                placeholder="Enter custom filename"
                disabled={filenamePreset !== "custom"}
              />
              <p className="mt-2 text-xs text-gray-400">Final file: {buildExportName(filenamePreset, customName)}</p>

              <div className="mt-4 rounded-lg border border-white/10 bg-[#101010] p-3">
                <div className="flex items-center justify-between">
                  <label htmlFor="watermark-toggle" className="text-sm font-medium text-gray-200">
                    🔖 Add Watermark
                  </label>
                  <button
                    id="watermark-toggle"
                    type="button"
                    role="switch"
                    aria-checked={watermarkEnabled}
                    onClick={() => setWatermarkEnabled((v) => !v)}
                    className={`relative h-7 w-12 rounded-full transition ${
                      watermarkEnabled ? "bg-accent" : "bg-white/20"
                    }`}
                  >
                    <span
                      className={`absolute top-1 h-5 w-5 rounded-full bg-white transition ${
                        watermarkEnabled ? "left-6" : "left-1"
                      }`}
                    />
                  </button>
                </div>

                <div
                  className={`overflow-hidden transition-all duration-200 ${
                    watermarkEnabled ? "mt-3 max-h-[30rem] opacity-100" : "max-h-0 opacity-0"
                  }`}
                >
                  <div className="space-y-4">
                    <div>
                      <label className="mb-1 block text-xs text-gray-300">Watermark Text</label>
                      <input
                        type="text"
                        className="w-full rounded-lg border border-white/15 bg-[#0d0d0d] px-3 py-2 text-sm text-white outline-none ring-accent focus:ring"
                        value={watermarkText}
                        onChange={(e) => setWatermarkText(e.target.value)}
                        placeholder="CONFIDENTIAL"
                        maxLength={120}
                      />
                    </div>

                    <div>
                      <div className="mb-1 flex items-center justify-between text-xs text-gray-300">
                        <label>Font Size</label>
                        <span>{watermarkFontSize}</span>
                      </div>
                      <input
                        type="range"
                        min="20"
                        max="80"
                        value={watermarkFontSize}
                        onChange={(e) => setWatermarkFontSize(Number(e.target.value))}
                        className="w-full accent-blue-500"
                      />
                    </div>

                    <div>
                      <div className="mb-1 flex items-center justify-between text-xs text-gray-300">
                        <label>Opacity</label>
                        <span>{watermarkOpacityPercent}%</span>
                      </div>
                      <input
                        type="range"
                        min="10"
                        max="100"
                        value={watermarkOpacityPercent}
                        onChange={(e) => setWatermarkOpacityPercent(Number(e.target.value))}
                        className="w-full accent-blue-500"
                      />
                    </div>

                    <div>
                      <label className="mb-2 block text-xs text-gray-300">Color</label>
                      <div className="flex flex-wrap gap-2">
                        {Object.entries(WATERMARK_COLORS).map(([key, value]) => (
                          <button
                            key={key}
                            type="button"
                            onClick={() => setWatermarkColor(key)}
                            className={`rounded-md border px-3 py-1.5 text-xs ${
                              watermarkColor === key
                                ? "border-accent bg-accent/20 text-white"
                                : "border-white/15 text-gray-200"
                            }`}
                          >
                            <span className="mr-2 inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: value.hex }} />
                            {value.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <label className="mb-1 block text-xs text-gray-300">Position</label>
                      <select
                        className="w-full rounded-lg border border-white/15 bg-[#0d0d0d] px-3 py-2 text-sm text-white outline-none ring-accent focus:ring"
                        value={watermarkPosition}
                        onChange={(e) => setWatermarkPosition(e.target.value)}
                      >
                        <option value="center_diagonal">Center (diagonal)</option>
                        <option value="top_left">Top-Left</option>
                        <option value="top_right">Top-Right</option>
                        <option value="bottom_left">Bottom-Left</option>
                        <option value="bottom_right">Bottom-Right</option>
                      </select>
                    </div>

                    {watermarkEnabled && !watermarkText.trim() && (
                      <p className="text-xs font-medium text-red-400">Watermark text is required</p>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-6 flex gap-3">
              <button
                type="button"
                className="tap-target flex-1 rounded-lg border border-white/15 px-4 py-3 text-sm text-gray-200 hover:bg-white/5"
                onClick={() => setExportOpen(false)}
                disabled={isExporting}
              >
                Cancel
              </button>
              <button
                type="button"
                className="tap-target flex-1 rounded-lg bg-accent px-4 py-3 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-50"
                onClick={exportPdf}
                disabled={isExporting || exportBlockedByWatermark}
              >
                {isExporting ? "Exporting..." : "Export PDF"}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="fixed right-3 top-20 z-50 space-y-2 sm:right-6">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`max-w-xs rounded-lg border px-3 py-2 text-sm shadow-lg ${
              toast.type === "error"
                ? "border-red-400/50 bg-red-950/80 text-red-100"
                : "border-green-400/50 bg-green-950/80 text-green-100"
            }`}
          >
            {toast.message}
          </div>
        ))}
      </div>
    </div>
  );
}

export default App;
