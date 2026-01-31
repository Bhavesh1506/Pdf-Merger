/**
 * PaperFuse - Privacy-First PDF Tool
 * All processing happens in the browser - no server uploads
 * 
 * Features:
 * - Merge multiple PDFs
 * - Split PDFs into separate files
 * - Reorder pages via drag-and-drop
 * - Rotate pages (90°, 180°, 270°)
 * - Preview before export with file size estimation
 * - Custom filename rules with validation
 */

// Configure PDF.js worker for thumbnail rendering
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

// ===== State Management =====
// Central state object holds all application data
const state = {
    pages: [],              // Array of page objects with rotation info
    selectedIds: new Set(), // Set of selected page IDs for batch operations
    draggedId: null,        // Currently dragged page ID for reordering
    isProcessing: false,    // Flag to prevent concurrent operations
    currentFilename: 'merged', // Current filename for export
    filenameTemplate: 'custom' // Active filename template
};

// ===== DOM Elements =====
// Cache DOM references for performance
const elements = {
    uploadZone: document.getElementById('uploadZone'),
    fileInput: document.getElementById('fileInput'),
    toolbar: document.getElementById('toolbar'),
    pageGrid: document.getElementById('pageGrid'),
    pageInfo: document.getElementById('pageInfo'),
    pageCount: document.getElementById('pageCount'),
    selectedCount: document.getElementById('selectedCount'),
    emptyState: document.getElementById('emptyState'),
    loadingOverlay: document.getElementById('loadingOverlay'),
    loadingText: document.getElementById('loadingText'),
    progressFill: document.getElementById('progressFill'),
    toastContainer: document.getElementById('toastContainer'),
    
    // Buttons
    addMoreBtn: document.getElementById('addMoreBtn'),
    deleteBtn: document.getElementById('deleteBtn'),
    selectAllBtn: document.getElementById('selectAllBtn'),
    clearAllBtn: document.getElementById('clearAllBtn'),
    splitBtn: document.getElementById('splitBtn'),
    mergeBtn: document.getElementById('mergeBtn'),
    
    // Export Modal Elements
    exportModal: document.getElementById('exportModal'),
    modalClose: document.getElementById('modalClose'),
    previewStrip: document.getElementById('previewStrip'),
    statPageCount: document.getElementById('statPageCount'),
    statFileSize: document.getElementById('statFileSize'),
    filenameInput: document.getElementById('filenameInput'),
    filenameError: document.getElementById('filenameError'),
    cancelExport: document.getElementById('cancelExport'),
    confirmExport: document.getElementById('confirmExport')
};

// ===== Initialization =====
function init() {
    setupEventListeners();
    updateUI();
}

function setupEventListeners() {
    // Upload zone events
    elements.uploadZone.addEventListener('click', () => elements.fileInput.click());
    elements.uploadZone.addEventListener('dragover', handleDragOver);
    elements.uploadZone.addEventListener('dragleave', handleDragLeave);
    elements.uploadZone.addEventListener('drop', handleFileDrop);
    elements.fileInput.addEventListener('change', handleFileSelect);
    
    // Button events
    elements.addMoreBtn.addEventListener('click', () => elements.fileInput.click());
    elements.deleteBtn.addEventListener('click', deleteSelected);
    elements.selectAllBtn.addEventListener('click', selectAll);
    elements.clearAllBtn.addEventListener('click', clearAll);
    elements.splitBtn.addEventListener('click', splitSelected);
    
    // Modified: Merge button now opens preview modal instead of direct export
    elements.mergeBtn.addEventListener('click', showExportPreview);
    
    // Export modal events
    elements.modalClose.addEventListener('click', hideExportPreview);
    elements.cancelExport.addEventListener('click', hideExportPreview);
    elements.confirmExport.addEventListener('click', confirmAndExport);
    elements.exportModal.addEventListener('click', (e) => {
        // Close modal when clicking overlay background
        if (e.target === elements.exportModal) hideExportPreview();
    });
    
    // Filename input validation
    elements.filenameInput.addEventListener('input', validateFilenameInput);
    
    // Filename template buttons
    document.querySelectorAll('.template-btn').forEach(btn => {
        btn.addEventListener('click', () => selectFilenameTemplate(btn.dataset.template));
    });
}

// ===== File Upload Handlers =====
function handleDragOver(e) {
    e.preventDefault();
    elements.uploadZone.classList.add('drag-over');
}

