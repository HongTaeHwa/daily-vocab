# Browser OCR distribution

Tesseract.js 5.1.1 and Tesseract.js-core 5.1.1 (Apache-2.0) are served locally to avoid tablet networks blocking third-party CDN downloads. Language models are English/Korean from naptha/tessdata 4.0.0 (Tesseract trained data, Apache-2.0). License notices are retained alongside the files. No user photos are included.

Downloaded over verified HTTPS from:
- https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js
- https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/worker.min.js
- https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.1/tesseract-core-lstm.wasm.js
- https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.1/tesseract-core-simd-lstm.wasm.js
- https://cdn.jsdelivr.net/gh/naptha/tessdata@gh-pages/4.0.0/eng.traineddata.gz
- https://cdn.jsdelivr.net/gh/naptha/tessdata@gh-pages/4.0.0/kor.traineddata.gz

SHA256SUMS records this vendored distribution. Verify from this directory with `sha256sum -c SHA256SUMS`. The non-SIMD and SIMD LSTM cores support different tablet capabilities. Do not remove one based on desktop-only testing. Initial download is approximately 22MB (one core plus both language files); subsequent requests may use browser caches. Offline first-time OCR is not guaranteed.
