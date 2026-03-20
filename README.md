# PaperFuse

**Privacy-first PDF toolkit that runs entirely in your browser**

[![Live Demo](https://img.shields.io/badge/Live%20Demo-paperfuse.netlify.app-3b82f6?style=for-the-badge)](https://paperfuse.netlify.app/)
![React](https://img.shields.io/badge/Made%20with-React-61DAFB?style=for-the-badge&logo=react&logoColor=111827)
![License: MIT](https://img.shields.io/badge/License-MIT-22c55e?style=for-the-badge)
![Privacy: No Upload](https://img.shields.io/badge/Privacy-No%20Uploads-111827?style=for-the-badge)

PaperFuse is a client-side PDF tool for merging, arranging, and exporting documents without uploading files to any server.

##  Features

### Multi-PDF Merge
- Upload multiple PDFs at once and view all pages in one responsive thumbnail grid.
- Pages are grouped by source file, and you can drag-and-drop across groups.
- Rotate pages, delete unwanted pages, and export a single merged PDF in the exact order you set.

### Image to PDF
- Upload JPG, PNG, and WEBP files alongside PDFs in the same workflow.
- Images are treated as single-page documents and appear in the same sortable grid.
- On export, images are converted and merged into the final PDF in sequence.

### Watermark
- Add a custom text watermark across all exported pages.
- Configure font size, opacity, color, and placement.
- Supports center diagonal placement or corner positions.

## Privacy
- Files never leave your device.
- No backend processing, no cloud storage, no upload step.
- All PDF/image processing is handled in-browser via `pdf-lib` and `PDF.js`.

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React + Vite |
| Styling | Tailwind CSS |
| PDF Manipulation | pdf-lib |
| Thumbnail Rendering | PDF.js (`pdfjs-dist`) |
| Deployment | Netlify |

## Getting Started

```bash
git clone https://github.com/Bhavesh1506/PaperFuse.git
cd PaperFuse
npm install
npm run dev
```

## Screenshots

[Add screenshots here]

## Contributing

Contributions are welcome. Feel free to open an issue for ideas, bug reports, or feature requests, and submit a PR if you want to improve PaperFuse.

## ?? License

This project is licensed under the MIT License.