function handleDragLeave(e) {
    e.preventDefault();
    elements.uploadZone.classList.remove('drag-over');
}

function handleFileDrop(e) {
    e.preventDefault();
    elements.uploadZone.classList.remove('drag-over');
    
    const files = Array.from(e.dataTransfer.files).filter(f => f.type === 'application/pdf');
    if (files.length === 0) {
        showToast('Please drop PDF files only', 'error');
        return;
    }
    processFiles(files);
}

function handleFileSelect(e) {
    const files = Array.from(e.target.files);
    if (files.length > 0) {
        processFiles(files);
    }
    e.target.value = ''; // Reset input to allow same file selection
}

// ===== PDF Processing =====
async function processFiles(files) {
    if (state.isProcessing) return;
    
    state.isProcessing = true;
    showLoading('Loading PDF files...');
    
    try {
        let totalPages = 0;
        let processedPages = 0;
        
        // First pass: count total pages for progress calculation
        for (const file of files) {
            const arrayBuffer = await file.arrayBuffer();
            const pdfDoc = await PDFLib.PDFDocument.load(arrayBuffer, { ignoreEncryption: true });
            totalPages += pdfDoc.getPageCount();
        }
        
        // Second pass: process each page
        for (const file of files) {
            const arrayBuffer = await file.arrayBuffer();
            // Create a copy of the bytes to store (important - prevents memory issues)
            const pdfBytes = new Uint8Array(arrayBuffer).slice();
            
            // Load with pdf-lib for manipulation
            const pdfDoc = await PDFLib.PDFDocument.load(pdfBytes, { ignoreEncryption: true });
            const pageCount = pdfDoc.getPageCount();
            
            // Load with PDF.js for thumbnail rendering - use separate copy
            const pdfJsDoc = await pdfjsLib.getDocument({ data: pdfBytes.slice() }).promise;
            
            for (let i = 0; i < pageCount; i++) {
                updateLoadingProgress(
                    `Processing page ${processedPages + 1} of ${totalPages}...`,
                    ((processedPages + 1) / totalPages) * 100
                );
                
                // Generate thumbnail image
                const thumbnail = await generateThumbnail(pdfJsDoc, i + 1);
                
                // Create page object with rotation state initialized to 0
                const pageData = {
                    id: generateId(),
                    sourceFile: file.name,
                    pageIndex: i,
                    originalPageNumber: i + 1,
                    pdfBytes: pdfBytes,      // Reference to source PDF bytes
                    thumbnail: thumbnail,
                    rotation: 0              // NEW: Rotation state (0, 90, 180, 270)
                };
                
                state.pages.push(pageData);
                processedPages++;
            }
        }
        
        hideLoading();
        updateUI();
        renderPages();
        showToast(`Added ${processedPages} pages from ${files.length} file(s)`, 'success');
        
    } catch (error) {
        console.error('Error processing PDF:', error);
        hideLoading();
        showToast('Error processing PDF: ' + error.message, 'error');
    } finally {
        state.isProcessing = false;
    }
}

/**
 * Generate a thumbnail image for a PDF page
 * Uses PDF.js to render page to canvas, then converts to data URL
 */
async function generateThumbnail(pdfJsDoc, pageNumber) {
    const page = await pdfJsDoc.getPage(pageNumber);
    
    // Calculate scale to fit within ~200px width while maintaining aspect ratio
    const originalViewport = page.getViewport({ scale: 1 });
    const targetWidth = 200;
    const scale = targetWidth / originalViewport.width;
    const viewport = page.getViewport({ scale: scale });
    
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    
    // Fill with white background (some PDFs have transparent backgrounds)
    context.fillStyle = 'white';
    context.fillRect(0, 0, canvas.width, canvas.height);
    
    await page.render({
        canvasContext: context,
        viewport: viewport
    }).promise;
    
    return canvas.toDataURL('image/jpeg', 0.8);
}

// ===== Page Rendering =====
function renderPages() {
    elements.pageGrid.innerHTML = '';
    
    state.pages.forEach((page, index) => {
        const card = createPageCard(page, index + 1);
        elements.pageGrid.appendChild(card);
    });
}

/**
 * Create a page card element with thumbnail, controls, and rotation button
 */
