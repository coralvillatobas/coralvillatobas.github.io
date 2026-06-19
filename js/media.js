/* ═══════════════════════════════════════════════════════════
   CORAL MIGUEL DE AMBIELA — Sistema de medios y contenido editable
   Todo el mundo ve las fotos y textos publicados al cargar la página.
   Quien inicia sesión con usuario/contraseña entra en modo edición:
   los cambios se mandan al Worker (coral-edicion-api), que es quien
   los publica de verdad en GitHub. La web nunca conoce la contraseña
   real ni la llave de GitHub.
   ═══════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  const WORKER_URL = 'https://coral-edicion-api.coralvillatobas.workers.dev';
  const TOKEN_KEY = 'coral-edit-token';
  const mediaBase = location.pathname.includes('/pages/') ? '../media/' : 'media/';

  const slots = Array.from(document.querySelectorAll('.img-ph[data-media-id]'));
  const editables = Array.from(document.querySelectorAll('.editable[data-edit-id]'));
  const ytEditButtons = Array.from(document.querySelectorAll('[data-youtube-edit-id]'));

  /* ── Estado ── */
  let manifest = {};   // fotos/vídeos: { mediaId: { file, type } }
  let content = {};    // textos, badges y vídeos de YouTube: { editId: valor }
  let token = localStorage.getItem(TOKEN_KEY) || null;
  let editMode = false;
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
    const duration = Math.min(7000, Math.max(3200, msg.length * 60));
    toastEl._t = setTimeout(() => toastEl.classList.remove('show'), duration);
  }

  /* ═══════════ Llamadas al Worker ═══════════ */

  async function workerPost(path, body) {
    const res = await fetch(WORKER_URL + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    let data = {};
    try { data = await res.json(); } catch { /* respuesta vacía */ }
    if (!res.ok) throw new Error(data.error || ('Error ' + res.status));
    return data;
  }

  async function persistContent() {
    await workerPost('/save-json', { token, path: 'media/content.json', data: content });
  }
  async function persistManifest() {
    await workerPost('/save-json', { token, path: 'media/manifest.json', data: manifest });
  }

  /* ═══════════ Carga pública: igual para todo el mundo ═══════════ */

  async function fetchJson(url) {
    try {
      const res = await fetch(url + '?t=' + Date.now(), { cache: 'no-store' });
      if (!res.ok) return {};
      return await res.json();
    } catch {
      return {};
    }
  }

  async function loadPublicData() {
    manifest = await fetchJson(mediaBase + 'manifest.json');
    content = await fetchJson(mediaBase + 'content.json');
    hydrateAll();
    hydrateEditablesStatic();
    hydrateVideoThumbs();
    initGalleriesStatic();
  }

  /* ═══════════ FOTOS Y VÍDEOS ═══════════ */

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

  function hydrateOneSlot(el) {
    const entry = manifest[el.dataset.mediaId];
    if (!entry) return;
    renderSlot(el, entry.type, mediaBase + entry.file + '?t=' + Date.now());
  }

  function hydrateAll() {
    slots.forEach(hydrateOneSlot);
  }

  function extOf(file) {
    if (file.name && file.name.includes('.')) return file.name.split('.').pop().toLowerCase();
    const sub = (file.type.split('/')[1] || '').toLowerCase();
    return sub || (file.type.startsWith('video/') ? 'mp4' : 'jpg');
  }

  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result.split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function compressImage(file, maxDim, quality) {
    maxDim = maxDim || 1600;
    quality = quality || 0.82;
    return new Promise((resolve, reject) => {
      const img = new Image();
      const objUrl = URL.createObjectURL(file);
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          if (width > height) { height = Math.round(height * maxDim / width); width = maxDim; }
          else { width = Math.round(width * maxDim / height); height = maxDim; }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        canvas.toBlob(blob => {
          URL.revokeObjectURL(objUrl);
          if (!blob) { reject(new Error('No se pudo procesar la imagen')); return; }
          const reader = new FileReader();
          reader.onload = () => resolve({ base64: reader.result.split(',')[1], blob });
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        }, 'image/jpeg', quality);
      };
      img.onerror = () => reject(new Error('Este navegador no puede leer ese formato de imagen (frecuente con fotos HEIC de iPhone). Prueba a exportarla o compartirla antes como JPG.'));
      img.src = objUrl;
    });
  }

  async function commitDrop(el, file) {
    const id = el.dataset.mediaId;
    const isVideo = file.type.startsWith('video/');

    try {
      if (isVideo) {
        const MAX_VIDEO_BYTES = 8 * 1024 * 1024;
        if (file.size > MAX_VIDEO_BYTES) {
          showToast('Ese vídeo pesa demasiado (máx. 8 MB). Súbelo más ligero o enlázalo como vídeo de YouTube.');
          return;
        }
        showToast('Subiendo vídeo…');
        const filename = id + '.' + extOf(file);
        const prev = manifest[id];
        if (prev && prev.file !== filename) {
          try { await workerPost('/delete-file', { token, path: 'media/' + prev.file }); } catch { /* no existía */ }
        }
        const base64 = await fileToBase64(file);
        await workerPost('/save-image', { token, path: 'media/' + filename, base64 });
        manifest[id] = { file: filename, type: 'video' };
        await persistManifest();
        renderSlot(el, 'video', URL.createObjectURL(file));
        showToast('Vídeo guardado, se publicará en un minuto');
      } else {
        showToast('Optimizando y subiendo imagen…');
        const filename = id + '.jpg';
        const prev = manifest[id];
        if (prev && prev.file !== filename) {
          try { await workerPost('/delete-file', { token, path: 'media/' + prev.file }); } catch { /* no existía */ }
        }
        const { base64, blob } = await compressImage(file);
        await workerPost('/save-image', { token, path: 'media/' + filename, base64 });
        manifest[id] = { file: filename, type: 'image' };
        await persistManifest();
        renderSlot(el, 'image', URL.createObjectURL(blob));
        showToast('Imagen guardada, se publicará en un minuto');
      }
    } catch (e) {
      showToast('No se pudo guardar: ' + e.message);
    }
  }

  /* ═══════════ TEXTOS EDITABLES ═══════════ */

  function hydrateEditablesStatic() {
    editables.forEach(el => {
      const id = el.dataset.editId;
      if (el.dataset.editType === 'badge') {
        renderBadge(el, content[id] !== undefined ? content[id] : (el.dataset.badgeState || 'upcoming'));
      } else if (content[id] !== undefined) {
        el.textContent = content[id];
      }
    });
  }

  function renderBadge(el, state) {
    el.dataset.badgeState = state;
    el.className = 'editable ' + (state === 'past' ? 'badge-past' : 'badge-upcoming');
    el.innerHTML = state === 'past'
      ? '<i class="fa-solid fa-check" aria-hidden="true"></i> Realizado'
      : '<i class="fa-solid fa-circle-dot" aria-hidden="true"></i> Próximamente';
  }

  function enterTextEditMode(el) {
    if (el.querySelector('input, textarea')) return;
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
    content[id] = value;
    try {
      await persistContent();
      showToast('Cambio guardado, se publicará en un minuto');
    } catch (e) {
      showToast('No se pudo guardar: ' + e.message);
    }
  }

  /* ═══════════ VÍDEOS DE YOUTUBE ═══════════ */

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
    content[mediaId + '-youtube'] = videoId;
    try {
      await persistContent();
      el.dataset.youtubeId = videoId;
      el.classList.remove('media-empty');
      if (!manifest[mediaId]) renderYoutubeThumb(el, videoId);
      showToast('Vídeo actualizado, se publicará en un minuto');
    } catch (e) {
      showToast('No se pudo guardar: ' + e.message);
    }
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

  /* ═══════════ VISOR AMPLIADO (lightbox) — disponible para todo el mundo ═══════════ */

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

  function wireSlotBase(el) {
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
  slots.forEach(wireSlotBase);

  function wireSlotEdit(el) {
    el.classList.add('media-empty');
    el.addEventListener('dragenter', e => { e.preventDefault(); el.classList.add('media-dragover'); });
    el.addEventListener('dragover', e => { e.preventDefault(); });
    el.addEventListener('dragleave', () => el.classList.remove('media-dragover'));
    el.addEventListener('drop', e => {
      e.preventDefault();
      el.classList.remove('media-dragover');
      const file = e.dataTransfer.files && e.dataTransfer.files[0];
      if (!file) return;
      if (!file.type.startsWith('image/') && !file.type.startsWith('video/')) {
        showToast('Solo se admiten imágenes o vídeos');
        return;
      }
      commitDrop(el, file);
    });
  }

  /* ═══════════ GALERÍAS DINÁMICAS (botón "+ añadir foto") ═══════════ */

  function createGallerySlotEl(container, galleryId, suffix, variant) {
    const mediaId = galleryId + '-' + suffix;
    if (container.querySelector('[data-media-id="' + mediaId + '"]')) return;
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

    wireSlotBase(slotEl);
    slots.push(slotEl);
    wireGalleryRemove(removeBtn, slotEl, wrapper, galleryId, suffix);
    hydrateOneSlot(slotEl);
    if (editMode) wireSlotEdit(slotEl);
    return slotEl;
  }

  function wireGalleryRemove(btn, slotEl, wrapper, galleryId, suffix) {
    btn.addEventListener('click', async e => {
      e.preventDefault();
      e.stopPropagation();
      if (!confirm('¿Quitar esta foto de la galería?')) return;
      try {
        const mediaId = slotEl.dataset.mediaId;
        if (manifest[mediaId]) {
          try { await workerPost('/delete-file', { token, path: 'media/' + manifest[mediaId].file }); } catch { /* no existía */ }
          delete manifest[mediaId];
          await persistManifest();
        }
        const key = 'gallery:' + galleryId;
        const current = Array.isArray(content[key]) ? content[key] : [];
        const idx = current.indexOf(suffix);
        if (idx > -1) {
          current.splice(idx, 1);
          content[key] = current;
          await persistContent();
        }
        wrapper.remove();
        const i = slots.indexOf(slotEl);
        if (i > -1) slots.splice(i, 1);
        showToast('Foto quitada, se publicará en un minuto');
      } catch (err) {
        showToast('No se pudo quitar: ' + err.message);
      }
    });
  }

  async function addNewGallerySlot(container, galleryId, variant) {
    try {
      const suffix = 'extra-' + Date.now();
      const key = 'gallery:' + galleryId;
      const current = Array.isArray(content[key]) ? content[key].slice() : [];
      current.push(suffix);
      content[key] = current;
      await persistContent();
      createGallerySlotEl(container, galleryId, suffix, variant);
      showToast('Hueco añadido: arrastra una foto sobre él');
    } catch (e) {
      showToast('No se pudo añadir: ' + e.message);
    }
  }

  function initGalleriesStatic() {
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
    btn.addEventListener('click', () => {
      if (!editMode) return;
      const galleryId = container.dataset.galleryId;
      const variant = container.dataset.galleryVariant || 'grid';
      addNewGallerySlot(container, galleryId, variant);
    });
  });

  /* ═══════════ ACCESO: candado discreto + inicio de sesión + modo edición ═══════════ */

  function tokenExpired(tok) {
    try {
      const payload = JSON.parse(atob(tok.split('.')[0]));
      return !payload.exp || Date.now() > payload.exp;
    } catch {
      return true;
    }
  }

  // Candado discreto, inyectado en el pie de página
  const footerBottom = document.querySelector('.footer-bottom p') || document.querySelector('.footer-bottom');
  let lockBtn = null;
  let editPill = null;

  function buildLockUI() {
    if (!footerBottom) return;
    lockBtn = document.createElement('button');
    lockBtn.type = 'button';
    lockBtn.className = 'coral-access-lock';
    lockBtn.setAttribute('aria-label', 'Acceder al modo edición');
    lockBtn.innerHTML = '<i class="fa-solid fa-lock" aria-hidden="true"></i>';
    lockBtn.addEventListener('click', openLoginModal);
    footerBottom.appendChild(lockBtn);

    editPill = document.createElement('div');
    editPill.className = 'coral-edit-pill';
    editPill.innerHTML = '<i class="fa-solid fa-pen" aria-hidden="true"></i> Modo edición <button type="button" class="coral-edit-logout">Salir</button>';
    document.body.appendChild(editPill);
    editPill.querySelector('.coral-edit-logout').addEventListener('click', logout);
  }

  function logout() {
    localStorage.removeItem(TOKEN_KEY);
    location.reload();
  }

  /* Modal de inicio de sesión */
  const loginModal = document.createElement('div');
  loginModal.className = 'media-modal';
  loginModal.innerHTML =
    '<div class="media-modal-backdrop"></div>' +
    '<div class="media-modal-card">' +
      '<h3>Acceder</h3>' +
      '<p>Inicia sesión para editar la web.</p>' +
      '<input type="text" class="media-modal-input" placeholder="Usuario" autocomplete="username">' +
      '<input type="password" class="media-modal-input" placeholder="Contraseña" autocomplete="current-password">' +
      '<p class="coral-login-error" hidden></p>' +
      '<div class="media-modal-actions">' +
        '<button type="button" class="btn btn-outline media-modal-cancel">Cancelar</button>' +
        '<button type="button" class="btn btn-primary media-modal-save">Entrar</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(loginModal);
  const userInput = loginModal.querySelectorAll('.media-modal-input')[0];
  const passInput = loginModal.querySelectorAll('.media-modal-input')[1];
  const loginError = loginModal.querySelector('.coral-login-error');

  function openLoginModal() {
    userInput.value = '';
    passInput.value = '';
    loginError.hidden = true;
    loginModal.classList.add('open');
    setTimeout(() => userInput.focus(), 50);
  }
  function closeLoginModal() { loginModal.classList.remove('open'); }

  loginModal.querySelector('.media-modal-backdrop').addEventListener('click', closeLoginModal);
  loginModal.querySelector('.media-modal-cancel').addEventListener('click', closeLoginModal);

  async function attemptLogin() {
    const user = userInput.value.trim();
    const pass = passInput.value;
    if (!user || !pass) return;
    try {
      const data = await workerPost('/login', { user, pass });
      token = data.token;
      localStorage.setItem(TOKEN_KEY, token);
      closeLoginModal();
      enableEditMode();
      showToast('Sesión iniciada');
    } catch (e) {
      loginError.textContent = e.message || 'Usuario o contraseña incorrectos';
      loginError.hidden = false;
    }
  }
  loginModal.querySelector('.media-modal-save').addEventListener('click', attemptLogin);
  passInput.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); attemptLogin(); } });
  userInput.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); passInput.focus(); } });

  function enableEditMode() {
    editMode = true;
    document.body.classList.add('coral-edit-mode');
    if (lockBtn) lockBtn.hidden = true;
    if (editPill) editPill.classList.add('show');

    slots.forEach(wireSlotEdit);
    editables.forEach(el => {
      if (el.dataset.editType === 'badge') {
        el.addEventListener('click', () => {
          const next = el.dataset.badgeState === 'past' ? 'upcoming' : 'past';
          renderBadge(el, next);
          saveContent(el.dataset.editId, next);
        });
      } else {
        el.addEventListener('dblclick', () => enterTextEditMode(el));
      }
    });
    ytEditButtons.forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        e.preventDefault();
        const targetEl = document.querySelector('.img-ph[data-media-id="' + btn.dataset.youtubeEditId + '"]');
        if (targetEl) openYtModal(targetEl);
      });
    });
  }

  /* ═══════════ Arranque ═══════════ */

  (async function init() {
    await loadPublicData();
    buildLockUI();
    if (token && !tokenExpired(token)) {
      enableEditMode();
    } else if (token) {
      localStorage.removeItem(TOKEN_KEY);
      token = null;
    }
  })();

})();
