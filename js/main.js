/* ============================================================
   mypropfolio - Shared JavaScript
   - Sticky nav on scroll
   - Intersection Observer scroll reveals
   - Problem points reveal
   - Mobile menu
   - Filter tabs (templates page)
   - Pricing toggle
   - FAQ accordion
   ============================================================ */

(function () {
  'use strict';

  /* ── Nav scroll behaviour ─────────────────────────────────── */
  const nav = document.querySelector('.site-nav');
  if (nav) {
    const onScroll = () => {
      if (window.scrollY > 60) {
        nav.classList.add('scrolled');
      } else {
        nav.classList.remove('scrolled');
      }
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  /* ── Mobile menu ─────────────────────────────────────────── */
  const hamburger = document.querySelector('.nav-hamburger');
  const mobileOverlay = document.querySelector('.nav-mobile-overlay');

  if (hamburger && mobileOverlay) {
    hamburger.addEventListener('click', () => {
      const isOpen = hamburger.classList.toggle('open');
      mobileOverlay.classList.toggle('open', isOpen);
      document.body.style.overflow = isOpen ? 'hidden' : '';
    });

    mobileOverlay.querySelectorAll('a').forEach(link => {
      link.addEventListener('click', () => {
        hamburger.classList.remove('open');
        mobileOverlay.classList.remove('open');
        document.body.style.overflow = '';
      });
    });
  }

  /* ── Scroll reveal (Intersection Observer) ────────────────── */
  const revealEls = document.querySelectorAll('.reveal');
  if (revealEls.length) {
    const revealObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            entry.target.classList.add('visible');
            revealObserver.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: '0px 0px -48px 0px' }
    );
    revealEls.forEach(el => revealObserver.observe(el));
  }

  /* ── Problem points reveal (dark section) ─────────────────── */
  const problemPoints = document.querySelectorAll('.problem-point');
  if (problemPoints.length) {
    const pointObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            entry.target.classList.add('visible-point');
          } else {
            entry.target.classList.remove('visible-point');
          }
        });
      },
      { threshold: 0.5 }
    );
    problemPoints.forEach(point => pointObserver.observe(point));
  }

  /* ── Filter tabs (templates page) ────────────────────────── */
  const filterTabs = document.querySelectorAll('.filter-tab');
  const filterCards = document.querySelectorAll('.property-card[data-type]');

  if (filterTabs.length && filterCards.length) {
    filterTabs.forEach(tab => {
      tab.addEventListener('click', () => {
        filterTabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');

        const filter = tab.dataset.filter;
        filterCards.forEach(card => {
          if (filter === 'all' || card.dataset.type === filter) {
            card.style.display = 'flex';
          } else {
            card.style.display = 'none';
          }
        });
      });
    });
  }

  /* ── Pricing toggle ──────────────────────────────────────── */
  const toggleBtns = document.querySelectorAll('.pricing-toggle button');
  const agentPanel = document.getElementById('agent-pricing');
  const agencyPanel = document.getElementById('agency-pricing');

  if (toggleBtns.length) {
    // Set explicit initial state on load
    if (agentPanel)  agentPanel.style.display = 'block';
    if (agencyPanel) agencyPanel.classList.remove('visible');

    toggleBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        toggleBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        const target = btn.dataset.target;
        if (agentPanel)  agentPanel.style.display  = target === 'agent'  ? 'block' : 'none';
        if (agencyPanel) agencyPanel.classList.toggle('visible', target === 'agency');
      });
    });
  }

  /* ── FAQ accordion ───────────────────────────────────────── */
  const faqItems = document.querySelectorAll('.faq-item');
  if (faqItems.length) {
    faqItems.forEach(item => {
      const question = item.querySelector('.faq-question');
      const answer = item.querySelector('.faq-answer');
      const answerInner = item.querySelector('.faq-answer-inner');

      if (!question || !answer || !answerInner) return;

      question.addEventListener('click', () => {
        const isOpen = item.classList.contains('open');

        // Close all
        faqItems.forEach(i => {
          i.classList.remove('open');
          const a = i.querySelector('.faq-answer');
          if (a) a.style.maxHeight = '0';
        });

        // Open clicked if it was closed
        if (!isOpen) {
          item.classList.add('open');
          answer.style.maxHeight = answerInner.scrollHeight + 'px';
        }
      });
    });
  }

  /* ── Active nav link ─────────────────────────────────────── */
  const currentPath = window.location.pathname.split('/').pop() || 'index.html';
  document.querySelectorAll('.nav-links a, .nav-mobile-overlay a').forEach(link => {
    const href = link.getAttribute('href');
    if (href && (href === currentPath || (currentPath === '' && href === 'index.html'))) {
      link.classList.add('active');
    }
  });

  /* ── Scroll-triggered background colour (newgenre style) ──── */
  (function () {
    const bgEls = document.querySelectorAll('[data-bg]');
    if (!bgEls.length) return;

    // Set initial bg from first section
    var firstBg = document.querySelector('[data-bg]');
    if (firstBg) document.body.style.backgroundColor = firstBg.dataset.bg;

    var bgObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        var colour = entry.target.dataset.bg;
        document.body.style.backgroundColor = colour;
      });
    }, {
      threshold: 0,
      rootMargin: '-40% 0px -40% 0px'  // fires when section occupies the middle 20% of viewport
    });

    bgEls.forEach(function (el) { bgObserver.observe(el); });
  })();

  /* ── 3D Tilt cards ───────────────────────────────────────── */
  (function () {
    var cards = document.querySelectorAll('[data-tilt]');
    if (!cards.length) return;

    cards.forEach(function (card) {
      card.addEventListener('mousemove', function (e) {
        var rect = card.getBoundingClientRect();
        var x = e.clientX - rect.left;
        var y = e.clientY - rect.top;
        var cx = rect.width / 2;
        var cy = rect.height / 2;
        var rotateX = ((y - cy) / cy) * -7;
        var rotateY = ((x - cx) / cx) * 7;
        card.style.transform =
          'perspective(1000px) rotateX(' + rotateX + 'deg) rotateY(' + rotateY + 'deg) scale3d(1.04,1.04,1.04)';
        card.style.transition = 'transform 0.1s ease-out';
      });

      card.addEventListener('mouseleave', function () {
        card.style.transform =
          'perspective(1000px) rotateX(0deg) rotateY(0deg) scale3d(1,1,1)';
        card.style.transition = 'transform 0.5s cubic-bezier(0.16,1,0.3,1)';
      });
    });
  })();

  /* ── Gallery Carousel ───────────────────────────────────────── */
  (function () {
    var track = document.getElementById('galleryTrack');
    if (!track) return;

    var prevBtn = document.querySelector('.gallery-prev');
    var nextBtn = document.querySelector('.gallery-next');

    function cardStep() {
      var card = track.querySelector('.gallery-card');
      return card ? card.offsetWidth + 20 : 460;
    }

    function updateButtons() {
      if (!prevBtn || !nextBtn) return;
      prevBtn.disabled = track.scrollLeft <= 2;
      nextBtn.disabled = track.scrollLeft + track.offsetWidth >= track.scrollWidth - 2;
    }

    /* Arrow buttons */
    if (prevBtn) {
      prevBtn.addEventListener('click', function () {
        track.scrollLeft -= cardStep();
        setTimeout(updateButtons, 50);
      });
    }
    if (nextBtn) {
      nextBtn.addEventListener('click', function () {
        track.scrollLeft += cardStep();
        setTimeout(updateButtons, 50);
      });
    }

    /* Desktop only: click-and-drag to scroll.
       Mobile/touch is handled entirely by native overflow scrolling (no touch JS),
       so finger drag, link taps, and vertical page scroll all work without interference. */
    var dragging = false;
    var moved = false;
    var startX = 0;
    var startScroll = 0;

    track.addEventListener('pointerdown', function (e) {
      if (e.pointerType !== 'mouse') return; // touch/pen scroll natively
      dragging = true;
      moved = false;
      startX = e.clientX;
      startScroll = track.scrollLeft;
      track.style.cursor = 'grabbing';
      track.setPointerCapture(e.pointerId);
      e.preventDefault(); // block text/image selection during drag
    });
    track.addEventListener('pointermove', function (e) {
      if (!dragging) return;
      var dx = e.clientX - startX;
      if (Math.abs(dx) > 3) moved = true;
      track.scrollLeft = startScroll - dx;
      updateButtons();
    });
    function endDrag() {
      if (!dragging) return;
      dragging = false;
      track.style.cursor = 'grab';
    }
    track.addEventListener('pointerup', endDrag);
    track.addEventListener('pointercancel', endDrag);

    // Swallow the click that follows a drag so the card link doesn't navigate
    track.addEventListener('click', function (e) {
      if (moved) {
        e.preventDefault();
        e.stopPropagation();
        moved = false;
      }
    }, true);

    track.addEventListener('scroll', updateButtons, { passive: true });
    window.addEventListener('load', updateButtons);
    setTimeout(updateButtons, 300);
  })();

  /* ── Line reveal (newgenre text animation) ────────────────── */
  (function () {
    var lineWrappers = document.querySelectorAll('.line-reveal');
    if (!lineWrappers.length) return;

    var lineObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
          lineObserver.unobserve(entry.target);
        }
      });
    }, { threshold: 0.2 });

    lineWrappers.forEach(function (el) { lineObserver.observe(el); });
  })();

})();