function createPageCard(page, displayNumber) {
    const card = document.createElement('div');
    card.className = 'page-card';
    card.dataset.id = page.id;
    card.draggable = true;
    
    if (state.selectedIds.has(page.id)) {
        card.classList.add('selected');
    }
    
    // Determine rotation class for thumbnail
    const rotationClass = page.rotation > 0 ? `rotate-${page.rotation}` : '';
    
    // Show rotation badge only if page is rotated
    const rotationBadgeClass = page.rotation > 0 ? 'rotation-badge visible' : 'rotation-badge';
    
    card.innerHTML = `
        <div class="drag-handle">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="9" cy="5" r="1"></circle>
                <circle cx="9" cy="12" r="1"></circle>
                <circle cx="9" cy="19" r="1"></circle>
                <circle cx="15" cy="5" r="1"></circle>
                <circle cx="15" cy="12" r="1"></circle>
                <circle cx="15" cy="19" r="1"></circle>
            </svg>
        </div>
        <div class="page-checkbox">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
                <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
        </div>
        <button class="rotate-btn" title="Rotate 90°">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M23 4v6h-6"></path>
                <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
            </svg>
        </button>
        <div class="${rotationBadgeClass}">${page.rotation}°</div>
        <div class="page-thumbnail">
            <img src="${page.thumbnail}" alt="Page ${displayNumber}" class="${rotationClass}">
        </div>
        <div class="page-info-bar">
            <span class="page-number">Page ${displayNumber}</span>
            <span class="page-source" title="${page.sourceFile}">${page.sourceFile}</span>
        </div>
    `;
    
    // Click to select (but not on drag handle or rotate button)
    card.addEventListener('click', (e) => {
        if (e.target.closest('.drag-handle') || e.target.closest('.rotate-btn')) return;
        togglePageSelection(page.id);
    });
    
    // Rotate button click handler
    card.querySelector('.rotate-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        rotatePage(page.id);
    });
    
    // Drag events for reordering
    card.addEventListener('dragstart', (e) => handlePageDragStart(e, page.id));
    card.addEventListener('dragend', handlePageDragEnd);
    card.addEventListener('dragover', handlePageDragOver);
    card.addEventListener('dragleave', handlePageDragLeave);
    card.addEventListener('drop', (e) => handlePageDrop(e, page.id));
    
    return card;
}

// ===== Page Rotation =====
/**
 * Rotate a page by 90 degrees clockwise
 * Cycles through: 0 -> 90 -> 180 -> 270 -> 0
 * 
 * The rotation is stored in state and applied:
 * 1. Visually via CSS transform on thumbnail
 * 2. On export via pdf-lib's setRotation() method
 */
function rotatePage(id) {
    const page = state.pages.find(p => p.id === id);
    if (!page) return;
    
    // Cycle through rotation values: 0 -> 90 -> 180 -> 270 -> 0
    page.rotation = (page.rotation + 90) % 360;
    
    // Re-render just this page card for performance
    const card = document.querySelector(`.page-card[data-id="${id}"]`);
    if (card) {
        const img = card.querySelector('.page-thumbnail img');
        const badge = card.querySelector('.rotation-badge');
        
        // Update rotation class
        img.className = page.rotation > 0 ? `rotate-${page.rotation}` : '';
        
        // Update badge
        badge.textContent = `${page.rotation}°`;
        badge.classList.toggle('visible', page.rotation > 0);
    }
    
    showToast(`Rotated to ${page.rotation}°`, 'info');
}

// ===== Selection =====
function togglePageSelection(id) {
    if (state.selectedIds.has(id)) {
        state.selectedIds.delete(id);
    } else {
        state.selectedIds.add(id);
    }
    updatePageCard(id);
    updateUI();
}

function updatePageCard(id) {
    const card = document.querySelector(`.page-card[data-id="${id}"]`);
    if (card) {
        card.classList.toggle('selected', state.selectedIds.has(id));
    }
}

function selectAll() {
    state.pages.forEach(page => state.selectedIds.add(page.id));
    renderPages();
    updateUI();
}

function clearAll() {
    state.pages = [];
    state.selectedIds.clear();
    renderPages();
    updateUI();
    showToast('All pages cleared', 'info');
}

// ===== Drag & Drop Reorder =====
function handlePageDragStart(e, id) {
    state.draggedId = id;
    e.target.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', id);
}

function handlePageDragEnd(e) {
    e.target.classList.remove('dragging');
    state.draggedId = null;
    
    // Remove all drag-over classes
    document.querySelectorAll('.page-card.drag-over').forEach(card => {
        card.classList.remove('drag-over');
    });
}

function handlePageDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    
    const card = e.target.closest('.page-card');
    if (card && card.dataset.id !== state.draggedId) {
        card.classList.add('drag-over');
    }
}

function handlePageDragLeave(e) {
    const card = e.target.closest('.page-card');
    if (card) {
        card.classList.remove('drag-over');
    }
}

function handlePageDrop(e, targetId) {
    e.preventDefault();
    
    const card = e.target.closest('.page-card');
    if (card) {
        card.classList.remove('drag-over');
    }
    
    if (state.draggedId === targetId) return;
    
    // Find indices
    const draggedIndex = state.pages.findIndex(p => p.id === state.draggedId);
    const targetIndex = state.pages.findIndex(p => p.id === targetId);
    
    if (draggedIndex === -1 || targetIndex === -1) return;
    
    // Reorder pages array
    const [draggedPage] = state.pages.splice(draggedIndex, 1);
    state.pages.splice(targetIndex, 0, draggedPage);
    
    renderPages();
}

// ===== Page Operations =====
function deleteSelected() {
    if (state.selectedIds.size === 0) return;
    
    const count = state.selectedIds.size;
    state.pages = state.pages.filter(p => !state.selectedIds.has(p.id));
    state.selectedIds.clear();
    
    renderPages();
    updateUI();
    showToast(`Deleted ${count} page(s)`, 'success');
}

async function splitSelected() {
    if (state.selectedIds.size === 0) {
        showToast('Select pages to split', 'error');
        return;
    }
    
    state.isProcessing = true;
    showLoading('Splitting PDF...');
    
    try {
        const selectedPages = state.pages.filter(p => state.selectedIds.has(p.id));
        
        for (let i = 0; i < selectedPages.length; i++) {
            const page = selectedPages[i];
            updateLoadingProgress(
                `Creating page ${i + 1} of ${selectedPages.length}...`,
                ((i + 1) / selectedPages.length) * 100
            );
            
            // Create new PDF with single page
            const sourcePdf = await PDFLib.PDFDocument.load(page.pdfBytes, { ignoreEncryption: true });
            const newPdf = await PDFLib.PDFDocument.create();
            
            const [copiedPage] = await newPdf.copyPages(sourcePdf, [page.pageIndex]);
            
            // Apply rotation if set
            if (page.rotation > 0) {
                copiedPage.setRotation(PDFLib.degrees(page.rotation));
            }
            
            newPdf.addPage(copiedPage);
            
            // Optimize and download
            const pdfBytes = await newPdf.save({
                useObjectStreams: true,
                addDefaultPage: false
            });
            
            downloadBlob(pdfBytes, `page_${i + 1}.pdf`);
            
            // Small delay between downloads to prevent browser issues
            await new Promise(resolve => setTimeout(resolve, 300));
        }
        
        hideLoading();
        showToast(`Split ${selectedPages.length} page(s) into separate PDFs`, 'success');
        
    } catch (error) {
        console.error('Error splitting PDF:', error);
        hideLoading();
        showToast('Error splitting PDF: ' + error.message, 'error');
    } finally {
        state.isProcessing = false;
    }
}

// ===== Export Preview Modal =====
/**
 * Show the export preview modal with page thumbnails, stats, and filename options
 * This replaces the direct export flow with a confirmation step
 */
function showExportPreview() {
    if (state.pages.length === 0) {
        showToast('No pages to export', 'error');
        return;
    }
    
    // Get pages to export (selected or all)
    const pagesToExport = state.selectedIds.size > 0 
        ? state.pages.filter(p => state.selectedIds.has(p.id))
        : state.pages;
    
    // Render page preview strip
    elements.previewStrip.innerHTML = pagesToExport.map((page, index) => {
        const rotationClass = page.rotation > 0 ? `rotate-${page.rotation}` : '';
        return `
            <div class="preview-strip-item">
                <img src="${page.thumbnail}" alt="Page ${index + 1}" class="${rotationClass}">
                <span>${index + 1}</span>
            </div>
        `;
    }).join('');
    
    // Update stats
    elements.statPageCount.textContent = pagesToExport.length;
    elements.statFileSize.textContent = estimateFileSize(pagesToExport);
    
    // Generate default filename based on current template
    updateFilenameFromTemplate();
    
    // Show modal
    elements.exportModal.classList.add('visible');
}

