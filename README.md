# PaperFuse (PDF Merger)

Privacy-first PDF merger built with React + Vite + Tailwind CSS.
All processing runs entirely in the browser using `pdf-lib` and `PDF.js`.

## Features

- Drag-and-drop multi-PDF upload
- Per-file thumbnail generation progress
- Unified page grid with source file headers/colors
- Reorder pages (mouse drag + touch drag)
- Rotate and delete page thumbnails
- Select all / deselect all / delete selected
- Undo last action
- Sticky merge/export action with export modal
- Client-side PDF export in current grid order
- No backend, no uploads

## Stack

- React + Vite
- Tailwind CSS
- `pdf-lib` for merging/export transformations
- `pdfjs-dist` (PDF.js) for thumbnail rendering

## Run locally

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
npm run preview
```