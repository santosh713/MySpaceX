// public/public/assets/js/main.js
(async function () {
  try {
    // 1) Inject partials (paths are relative to your HTML files in /public)
    const [nav, foot] = await Promise.all([
      fetch('public/partials/navbar.html', { cache: 'no-store' }).then(r => r.text()),
      fetch('public/partials/footer.html', { cache: 'no-store' }).then(r => r.text()),
    ]);

    const navHost = document.getElementById('navbar');
    const footHost = document.getElementById('footer');

    if (!navHost) console.warn('[main.js] #navbar host not found');
    if (!footHost) console.warn('[main.js] #footer host not found');

    if (navHost) navHost.innerHTML = nav;
    if (footHost) footHost.innerHTML = foot;

    // 2) Wire hamburger AFTER injection
    function wireMenu(root = document) {
      const btn =
        root.querySelector('#mobile-menu-button') ||
        root.querySelector('[data-button="mobile-menu"]');

      const menu =
        root.querySelector('#mobile-menu') ||
        root.querySelector('#menuMobile') ||
        root.querySelector('#menu');

      if (!btn || !menu) {
        console.warn('[main.js] hamburger elements missing', { btn: !!btn, menu: !!menu });
        return;
      }

      // Ensure nav is above page content
      const navEl = root.querySelector('nav');
      if (navEl) navEl.classList.add('relative', 'z-50');

      const toggle = () => {
        const isHidden = menu.classList.toggle('hidden');
        btn.setAttribute('aria-expanded', String(!isHidden));
      };

      // Avoid duplicate listeners
      btn.removeEventListener('click', toggle);
      document.removeEventListener('click', docHandler);
      document.removeEventListener('keydown', keyHandler);

      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggle();
      });

      function docHandler(e) {
        if (!menu.contains(e.target) && !btn.contains(e.target)) {
          if (!menu.classList.contains('hidden')) toggle();
        }
      }
      function keyHandler(e) {
        if (e.key === 'Escape' && !menu.classList.contains('hidden')) toggle();
        if ((e.key === 'Enter' || e.key === ' ') && document.activeElement === btn) {
          e.preventDefault();
          toggle();
        }
      }
      document.addEventListener('click', docHandler);
      document.addEventListener('keydown', keyHandler);

      console.log('[main.js] hamburger wired');
    }

    wireMenu(navHost || document);

    // 3) Active link highlight (optional)
    const file = (location.pathname.split('/').pop() || 'index.html').toLowerCase();
    const key = file.includes('index') ? 'home'
             : file.includes('hours') ? 'hours'
             : file.includes('paycalculator') ? 'paycalculator'
             : '';
    if (key) {
      document.querySelectorAll(`[data-nav="${key}"]`)
        .forEach(a => a.classList.add('underline', 'font-semibold'));
    }

    // Footer year (optional)
    const y = document.getElementById('year');
    if (y) y.textContent = `© ${new Date().getFullYear()} MySpaceX. All rights reserved.`;

  } catch (e) {
    console.error('[main.js] Failed to inject shared partials', e);
  }
})();