function hideExportPreview() {
    elements.exportModal.classList.remove('visible');
}

/**
 * Estimate the output file size based on source PDFs
 * Uses average bytes per page with a compression factor
 */
function estimateFileSize(pages) {
    // Calculate total source bytes and pages
    const sourceStats = new Map(); // Track unique source files
    
    pages.forEach(page => {
        if (!sourceStats.has(page.pdfBytes)) {
            sourceStats.set(page.pdfBytes, {
                bytes: page.pdfBytes.length,
                pages: 0
            });
        }
        sourceStats.get(page.pdfBytes).pages++;
    });
    
    let totalBytes = 0;
    sourceStats.forEach((stat, bytes) => {
        // Estimate bytes per page from source, then multiply by pages used
        const bytesPerPage = stat.bytes / (bytes.length / stat.bytes);
        totalBytes += (stat.bytes / pages.filter(p => p.pdfBytes === bytes).length) * pages.filter(p => p.pdfBytes === bytes).length;
    });
    
    // Simpler estimation: sum of proportional bytes with compression factor
    let estimatedBytes = 0;
    const processed = new Set();
    
    pages.forEach(page => {
        if (!processed.has(page.pdfBytes)) {
            const pagesFromSource = pages.filter(p => p.pdfBytes === page.pdfBytes).length;
            const totalPagesInSource = state.pages.filter(p => p.pdfBytes === page.pdfBytes).length;
            estimatedBytes += (page.pdfBytes.length * pagesFromSource / totalPagesInSource);
            processed.add(page.pdfBytes);
        }
    });
    
    // Apply compression factor (typically 15-20% smaller after merge)
    estimatedBytes *= 0.85;
    
    // Format size
    if (estimatedBytes < 1024) {
        return `${Math.round(estimatedBytes)} B`;
    } else if (estimatedBytes < 1024 * 1024) {
        return `${Math.round(estimatedBytes / 1024)} KB`;
    } else {
        return `${(estimatedBytes / (1024 * 1024)).toFixed(1)} MB`;
    }
}

// ===== Filename Rules =====
/**
 * Filename templates:
 * - custom: User types their own name
 * - merged: Static "merged"
 * - pages: "pages_1-N" format
 * - date: "document_YYYY-MM-DD" format
 */
function selectFilenameTemplate(template) {
    state.filenameTemplate = template;
    
    // Update active button state
    document.querySelectorAll('.template-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.template === template);
    });
    
    // Generate filename based on template
    updateFilenameFromTemplate();
}

function updateFilenameFromTemplate() {
    const pagesToExport = state.selectedIds.size > 0 
        ? state.pages.filter(p => state.selectedIds.has(p.id))
        : state.pages;
    
    let filename = '';
    
    switch (state.filenameTemplate) {
        case 'merged':
            filename = 'merged';
            break;
        case 'pages':
            filename = `pages_1-${pagesToExport.length}`;
            break;
        case 'date':
            const date = new Date().toISOString().slice(0, 10);
            filename = `document_${date}`;
            break;
        case 'custom':
        default:
            // Keep current value for custom
            filename = elements.filenameInput.value || 'merged';
            break;
    }
    
    elements.filenameInput.value = filename;
    state.currentFilename = filename;
    validateFilenameInput();
}

/**
 * Validate filename input
 * Rules:
 * - No invalid characters: \ / : * ? " < > |
 * - Max 100 characters
 * - Not empty
 */
