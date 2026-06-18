/* ═══════════════════════════════════════════════════════════
   CORAL MIGUEL DE AMBIELA — Global JS
   ═══════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  /* ── Page entrance ─────────────────────────────────────── */
  const wrapper = document.querySelector('.page-wrapper');
  if (wrapper) {
    requestAnimationFrame(() => {
      setTimeout(() => wrapper.classList.add('is-visible'), 30);
    });
  }

  /* ── Navigation ────────────────────────────────────────── */
  const nav = document.querySelector('.site-nav');
  const toggle = document.querySelector('.nav-toggle');
  const links = document.querySelector('.nav-links');

  // Solid on scroll
  function updateNav() {
    nav.classList.toggle('nav-solid', window.scrollY > 40);
  }
  updateNav();
  window.addEventListener('scroll', updateNav, { passive: true });

  // Mobile toggle
  if (toggle && links) {
    toggle.addEventListener('click', () => {
      const open = links.classList.toggle('mobile-open');
      toggle.classList.toggle('open', open);
      toggle.setAttribute('aria-expanded', String(open));
    });
    // Close on link click
    links.querySelectorAll('a').forEach(a => {
      a.addEventListener('click', () => {
        links.classList.remove('mobile-open');
        toggle.classList.remove('open');
        toggle.setAttribute('aria-expanded', 'false');
      });
    });
    // Close on outside click
    document.addEventListener('click', e => {
      if (!nav.contains(e.target)) {
        links.classList.remove('mobile-open');
        toggle.classList.remove('open');
        toggle.setAttribute('aria-expanded', 'false');
      }
    });
  }

  // Active link highlighting
  const currentFile = location.pathname.split('/').pop() || 'index.html';
  document.querySelectorAll('.nav-links a').forEach(a => {
    const href = a.getAttribute('href');
    if (href === currentFile || (currentFile === '' && href === 'index.html')) {
      a.classList.add('active');
    }
  });

  /* ── Scroll reveals ────────────────────────────────────── */
  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver(entries => {
      entries.forEach(e => {
        if (e.isIntersecting) {
          e.target.classList.add('revealed');
          observer.unobserve(e.target);
        }
      });
    }, { threshold: 0.12 });
    document.querySelectorAll('.reveal').forEach(el => observer.observe(el));
  } else {
    document.querySelectorAll('.reveal').forEach(el => el.classList.add('revealed'));
  }

  /* ── Back to top ───────────────────────────────────────── */
  const backTop = document.querySelector('.back-top');
  if (backTop) {
    window.addEventListener('scroll', () => {
      backTop.classList.toggle('visible', window.scrollY > 500);
    }, { passive: true });
    backTop.addEventListener('click', () => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

  /* ── Page-link transitions ─────────────────────────────── */
  document.querySelectorAll('a[href]').forEach(a => {
    const href = a.getAttribute('href');
    if (
      href.startsWith('#') ||
      href.startsWith('http') ||
      href.startsWith('mailto') ||
      href.startsWith('tel') ||
      a.target === '_blank'
    ) return;

    a.addEventListener('click', e => {
      e.preventDefault();
      if (wrapper) {
        wrapper.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
        wrapper.style.opacity = '0';
        wrapper.style.transform = 'translateY(-10px)';
        setTimeout(() => { location.href = href; }, 300);
      } else {
        location.href = href;
      }
    });
  });

  /* ── Año de copyright automático ───────────────────────── */
  document.querySelectorAll('.copyright-year').forEach(el => {
    el.textContent = String(new Date().getFullYear());
  });

})();
