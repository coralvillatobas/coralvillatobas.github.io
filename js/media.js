/* ═══════════════════════════════════════════════════════════
   CORAL MIGUEL DE AMBIELA — Sistema de medios y contenido editable
   Guarda fotos, vídeos y textos de verdad en la carpeta /media del
   proyecto usando la File System Access API (requiere servir la web
   por http://localhost, no funciona abriendo el archivo a doble clic).
   ═══════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  const slots = Array.from(document.querySelectorAll('.img-ph[data-media-id]'));
  const editables = Array.from(document.querySelectorAll('.editable[data-edit-id]'));
  const ytEditButtons = Array.from(document.querySelectorAll('[data-youtube-edit-id]'));
  const galleryContainers = document.querySelectorAll('[data-gallery-id]');
  if (slots.length === 0 && editables.length === 0 && galleryContainers.length === 0) return; // esta página no tiene nada que gestionar

  if (!('showDirectoryPicker' in window)) {
    console.info('Coral media: este navegador no admite acceso a archivos locales (funciona en Edge/Chrome, no en Firefox/Safari). El arrastrar/soltar y la edición quedan desactivados aquí.');
    return;
  }

  /* ── Mini almacén IndexedDB, solo para recordar la carpeta elegida ── */
  const DB_NAME = 'coral-media-db';
  const STORE = 'handles';

  function openDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  async function idbSet(key, val) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(val, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
  async function idbGet(key) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  /* ── Estado ── */
  let rootHandle = null;
  let mediaDir = null;
  let manifest = {};   // fotos/vídeos arrastrados: { mediaId: { file, type } }
  let content = {};    // textos/estados editables y vídeos de YouTube: { editId: valor }
  let connectBtn = null;
  let pendingChange = null; // una acción en espera de tener permiso de carpeta
  let toastEl = null;

  /* ── Aviso flotante (toast) ── */
  function showToast(msg) {
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.className = 'media-toast';
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastEl._t);
    toastEl._t = setTimeout(() => toastEl.classList.remove('show'), 2400);
  }

  /* ── Botón flotante para conceder/reconectar la carpeta ── */
  function showConnectButton(label) {
    if (connectBtn) connectBtn.remove();
    connectBtn = document.createElement('button');
    connectBtn.type = 'button';
    connectBtn.className = 'media-connect-btn';
    connectBtn.innerHTML = '<i class="fa-solid fa-folder-open" aria-hidden="true"></i> ' + label;
    connectBtn.addEventListener('click', requestConnection);
    document.body.appendChild(connectBtn);
  }
  function pulseConnectButton() {
    if (!connectBtn) return;
    connectBtn.classList.add('pulse');
    setTimeout(() => connectBtn && connectBtn.classList.remove('pulse'), 1200);
  }
  function hideConnectButton() {
    if (connectBtn) { connectBtn.remove(); connectBtn = null; }
  }
  function askToConnect(msg) {
    showToast(msg);
    showConnectButton(rootHandle ? 'Reconectar carpeta de medios' : 'Conectar carpeta de medios');
    pulseConnectButton();
  }

  /* ── Permisos ── */
  async function queryGranted() {
    if (!rootHandle) return false;
    try {
      return (await rootHandle.queryPermission({ mode: 'readwrite' })) === 'granted';
    } catch { return false; }
  }

  // Solo se llama desde un click real (botón), nunca desde "drop":
  // showDirectoryPicker/requestPermission exigen un gesto directo del usuario.
  async function requestConnection() {
    try {
      if (rootHandle) {
        const res = await rootHandle.requestPermission({ mode: 'readwrite' });
        if (res === 'granted') { await activate(); return; }
      }
      rootHandle = await window.showDirectoryPicker({ id: 'coral-media-root', mode: 'readwrite' });
      await idbSet('root', rootHandle);
      await activate();
    } catch (e) {
      if (e && e.name !== 'AbortError') console.warn('Coral media:', e);
    }
  }

  async function activate() {
    mediaDir = await rootHandle.getDirectoryHandle('media', { create: true });
    manifest = await readJson('manifest.json');
    content = await readJson('content.json');
    hideConnectButton();
    await hydrateAll();
    hydrateEditables();
    hydrateVideoThumbs();
    initGalleries();
    showToast('Carpeta de medios conectada');
    await processPendingChange();
  }

  async function readJson(filename) {
    try {
      const fh = await mediaDir.getFileHandle(filename);
      const file = await fh.getFile();
      return JSON.parse(await file.text());
    } catch {
      return {};
    }
  }
  async function writeManifest() {
    const fh = await mediaDir.getFileHandle('manifest.json', { create: true });
    const w = await fh.createWritable();
    await w.write(JSON.stringify(manifest, null, 2));
    await w.close();
  }
  async function writeContent() {
    const fh = await mediaDir.getFileHandle('content.json', { create: true });
    const w = await fh.createWritable();
    await w.write(JSON.stringify(content, null, 2));
    await w.close();
  }

  async function processPendingChange() {
    if (!pendingChange) return;
    const pc = pendingChange;
    pendingChange = null;
    if (pc.kind === 'drop') await commitDrop(pc.el, pc.file);
    else if (pc.kind === 'content') await commitContent(pc.id, pc.value);
    else if (pc.kind === 'youtube') await commitYoutube(pc.mediaId, pc.videoId, pc.el);
    else if (pc.kind === 'addGallery') await addNewGallerySlot(pc.container, pc.galleryId, pc.variant);
  }

  /* ═══════════ FOTOS Y VÍDEOS ARRASTRADOS ═══════════ */

  function renderSlot(el, type, url) {
    const old = el.querySelector('.media-content');
    if (old) old.remove();
    const node = document.createElement(type === 'video' ? 'video' : 'img');
    node.className = 'media-content';
    if (type === 'video') {
      node.src = url;
      node.muted = true;
      node.loop = true;
      node.playsInline = true;
      node.autoplay = true;
    } else {
      node.src = url;
      node.alt = '';
    }
    el.appendChild(node);
    el.classList.remove('media-empty');
    el.classList.add('media-filled');
  }

  async function hydrateOneSlot(el) {
    const entry = manifest[el.dataset.mediaId];
    if (!entry) return;
    try {
      const fh = await mediaDir.getFileHandle(entry.file);
      const file = await fh.getFile();
      renderSlot(el, entry.type, URL.createObjectURL(file));
    } catch { /* el archivo ya no está, se deja vacío */ }
  }

  async function hydrateAll() {
    for (const el of slots) {
      await hydrateOneSlot(el);
    }
  }

  function extOf(file) {
    if (file.name && file.name.includes('.')) return file.name.split('.').pop().toLowerCase();
    const sub = (file.type.split('/')[1] || '').toLowerCase();
    return sub || (file.type.startsWith('video/') ? 'mp4' : 'jpg');
  }

  async function commitDrop(el, file) {
    const id = el.dataset.mediaId;
    const type = file.type.startsWith('video/') ? 'video' : 'image';
    const filename = id + '.' + extOf(file);

    const prev = manifest[id];
    if (prev && prev.file !== filename) {
      try { await mediaDir.removeEntry(prev.file); } catch { /* no existía */ }
    }

    const fh = await mediaDir.getFileHandle(filename, { create: true });
    const w = await fh.createWritable();
    await w.write(file);
    await w.close();

    manifest[id] = { file: filename, type };
    await writeManifest();

    renderSlot(el, type, URL.createObjectURL(file));
    showToast(type === 'video' ? 'Vídeo guardado' : 'Imagen guardada');
  }

  /* ═══════════ TEXTOS EDITABLES (doble clic) ═══════════ */

  function hydrateEditables() {
    editables.forEach(el => {
      const id = el.dataset.editId;
      if (content[id] === undefined) return;
      if (el.dataset.editType === 'badge') renderBadge(el, content[id]);
      else el.textContent = content[id];
    });
  }

  function renderBadge(el, state) {
    el.dataset.badgeState = state;
    el.className = 'editable ' + (state === 'past' ? 'badge-past' : 'badge-upcoming');
    el.innerHTML = state === 'past'
      ? '<i class="fa-solid fa-check" aria-hidden="true"></i> Realizado'
      : '<i class="fa-solid fa-circle-dot" aria-hidden="true"></i> Próximamente';
  }

  function enterEditMode(el) {
    if (el.querySelector('input, textarea')) return; // ya está en edición
    const isTextarea = el.dataset.editType === 'textarea';
    const original = el.textContent.trim();
    const field = document.createElement(isTextarea ? 'textarea' : 'input');
    field.className = 'editable-input';
    field.value = original;
    if (isTextarea) field.rows = 3;
    el.textContent = '';
    el.appendChild(field);
    el.classList.add('editing');
    field.focus();
    field.select();

    let done = false;
    function finish(save) {
      if (done) return;
      done = true;
      const val = field.value.trim();
      el.classList.remove('editing');
      el.textContent = (save && val) ? val : original;
      if (save && val && val !== original) saveContent(el.dataset.editId, val);
    }
    field.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !isTextarea) { e.preventDefault(); finish(true); }
      else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    });
    field.addEventListener('blur', () => finish(true));
  }

  async function saveContent(id, value) {
    if (mediaDir && await queryGranted()) {
      await commitContent(id, value);
    } else {
      pendingChange = { kind: 'content', id, value };
      askToConnect('Pulsa "Conectar carpeta" para guardar este cambio');
    }
  }
  async function commitContent(id, value) {
    content[id] = value;
    await writeContent();
    showToast('Cambio guardado');
  }

  editables.forEach(el => {
    if (el.dataset.editType === 'badge') {
      renderBadge(el, el.dataset.badgeState || 'upcoming');
      el.addEventListener('click', () => {
        const next = el.dataset.badgeState === 'past' ? 'upcoming' : 'past';
        renderBadge(el, next);
        saveContent(el.dataset.editId, next);
      });
    } else {
      el.addEventListener('dblclick', () => enterEditMode(el));
    }
  });

  /* ═══════════ VÍDEOS DE YOUTUBE (editables) ═══════════ */

  function extractYoutubeId(input) {
    if (!input) return null;
    const raw = input.trim();
    if (/^[\w-]{11}$/.test(raw)) return raw;
    try {
      const u = new URL(raw);
      if (u.hostname.includes('youtu.be')) return u.pathname.slice(1).split('/')[0];
      if (u.searchParams.get('v')) return u.searchParams.get('v');
      const m = u.pathname.match(/\/(embed|shorts)\/([\w-]{11})/);
      if (m) return m[2];
    } catch { /* no era una URL válida */ }
    return null;
  }

  function renderYoutubeThumb(el, videoId) {
    const old = el.querySelector('.media-content');
    if (old) old.remove();
    const img = document.createElement('img');
    img.className = 'media-content';
    img.src = 'https://img.youtube.com/vi/' + videoId + '/hqdefault.jpg';
    img.alt = '';
    img.referrerPolicy = 'no-referrer';
    el.insertBefore(img, el.firstChild);
    el.classList.remove('media-empty');
    el.classList.add('media-filled');
  }

  function hydrateVideoThumbs() {
    slots.forEach(el => {
      const mediaId = el.dataset.mediaId;
      const ytId = content[mediaId + '-youtube'];
      if (!ytId) return;
      el.dataset.youtubeId = ytId;
      el.classList.remove('media-empty');
      if (!manifest[mediaId]) renderYoutubeThumb(el, ytId);
    });
  }

  async function saveYoutube(mediaId, videoId, el) {
    if (mediaDir && await queryGranted()) {
      await commitYoutube(mediaId, videoId, el);
    } else {
      pendingChange = { kind: 'youtube', mediaId, videoId, el };
      askToConnect('Pulsa "Conectar carpeta" para guardar el vídeo');
    }
  }
  async function commitYoutube(mediaId, videoId, el) {
    content[mediaId + '-youtube'] = videoId;
    await writeContent();
    el.dataset.youtubeId = videoId;
    el.classList.remove('media-empty');
    if (!manifest[mediaId]) renderYoutubeThumb(el, videoId);
    showToast('Vídeo actualizado');
  }

  /* Modal para pegar el enlace de YouTube */
  const ytModal = document.createElement('div');
  ytModal.className = 'media-modal';
  ytModal.innerHTML =
    '<div class="media-modal-backdrop"></div>' +
    '<div class="media-modal-card">' +
      '<h3>Vídeo de YouTube</h3>' +
      '<p>Pega el enlace del vídeo (o solo su ID).</p>' +
      '<input type="text" class="media-modal-input" placeholder="https://www.youtube.com/watch?v=...">' +
      '<div class="media-modal-actions">' +
        '<button type="button" class="btn btn-outline media-modal-cancel">Cancelar</button>' +
        '<button type="button" class="btn btn-primary media-modal-save">Guardar</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(ytModal);
  const ytInput = ytModal.querySelector('.media-modal-input');
  let ytTargetEl = null;

  function openYtModal(el) {
    ytTargetEl = el;
    ytInput.value = el.dataset.youtubeId ? ('https://www.youtube.com/watch?v=' + el.dataset.youtubeId) : '';
    ytModal.classList.add('open');
    setTimeout(() => ytInput.focus(), 50);
  }
  function closeYtModal() { ytModal.classList.remove('open'); ytTargetEl = null; }

  ytModal.querySelector('.media-modal-backdrop').addEventListener('click', closeYtModal);
  ytModal.querySelector('.media-modal-cancel').addEventListener('click', closeYtModal);
  ytModal.querySelector('.media-modal-save').addEventListener('click', () => {
    const id = extractYoutubeId(ytInput.value);
    if (!id) { showToast('No reconozco ese enlace de YouTube'); return; }
    const el = ytTargetEl;
    closeYtModal();
    saveYoutube(el.dataset.mediaId, id, el);
  });
  ytInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); ytModal.querySelector('.media-modal-save').click(); }
    else if (e.key === 'Escape') closeYtModal();
  });

  ytEditButtons.forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      e.preventDefault();
      const targetEl = document.querySelector('.img-ph[data-media-id="' + btn.dataset.youtubeEditId + '"]');
      if (targetEl) openYtModal(targetEl);
    });
  });

  /* ═══════════ VISOR AMPLIADO (lightbox: foto / vídeo / YouTube) ═══════════ */

  const lightbox = document.createElement('div');
  lightbox.className = 'media-lightbox';
  lightbox.innerHTML =
    '<div class="media-lightbox-backdrop"></div>' +
    '<button type="button" class="media-lightbox-close" aria-label="Cerrar">&times;</button>' +
    '<div class="media-lightbox-stage"></div>';
  document.body.appendChild(lightbox);
  const stage = lightbox.querySelector('.media-lightbox-stage');

  function closeLightbox() {
    lightbox.classList.remove('open');
    setTimeout(() => { stage.innerHTML = ''; }, 250);
  }
  function openLightbox(sourceNode) {
    stage.innerHTML = '';
    stage.classList.remove('is-youtube');
    let clone;
    if (sourceNode.tagName === 'VIDEO') {
      clone = document.createElement('video');
      clone.src = sourceNode.src;
      clone.controls = true;
      clone.autoplay = true;
      clone.loop = true;
    } else {
      clone = document.createElement('img');
      clone.src = sourceNode.src;
      clone.alt = '';
    }
    stage.appendChild(clone);
    lightbox.classList.add('open');
  }
  function openYoutubeLightbox(videoId) {
    stage.innerHTML = '';
    stage.classList.add('is-youtube');
    const iframe = document.createElement('iframe');
    iframe.src = 'https://www.youtube-nocookie.com/embed/' + videoId + '?autoplay=1&rel=0';
    iframe.title = 'Vídeo de YouTube';
    iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
    iframe.allowFullscreen = true;
    iframe.frameBorder = '0';
    stage.appendChild(iframe);
    lightbox.classList.add('open');
  }
  lightbox.querySelector('.media-lightbox-backdrop').addEventListener('click', closeLightbox);
  lightbox.querySelector('.media-lightbox-close').addEventListener('click', closeLightbox);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeLightbox(); });

  /* ── Cablear cada hueco de foto/vídeo (reutilizable: slots fijos y dinámicos) ── */
  function wireSlot(el) {
    el.classList.add('media-empty');

    el.addEventListener('dragenter', e => { e.preventDefault(); el.classList.add('media-dragover'); });
    el.addEventListener('dragover', e => { e.preventDefault(); });
    el.addEventListener('dragleave', () => el.classList.remove('media-dragover'));

    el.addEventListener('drop', async e => {
      e.preventDefault();
      el.classList.remove('media-dragover');
      const file = e.dataTransfer.files && e.dataTransfer.files[0];
      if (!file) return;
      if (!file.type.startsWith('image/') && !file.type.startsWith('video/')) {
        showToast('Solo se admiten imágenes o vídeos');
        return;
      }
      if (mediaDir && await queryGranted()) {
        commitDrop(el, file);
      } else {
        pendingChange = { kind: 'drop', el, file };
        askToConnect('Pulsa "Conectar carpeta" para guardar esta imagen');
      }
    });

    function activateSlot() {
      if (el.dataset.youtubeId) { openYoutubeLightbox(el.dataset.youtubeId); return; }
      if (el.dataset.noLightbox === 'true') return;
      if (!el.classList.contains('media-filled')) return;
      const node = el.querySelector('.media-content');
      if (node) openLightbox(node);
    }

    el.addEventListener('click', activateSlot);
    if (el.getAttribute('role') === 'button') {
      el.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activateSlot(); }
      });
    }
  }

  slots.forEach(wireSlot);

  /* ═══════════ GALERÍAS DINÁMICAS (botón "+ añadir foto") ═══════════ */

  function createGallerySlotEl(container, galleryId, suffix, variant) {
    const mediaId = galleryId + '-' + suffix;
    if (container.querySelector('[data-media-id="' + mediaId + '"]')) return; // evita duplicados si ya existe
    const addBtn = container.querySelector('[data-gallery-add]');

    let wrapper, slotEl;
    if (variant === 'masonry') {
      wrapper = document.createElement('div');
      wrapper.className = 'gallery-item';
      slotEl = document.createElement('div');
      slotEl.className = 'img-ph';
      slotEl.style.height = '220px';
      const overlay = document.createElement('div');
      overlay.className = 'gallery-overlay';
      overlay.innerHTML = '<i class="fa-solid fa-magnifying-glass-plus" aria-hidden="true"></i>';
      wrapper.appendChild(slotEl);
      wrapper.appendChild(overlay);
    } else {
      slotEl = document.createElement('div');
      slotEl.className = 'img-ph';
      slotEl.style.height = '220px';
      wrapper = slotEl;
    }
    slotEl.dataset.mediaId = mediaId;
    slotEl.dataset.dynamic = 'true';
    slotEl.setAttribute('role', 'img');
    slotEl.setAttribute('aria-label', 'Foto añadida a la galería');

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'dyn-slot-remove';
    removeBtn.innerHTML = '&times;';
    removeBtn.setAttribute('aria-label', 'Quitar esta foto');
    slotEl.appendChild(removeBtn);

    if (addBtn) container.insertBefore(wrapper, addBtn);
    else container.appendChild(wrapper);

    wireSlot(slotEl);
    slots.push(slotEl);
    wireGalleryRemove(removeBtn, slotEl, wrapper, galleryId, suffix);
    hydrateOneSlot(slotEl); // por si ya tenía foto guardada de una sesión anterior
  }

  function wireGalleryRemove(btn, slotEl, wrapper, galleryId, suffix) {
    btn.addEventListener('click', async e => {
      e.preventDefault();
      e.stopPropagation();
      if (!confirm('¿Quitar esta foto de la galería?')) return;
      const mediaId = slotEl.dataset.mediaId;
      if (manifest[mediaId]) {
        if (mediaDir) { try { await mediaDir.removeEntry(manifest[mediaId].file); } catch { /* no existía */ } }
        delete manifest[mediaId];
        if (mediaDir && await queryGranted()) await writeManifest();
      }
      const key = 'gallery:' + galleryId;
      const current = Array.isArray(content[key]) ? content[key] : [];
      const idx = current.indexOf(suffix);
      if (idx > -1) {
        current.splice(idx, 1);
        content[key] = current;
        if (mediaDir && await queryGranted()) await writeContent();
      }
      wrapper.remove();
      const i = slots.indexOf(slotEl);
      if (i > -1) slots.splice(i, 1);
      showToast('Foto quitada');
    });
  }

  async function addNewGallerySlot(container, galleryId, variant) {
    const suffix = 'extra-' + Date.now();
    const key = 'gallery:' + galleryId;
    const current = Array.isArray(content[key]) ? content[key].slice() : [];
    current.push(suffix);
    content[key] = current;
    await writeContent();
    createGallerySlotEl(container, galleryId, suffix, variant);
    showToast('Hueco añadido: arrastra una foto sobre él');
  }

  function initGalleries() {
    document.querySelectorAll('[data-gallery-id]').forEach(container => {
      const galleryId = container.dataset.galleryId;
      const variant = container.dataset.galleryVariant || 'grid';
      const key = 'gallery:' + galleryId;
      const extras = Array.isArray(content[key]) ? content[key] : [];
      extras.forEach(suffix => createGallerySlotEl(container, galleryId, suffix, variant));
    });
  }

  document.querySelectorAll('[data-gallery-add]').forEach(btn => {
    const container = btn.closest('[data-gallery-id]');
    if (!container) return;
    const galleryId = container.dataset.galleryId;
    const variant = container.dataset.galleryVariant || 'grid';
    btn.addEventListener('click', async () => {
      if (mediaDir && await queryGranted()) {
        await addNewGallerySlot(container, galleryId, variant);
      } else {
        pendingChange = { kind: 'addGallery', container, galleryId, variant };
        askToConnect('Pulsa "Conectar carpeta" para añadir una foto nueva');
      }
    });
  });

  /* ── Arranque ── */
  (async function init() {
    rootHandle = await idbGet('root');
    if (rootHandle && await queryGranted()) {
      await activate();
    } else if (rootHandle) {
      showConnectButton('Reconectar carpeta de medios');
    } else {
      showConnectButton('Conectar carpeta de medios');
    }
  })();

})();