function validateFilenameInput() {
    const input = elements.filenameInput;
    const value = input.value.trim();
    
    // Invalid characters for filenames
    const invalidChars = /[\\/:*?"<>|]/;
    
    let error = '';
    
    if (value.length === 0) {
        error = 'Filename cannot be empty';
    } else if (value.length > 100) {
        error = 'Filename too long (max 100 characters)';
    } else if (invalidChars.test(value)) {
        error = 'Invalid characters: \\ / : * ? " < > |';
    }
    
    // Update UI
    input.classList.toggle('error', error !== '');
    elements.filenameError.textContent = error;
    elements.filenameError.classList.toggle('visible', error !== '');
    elements.confirmExport.disabled = error !== '';
    
    if (error === '') {
        state.currentFilename = value;
    }
    
    return error === '';
}

/**
 * Confirm export and generate the PDF
 */
async function confirmAndExport() {
    if (!validateFilenameInput()) return;
    
    hideExportPreview();
    await mergeAndExport();
}

/**
 * Merge pages and export PDF with rotation applied
 */
async function mergeAndExport() {
    if (state.pages.length === 0) {
        showToast('No pages to merge', 'error');
        return;
    }
    
    state.isProcessing = true;
    showLoading('Merging PDF...');
    
    try {
        const newPdf = await PDFLib.PDFDocument.create();
        const pagesToMerge = state.selectedIds.size > 0 
            ? state.pages.filter(p => state.selectedIds.has(p.id))
            : state.pages;
        
        for (let i = 0; i < pagesToMerge.length; i++) {
            const page = pagesToMerge[i];
            updateLoadingProgress(
                `Adding page ${i + 1} of ${pagesToMerge.length}...`,
                ((i + 1) / pagesToMerge.length) * 100
            );
            
            const sourcePdf = await PDFLib.PDFDocument.load(page.pdfBytes, { ignoreEncryption: true });
            const [copiedPage] = await newPdf.copyPages(sourcePdf, [page.pageIndex]);
            
            // Apply rotation using pdf-lib's setRotation method
            // This modifies the page's rotation property in the PDF structure
            if (page.rotation > 0) {
                copiedPage.setRotation(PDFLib.degrees(page.rotation));
            }
            
            newPdf.addPage(copiedPage);
        }
        
        // Optimize PDF for smaller file size
        const pdfBytes = await newPdf.save({
            useObjectStreams: true,     // Compress object streams
            addDefaultPage: false       // Don't add empty pages
        });
        
        // Use the filename from state (set by preview modal)
        const filename = `${state.currentFilename}.pdf`;
        
        downloadBlob(pdfBytes, filename);
        
        hideLoading();
        showToast(`Exported ${pagesToMerge.length} pages as "${filename}"`, 'success');
        
    } catch (error) {
        console.error('Error merging PDF:', error);
        hideLoading();
        showToast('Error merging PDF: ' + error.message, 'error');
    } finally {
        state.isProcessing = false;
    }
}

// ===== UI Updates =====
function updateUI() {
    const hasPages = state.pages.length > 0;
    const hasSelection = state.selectedIds.size > 0;
    
    // Toggle visibility
    elements.uploadZone.classList.toggle('hidden', hasPages);
    elements.toolbar.classList.toggle('hidden', !hasPages);
    elements.pageInfo.classList.toggle('hidden', !hasPages);
    elements.pageGrid.classList.toggle('hidden', !hasPages);
    elements.emptyState.classList.toggle('hidden', hasPages);
    
    // Update counts
    elements.pageCount.textContent = `${state.pages.length} page${state.pages.length !== 1 ? 's' : ''}`;
    elements.selectedCount.textContent = `${state.selectedIds.size} selected`;
    
    // Update button states
    elements.deleteBtn.disabled = !hasSelection;
    elements.selectAllBtn.disabled = !hasPages;
    elements.clearAllBtn.disabled = !hasPages;
    elements.splitBtn.disabled = !hasSelection;
    elements.mergeBtn.disabled = !hasPages;
}

// ===== Loading State =====
function showLoading(text) {
    elements.loadingText.textContent = text;
    elements.progressFill.style.width = '0%';
    elements.loadingOverlay.classList.add('visible');
}

function updateLoadingProgress(text, percent) {
    elements.loadingText.textContent = text;
    elements.progressFill.style.width = `${percent}%`;
}

function hideLoading() {
    elements.loadingOverlay.classList.remove('visible');
}

// ===== Toast Notifications =====
function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    const iconPath = {
        success: '<polyline points="20 6 9 17 4 12"></polyline>',
        error: '<line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line>',
        info: '<circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line>'
    };
    
    toast.innerHTML = `
        <svg class="toast-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            ${iconPath[type]}
        </svg>
        <span class="toast-message">${message}</span>
        <button class="toast-close">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
        </button>
    `;
    
    toast.querySelector('.toast-close').addEventListener('click', () => {
        toast.remove();
    });
    
    elements.toastContainer.appendChild(toast);
    
    // Auto remove after 4 seconds
    setTimeout(() => {
        if (toast.parentNode) {
            toast.remove();
        }
    }, 4000);
}

// ===== Utilities =====
function generateId() {
    return `page_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

function downloadBlob(bytes, filename) {
    const blob = new Blob([bytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url); // Clean up memory
}

// ===== Start Application =====
document.addEventListener('DOMContentLoaded', init);
