/**
 * PDF Merger & Splitter - Client-Side PDF Tool
 * All processing happens in the browser - no server uploads
 */

// Configure PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

// ===== State Management =====
const state = {
    pages: [],           // Array of page objects
    selectedIds: new Set(), // Set of selected page IDs
    draggedId: null,     // Currently dragged page ID
    isProcessing: false  // Processing flag
};

// ===== DOM Elements =====
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
    mergeBtn: document.getElementById('mergeBtn')
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
    elements.mergeBtn.addEventListener('click', mergeAndExport);
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
    e.target.value = ''; // Reset input
}

// ===== PDF Processing =====
async function processFiles(files) {
    if (state.isProcessing) return;
    
    state.isProcessing = true;
    showLoading('Loading PDF files...');
    
    try {
        let totalPages = 0;
        let processedPages = 0;
        
        // First pass: count total pages
        for (const file of files) {
            const arrayBuffer = await file.arrayBuffer();
            const pdfDoc = await PDFLib.PDFDocument.load(arrayBuffer, { ignoreEncryption: true });
            totalPages += pdfDoc.getPageCount();
        }
        
        // Second pass: process pages
        for (const file of files) {
            const arrayBuffer = await file.arrayBuffer();
            // Create a copy of the bytes to store (important for later use)
            const pdfBytes = new Uint8Array(arrayBuffer).slice();
            
            // Load with pdf-lib for manipulation
            const pdfDoc = await PDFLib.PDFDocument.load(pdfBytes, { ignoreEncryption: true });
            const pageCount = pdfDoc.getPageCount();
            
            // Load with PDF.js for thumbnails - use a copy
            const pdfJsDoc = await pdfjsLib.getDocument({ data: pdfBytes.slice() }).promise;
            
            for (let i = 0; i < pageCount; i++) {
                updateLoadingProgress(
                    `Processing page ${processedPages + 1} of ${totalPages}...`,
                    ((processedPages + 1) / totalPages) * 100
                );
                
                // Generate thumbnail
                const thumbnail = await generateThumbnail(pdfJsDoc, i + 1);
                
                // Create page object - store a reference to the shared pdfBytes
                // All pages from same file share the same bytes array
                const pageData = {
                    id: generateId(),
                    sourceFile: file.name,
                    pageIndex: i,
                    originalPageNumber: i + 1,
                    pdfBytes: pdfBytes, // Shared reference is fine since we sliced above
                    thumbnail: thumbnail
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
    
    // Use white background
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

function createPageCard(page, displayNumber) {
    const card = document.createElement('div');
    card.className = 'page-card';
    card.dataset.id = page.id;
    card.draggable = true;
    
    if (state.selectedIds.has(page.id)) {
        card.classList.add('selected');
    }
    
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
        <div class="page-thumbnail">
            <img src="${page.thumbnail}" alt="Page ${displayNumber}">
        </div>
        <div class="page-info-bar">
            <span class="page-number">Page ${displayNumber}</span>
            <span class="page-source" title="${page.sourceFile}">${page.sourceFile}</span>
        </div>
    `;
    
    // Click to select
    card.addEventListener('click', (e) => {
        if (e.target.closest('.drag-handle')) return;
        togglePageSelection(page.id);
    });
    
    // Drag events
    card.addEventListener('dragstart', (e) => handlePageDragStart(e, page.id));
    card.addEventListener('dragend', handlePageDragEnd);
    card.addEventListener('dragover', handlePageDragOver);
    card.addEventListener('dragleave', handlePageDragLeave);
    card.addEventListener('drop', (e) => handlePageDrop(e, page.id));
    
    return card;
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
    
    // Reorder pages
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
            newPdf.addPage(copiedPage);
            
            // Optimize and download
            const pdfBytes = await newPdf.save({
                useObjectStreams: true,
                addDefaultPage: false
            });
            
            downloadBlob(pdfBytes, `page_${i + 1}.pdf`);
            
            // Small delay between downloads
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
            newPdf.addPage(copiedPage);
        }
        
        // Optimize PDF for smaller file size
        const pdfBytes = await newPdf.save({
            useObjectStreams: true,     // Compress object streams
            addDefaultPage: false       // Don't add empty pages
        });
        
        // Generate filename
        const timestamp = new Date().toISOString().slice(0, 10);
        const filename = state.selectedIds.size > 0 
            ? `merged_selected_${timestamp}.pdf`
            : `merged_all_${timestamp}.pdf`;
        
        downloadBlob(pdfBytes, filename);
        
        hideLoading();
        const pageLabel = state.selectedIds.size > 0 ? 'selected' : 'all';
        showToast(`Exported ${pagesToMerge.length} ${pageLabel} pages`, 'success');
        
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
    URL.revokeObjectURL(url);
}

// ===== Start Application =====
document.addEventListener('DOMContentLoaded', init);
