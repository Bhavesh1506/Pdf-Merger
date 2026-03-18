import { useEffect, useMemo, useRef, useState } from "react";
import { PDFDocument, degrees } from "pdf-lib";
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";
import workerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";

GlobalWorkerOptions.workerSrc = workerSrc;

const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024;
const FILE_COLORS = ["#3b82f6", "#8b5cf6", "#22c55e", "#f97316", "#ec4899"];

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
      if (!file.name.toLowerCase().endsWith(".pdf")) {
        showToast(`${file.name}: only PDF files are supported.`);
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
        const bytes = new Uint8Array(await file.arrayBuffer());
        sourceBytesRef.current.set(sourceFileId, bytes);

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
      } catch (error) {
        sourceBytesRef.current.delete(sourceFileId);
        setFilesMeta((prev) => prev.filter((f) => f.id !== sourceFileId));
        const message = String(error?.message || "").toLowerCase();
        if (error?.name === "PasswordException" || message.includes("password")) {
          showToast("Password protected PDFs are not supported yet");
        } else if (message.includes("encrypted")) {
          showToast("Password protected PDFs are not supported yet");
        } else {
          showToast(`${file.name}: invalid or corrupted PDF.`);
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

  async function buildMergedPdfBytes(pageItems) {
    const merged = await PDFDocument.create();
    const cache = new Map();

    for (const pageInfo of pageItems) {
      const sourceBytes = sourceBytesRef.current.get(pageInfo.sourceFileId);
      if (!sourceBytes) continue;

      let sourceDoc = cache.get(pageInfo.sourceFileId);
      if (!sourceDoc) {
        sourceDoc = await PDFDocument.load(sourceBytes, { ignoreEncryption: false });
        cache.set(pageInfo.sourceFileId, sourceDoc);
      }

      const [copied] = await merged.copyPages(sourceDoc, [pageInfo.sourcePageIndex]);
      const finalRotation = (pageInfo.originalRotation + pageInfo.rotation) % 360;
      copied.setRotation(degrees(finalRotation));
      merged.addPage(copied);
    }

    return merged.save();
  }

  useEffect(() => {
    if (!exportOpen) return;
    let cancelled = false;

    const estimate = async () => {
      setIsEstimating(true);
      try {
        const bytes = await buildMergedPdfBytes(pages);
        if (!cancelled) setEstimatedBytes(bytes.length);
      } catch {
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
    setIsExporting(true);
    try {
      const bytes = await buildMergedPdfBytes(pages);
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
      setExportOpen(false);
    } catch {
      showToast("Failed to export PDF. Please try again.");
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
          accept=".pdf,application/pdf"
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
            <p className="text-xl font-semibold text-white">Drop PDF files here</p>
            <p className="mt-2 text-sm text-gray-300">Upload multiple PDFs and merge them in seconds</p>
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
                  {pageCount} pages • {fileCount} files
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
                      {file.name} • {sourceCounts.get(item.sourceFileId)} pages
                    </div>
                  );
                }

                const page = item.page;
                const file = fileMap.get(page.sourceFileId);
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
              <p>{pages.length} pages in export</p>
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
                disabled={isExporting}
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
