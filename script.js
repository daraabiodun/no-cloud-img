(() => {
  'use strict';

  const MAX_BYTES = 50 * 1024 * 1024;
  const MAX_PIXELS = 100_000_000;
  const PRESETS = [100, 75, 50, 25];
  const EXIFR_URL = 'https://cdn.jsdelivr.net/npm/exifr@7.1.3/dist/lite.esm.mjs';

  const FORMATS = [
    { id: 'image/jpeg', label: 'JPEG', ext: 'jpg', lossy: true },
    { id: 'image/png', label: 'PNG', ext: 'png', lossy: false },
    { id: 'image/webp', label: 'WebP', ext: 'webp', lossy: true },
    { id: 'image/avif', label: 'AVIF', ext: 'avif', lossy: true },
  ];

  const $ = (id) => {
    const el = document.getElementById(id);
    if (!el) throw new Error(`Missing element #${id}`);
    return el;
  };

  const els = {
    file: $('file'),
    drop: $('drop'),
    preview: $('preview'),
    img: $('img'),
    caption: $('caption'),
    error: $('error'),
    workspace: $('workspace'),
    formats: $('formats'),
    formatNote: $('format-note'),
    quality: $('quality'),
    qualityOut: $('quality-out'),
    qualityField: $('quality-field'),
    chips: $('chips'),
    lock: $('lock'),
    width: $('width'),
    height: $('height'),
    meta: $('meta'),
    metaNote: $('meta-note'),
    bar: $('bar'),
    sizeFrom: $('size-from'),
    sizeTo: $('size-to'),
    delta: $('delta'),
    download: $('download'),
    tabs: document.querySelectorAll('button[data-view]'),
  };

  const state = {
    file: null,
    bitmap: null,
    base: 'image',
    formats: [],
    format: null,
    quality: 80,
    width: 0,
    height: 0,
    lock: true,
    originalUrl: '',
    result: null,
    view: 'result',
    token: 0,
  };

  let timer = 0;

  // ---------- helpers ----------

  const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

  function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    const units = ['KB', 'MB', 'GB'];
    let value = bytes;
    let i = -1;
    do {
      value /= 1024;
      i += 1;
    } while (value >= 1024 && i < units.length - 1);
    return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[i]}`;
  }

  function showError(message) {
    els.error.textContent = message;
    els.error.hidden = false;
  }

  function clearError() {
    els.error.hidden = true;
    els.error.textContent = '';
  }

  const toBlob = (canvas, type, quality) =>
    new Promise((resolve) => canvas.toBlob(resolve, type, quality));

  function makeCanvas(w, h) {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    return canvas;
  }

  // ---------- capability detection ----------

  async function detectFormats() {
    const probe = makeCanvas(1, 1);
    const supported = new Set();
    await Promise.all(
      FORMATS.map(
        (f) =>
          new Promise((resolve) => {
            probe.toBlob(
              (blob) => {
                if (blob && blob.type === f.id) supported.add(f.id);
                resolve();
              },
              f.id,
              0.5,
            );
          }),
      ),
    );
    return FORMATS.filter((f) => supported.has(f.id));
  }

  // ---------- pipeline ----------

  // Halve repeatedly before the final draw. One big jump aliases badly.
  function render(bitmap, w, h, opaque) {
    let source = bitmap;
    let sw = bitmap.width;
    let sh = bitmap.height;

    while (sw >= w * 2 && sh >= h * 2) {
      const nw = Math.max(1, Math.ceil(sw / 2));
      const nh = Math.max(1, Math.ceil(sh / 2));
      const step = makeCanvas(nw, nh);
      const ctx = step.getContext('2d');
      if (!ctx) throw new Error('canvas');
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(source, 0, 0, nw, nh);
      source = step;
      sw = nw;
      sh = nh;
    }

    const out = makeCanvas(w, h);
    const ctx = out.getContext('2d');
    if (!ctx) throw new Error('canvas');
    if (opaque) {
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, w, h);
    }
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(source, 0, 0, w, h);
    return out;
  }

  function schedule(delay = 150) {
    clearTimeout(timer);
    timer = setTimeout(encode, delay);
  }

  async function encode() {
    const { bitmap, file, format, width, height, quality } = state;
    if (!bitmap || !file || !format) return;

    const token = ++state.token;
    els.preview.classList.add('busy');

    try {
      const canvas = render(bitmap, width, height, format.id === 'image/jpeg');
      const blob = await toBlob(canvas, format.id, quality / 100);
      if (token !== state.token) return;
      if (!blob || blob.type !== format.id) throw new Error('encode');

      if (state.result) URL.revokeObjectURL(state.result.url);
      state.result = { blob, url: URL.createObjectURL(blob), width, height, format };

      clearError();
      renderPreview();
      renderBar();
    } catch {
      if (token === state.token) {
        showError(`Could not encode ${format.label} at ${width} x ${height}. Try smaller dimensions.`);
      }
    } finally {
      if (token === state.token) els.preview.classList.remove('busy');
    }
  }

  // ---------- rendering ----------

  function renderPreview() {
    const { bitmap, file, result } = state;
    if (!bitmap || !file) return;

    const showOriginal = state.view === 'original' || !result;
    els.img.src = showOriginal ? state.originalUrl : result.url;
    els.img.alt = showOriginal ? 'Preview of the original image' : 'Preview of the processed image';
    els.caption.textContent = showOriginal
      ? `${bitmap.width} x ${bitmap.height} \u00b7 ${formatBytes(file.size)} \u00b7 original`
      : `${result.width} x ${result.height} \u00b7 ${formatBytes(result.blob.size)} \u00b7 ${result.format.label}`;

    els.tabs.forEach((tab) => {
      tab.setAttribute('aria-selected', String(tab.dataset.view === state.view));
    });
  }

  function renderBar() {
    const { file, result } = state;
    if (!file || !result) return;

    els.bar.hidden = false;
    els.sizeFrom.textContent = formatBytes(file.size);
    els.sizeTo.textContent = formatBytes(result.blob.size);

    const change = Math.round((result.blob.size / file.size - 1) * 100);
    const worse = change > 0;
    els.delta.textContent = change === 0 ? '0%' : `${worse ? '+' : '\u2212'}${Math.abs(change)}%`;
    els.delta.classList.toggle('worse', worse);

    els.download.href = result.url;
    els.download.download = `${state.base}-min.${result.format.ext}`;
    els.download.setAttribute('aria-disabled', 'false');
  }

  function renderFormats() {
    const buttons = state.formats.map((f) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'pill';
      button.setAttribute('role', 'radio');
      button.dataset.format = f.id;
      button.textContent = f.label;
      return button;
    });
    els.formats.replaceChildren(...buttons);
    syncFormatUI();
  }

  function syncFormatUI() {
    const { format } = state;
    if (!format) return;

    els.formats.querySelectorAll('[data-format]').forEach((button) => {
      button.setAttribute('aria-checked', String(button.dataset.format === format.id));
    });

    els.quality.disabled = !format.lossy;
    els.qualityField.classList.toggle('off', !format.lossy);
    els.qualityOut.textContent = format.lossy ? String(state.quality) : 'Lossless';

    const jpeg = format.id === 'image/jpeg';
    els.formatNote.hidden = !jpeg;
    els.formatNote.textContent = jpeg ? 'JPEG has no transparency. Transparent areas become white.' : '';
  }

  function renderChips() {
    const buttons = PRESETS.map((pct) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'pill';
      button.dataset.pct = String(pct);
      button.setAttribute('aria-pressed', 'false');
      button.textContent = `${pct}%`;
      return button;
    });
    els.chips.prepend(...buttons);
  }

  function syncInputs() {
    if (document.activeElement !== els.width) els.width.value = String(state.width);
    if (document.activeElement !== els.height) els.height.value = String(state.height);
    els.width.max = String(state.bitmap?.width ?? '');
    els.height.max = String(state.bitmap?.height ?? '');

    els.chips.querySelectorAll('[data-pct]').forEach((chip) => {
      const bitmap = state.bitmap;
      const pct = Number(chip.dataset.pct);
      const on =
        !!bitmap &&
        state.width === Math.max(1, Math.round((bitmap.width * pct) / 100)) &&
        state.height === Math.max(1, Math.round((bitmap.height * pct) / 100));
      chip.setAttribute('aria-pressed', String(on));
    });
  }

  function renderMeta(rows, note) {
    const nodes = rows.map(([label, value]) => {
      const row = document.createElement('div');
      row.className = 'meta-row';
      const dt = document.createElement('dt');
      const dd = document.createElement('dd');
      dt.textContent = label;
      dd.textContent = value;
      row.append(dt, dd);
      return row;
    });
    els.meta.replaceChildren(...nodes);
    els.metaNote.textContent = note;
  }

  // ---------- size logic ----------

  function setSize({ width, height }) {
    const { bitmap } = state;
    if (!bitmap) return;

    const ratio = bitmap.width / bitmap.height;
    let w = width ?? state.width;
    let h = height ?? state.height;

    if (state.lock) {
      if (width !== undefined) h = Math.round(w / ratio);
      else if (height !== undefined) w = Math.round(h * ratio);
    }

    state.width = clamp(w, 1, bitmap.width);
    state.height = clamp(h, 1, bitmap.height);
    syncInputs();
    schedule();
  }

  function setPercent(pct) {
    const { bitmap } = state;
    if (!bitmap) return;
    state.width = Math.max(1, Math.round((bitmap.width * pct) / 100));
    state.height = Math.max(1, Math.round((bitmap.height * pct) / 100));
    syncInputs();
    schedule(0);
  }

  // ---------- metadata ----------

  const safely = async (fn) => {
    try {
      return await fn();
    } catch {
      return undefined;
    }
  };

  function formatDate(value) {
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toLocaleString();
    return String(value);
  }

  async function readMetadata(file) {
    renderMeta([['Status', 'Reading...']], '');

    let lib;
    try {
      lib = await import(EXIFR_URL);
    } catch {
      if (state.file === file) renderMeta([], 'Reader unavailable. Export is clean regardless.');
      return;
    }

    const parse = lib.parse ?? lib.default?.parse;
    const gps = lib.gps ?? lib.default?.gps;
    const picks = ['Make', 'Model', 'LensModel', 'DateTimeOriginal', 'Software', 'ISO', 'FNumber', 'ExposureTime'];

    const tags = await safely(() => parse?.(file, picks));
    const where = await safely(() => gps?.(file));
    if (state.file !== file) return;

    const rows = [];
    const camera = [tags?.Make, tags?.Model].filter(Boolean).join(' ');
    if (camera) rows.push(['Camera', camera]);
    if (tags?.LensModel) rows.push(['Lens', String(tags.LensModel)]);
    if (tags?.DateTimeOriginal) rows.push(['Taken', formatDate(tags.DateTimeOriginal)]);

    const exposure = [];
    if (tags?.ISO) exposure.push(`ISO ${tags.ISO}`);
    if (tags?.FNumber) exposure.push(`f/${tags.FNumber}`);
    if (typeof tags?.ExposureTime === 'number' && tags.ExposureTime > 0) {
      exposure.push(tags.ExposureTime < 1 ? `1/${Math.round(1 / tags.ExposureTime)}s` : `${tags.ExposureTime}s`);
    }
    if (exposure.length) rows.push(['Exposure', exposure.join('  ')]);

    if (tags?.Software) rows.push(['Software', String(tags.Software)]);
    if (Number.isFinite(where?.latitude) && Number.isFinite(where?.longitude)) {
      rows.push(['Location', `${where.latitude.toFixed(3)}, ${where.longitude.toFixed(3)}`]);
    }

    renderMeta(
      rows,
      rows.length ? 'All of this is removed on export' : 'No readable EXIF found. Export is clean either way.',
    );
  }

  // ---------- loading ----------

  function dispose() {
    state.token += 1;
    clearTimeout(timer);
    state.bitmap?.close();
    if (state.originalUrl) URL.revokeObjectURL(state.originalUrl);
    if (state.result) URL.revokeObjectURL(state.result.url);
    state.bitmap = null;
    state.originalUrl = '';
    state.result = null;
  }

  async function loadFile(file) {
    if (!file) return;
    clearError();

    if (!file.type.startsWith('image/')) return showError('That is not an image.');
    if (file.size > MAX_BYTES) return showError(`Files over ${formatBytes(MAX_BYTES)} are not supported.`);

    let bitmap;
    try {
      bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      return showError('This browser cannot decode that image. Try JPEG, PNG or WebP.');
    }

    if (bitmap.width * bitmap.height > MAX_PIXELS) {
      bitmap.close();
      return showError('That image is over 100 megapixels. Resize it first.');
    }

    dispose();

    state.file = file;
    state.bitmap = bitmap;
    state.originalUrl = URL.createObjectURL(file);
    state.base = file.name.replace(/\.[^.]+$/, '').replace(/[^\w.-]+/g, '-').slice(0, 80) || 'image';
    state.width = bitmap.width;
    state.height = bitmap.height;
    state.view = 'result';

    els.drop.hidden = true;
    els.preview.hidden = false;
    els.workspace.hidden = false;
    els.bar.hidden = true;
    els.download.setAttribute('aria-disabled', 'true');

    syncInputs();
    renderPreview();
    readMetadata(file);
    schedule(0);
  }

  // ---------- events ----------

  function bindEvents() {
    els.file.addEventListener('change', () => {
      const file = els.file.files?.[0];
      els.file.value = '';
      loadFile(file);
    });

    window.addEventListener('dragover', (e) => {
      e.preventDefault();
      els.drop.classList.add('over');
    });
    window.addEventListener('dragleave', (e) => {
      if (e.relatedTarget === null) els.drop.classList.remove('over');
    });
    window.addEventListener('drop', (e) => {
      e.preventDefault();
      els.drop.classList.remove('over');
      loadFile(e.dataTransfer?.files?.[0]);
    });

    window.addEventListener('paste', (e) => {
      const items = Array.from(e.clipboardData?.items ?? []);
      const item = items.find((i) => i.kind === 'file' && i.type.startsWith('image/'));
      const file = item?.getAsFile();
      if (file) loadFile(file);
    });

    els.tabs.forEach((tab) => {
      tab.addEventListener('click', () => {
        state.view = tab.dataset.view === 'original' ? 'original' : 'result';
        renderPreview();
      });
    });

    els.formats.addEventListener('click', (e) => {
      if (!(e.target instanceof Element)) return;
      const button = e.target.closest('[data-format]');
      if (!button) return;
      const next = state.formats.find((f) => f.id === button.dataset.format);
      if (!next || next === state.format) return;
      state.format = next;
      syncFormatUI();
      schedule(0);
    });

    els.quality.addEventListener('input', () => {
      state.quality = clamp(Number(els.quality.value) || 80, 1, 100);
      els.qualityOut.textContent = String(state.quality);
      schedule();
    });

    els.chips.addEventListener('click', (e) => {
      if (!(e.target instanceof Element)) return;
      const chip = e.target.closest('[data-pct]');
      if (chip) setPercent(Number(chip.dataset.pct));
    });

    els.lock.addEventListener('click', () => {
      state.lock = !state.lock;
      els.lock.setAttribute('aria-pressed', String(state.lock));
      if (state.lock) setSize({ width: state.width });
    });

    els.width.addEventListener('input', () => {
      const value = parseInt(els.width.value, 10);
      if (Number.isFinite(value) && value >= 1) setSize({ width: value });
    });
    els.height.addEventListener('input', () => {
      const value = parseInt(els.height.value, 10);
      if (Number.isFinite(value) && value >= 1) setSize({ height: value });
    });
    els.width.addEventListener('change', syncInputs);
    els.height.addEventListener('change', syncInputs);
    els.width.addEventListener('blur', syncInputs);
    els.height.addEventListener('blur', syncInputs);

    els.download.addEventListener('click', (e) => {
      if (els.download.getAttribute('aria-disabled') === 'true') e.preventDefault();
    });
  }

  async function init() {
    state.formats = await detectFormats();
    state.format = state.formats.find((f) => f.id === 'image/webp') ?? state.formats[0] ?? null;
    if (!state.format) {
      showError('This browser cannot export images from a canvas.');
      return;
    }
    renderFormats();
    renderChips();
    bindEvents();
  }

  init();
})();
