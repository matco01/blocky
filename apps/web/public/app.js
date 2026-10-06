/*
 * The website's behaviour: the chat demo, Blocky's blinks, sections easing in
 * as they scroll into view, and the waitlist. Plain DOM, no dependencies.
 * Everything degrades: without this file the page still reads top to bottom,
 * and the forms just don't submit.
 */
(function () {
  'use strict';

  var API = (window.BLOCKY_API || '').replace(/\/+$/, '');
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* --- Nav ----------------------------------------------------------------- */

  var nav = document.getElementById('nav');
  function onScroll() { nav.classList.toggle('is-scrolled', window.scrollY > 8); }
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  var year = document.querySelector('[data-year]');
  if (year) year.textContent = String(new Date().getFullYear());

  /* --- Reveal on scroll ---------------------------------------------------- */

  // Big numbers in the feature cards count up from zero as they arrive.
  function countUp(root) {
    root.querySelectorAll('[data-count]').forEach(function (node) {
      var to = Number(node.dataset.count);
      var start = null;
      var ms = 1100;
      node.textContent = '0';
      function step(now) {
        if (start === null) start = now;
        var t = Math.min(1, (now - start) / ms);
        node.textContent = String(Math.round(to * (1 - Math.pow(1 - t, 3))));
        if (t < 1) window.requestAnimationFrame(step);
      }
      window.setTimeout(function () { window.requestAnimationFrame(step); }, 250);
    });
  }

  var reveals = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window && !reduced) {
    var revealer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-in');
          countUp(entry.target);
          revealer.unobserve(entry.target);
        }
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.12 });
    reveals.forEach(function (node) { revealer.observe(node); });
  } else {
    reveals.forEach(function (node) { node.classList.add('is-in'); });
  }

  /* --- Mascot -------------------------------------------------------------- */

  // Every pose is on the page up front and only its opacity changes, so a
  // blink never waits on an image decode.
  function Mascot(root) {
    var poses = {};
    root.querySelectorAll('[data-pose]').forEach(function (img) { poses[img.dataset.pose] = img; });
    var base = root.dataset.poseBase || 'neutral';
    var timer = null;

    function show(name) {
      if (!poses[name]) return;
      Object.keys(poses).forEach(function (key) { poses[key].classList.toggle('is-on', key === name); });
    }
    function later(ms, fn) { timer = window.setTimeout(fn, ms); }

    function schedule() {
      later(2200 + Math.random() * 2800, function () {
        // Now and then a glance at the chat, otherwise a blink.
        if (poses.left && Math.random() < 0.35) {
          show(Math.random() < 0.5 ? 'left' : 'right');
          later(1400, function () { show(base); schedule(); });
        } else {
          show('closed');
          later(240, function () { show(base); schedule(); });
        }
      });
    }

    return {
      show: show,
      idle: function () {
        window.clearTimeout(timer);
        show(base);
        root.classList.add('is-idle');
        if (!reduced) schedule();
      },
      cheer: function () {
        window.clearTimeout(timer);
        if (poses.happy) { base = 'happy'; show('happy'); }
        root.classList.remove('is-cheering');
        void root.offsetWidth;
        root.classList.add('is-cheering');
        window.setTimeout(function () { root.classList.remove('is-cheering'); if (!reduced) schedule(); }, 1100);
      },
      // A beat of delight, then back to normal: a card landing in the demo.
      flash: function (name, ms) {
        window.clearTimeout(timer);
        show(name);
        later(ms, function () { show(base); if (!reduced) schedule(); });
      },
    };
  }

  var mascots = Array.prototype.map.call(document.querySelectorAll('[data-mascot]'), function (node) {
    var m = Mascot(node);
    if (node.hasAttribute('data-intro') && !reduced) intro(node, m);
    else m.idle();
    return m;
  });

  // The hero's intro, on the CSS timeline: asleep while he falls, awake once
  // he lands, a look around, a happy hop, then ordinary idle blinking.
  function intro(node, m) {
    var beats = [
      [1150, function () { m.show('neutral'); }],
      [1400, function () { m.show('left'); }],
      [1650, function () { m.show('right'); }],
      [1900, function () { m.show('happy'); node.classList.add('is-landed', 'is-hopping'); }],
      [2400, function () { node.classList.remove('is-hopping'); }],
      [2900, function () { m.idle(); }],
    ];
    beats.forEach(function (beat) { window.setTimeout(beat[1], beat[0]); });
  }
  
  /* --- Chat demo ----------------------------------------------------------- */

  var FINGERPRINT =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3c-4 0-7 3-7 7v2M19 12v-2a7 7 0 0 0-3-5.7M9 21c-.6-1.8-1-3.8-1-6v-3a4 4 0 0 1 8 0v1M12 12v3c0 2.4.5 4.6 1.4 6.5M16 16.5c0 1.3.2 2.6.5 3.8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
  var CHECK =
    '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  // Each scenario is something the app really does today, said the way Blocky says it.
  var SCENARIOS = [
    {
      user: 'Send Sam $20',
      bot: 'Here’s your send to Sam.',
      card: {
        title: 'Send $20.00',
        rows: [['To', 'Sam · @sam'], ['Network fee', '$0.01'], ['Arrives', 'In seconds']],
        done: 'Sent to Sam',
      },
    },
    {
      user: 'What did I spend this month?',
      bot: '<strong>$412.80</strong> so far, $64 less than last month. Most of it went on food: $168.',
    },
    {
      user: 'Save $200 for a trip',
      bot: 'Done. Your <strong>Trip</strong> pot has $200 set aside. Want me to add 10% of everything you get paid?',
    },
    {
      user: 'Split $90 dinner with Maya and Leo',
      bot: 'Asked <strong>@maya</strong> and <strong>@leo</strong> for $30 each. I’ll tell you when they pay.',
    },
    {
      user: 'Buy $50 of Apple',
      bot: 'Here’s your Apple buy. The price is checked again right before it goes through.',
      card: {
        title: 'Buy $50.00 of Apple',
        rows: [['You get', '≈ 0.218 AAPL'], ['Fee', '$0.31'], ['Arrives', 'In about a minute']],
        done: 'Apple added to your portfolio',
      },
    },
  ];

  var chat = document.querySelector('[data-chat]');
  var chips = Array.prototype.slice.call(document.querySelectorAll('[data-demo]'));
  var demoTimers = [];
  var current = 0;
  var autoplay = true;

  function el(tag, cls, html) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (html != null) node.innerHTML = html;
    return node;
  }

  function at(ms, fn) { demoTimers.push(window.setTimeout(fn, reduced ? 0 : ms)); }

  function botLine(html) {
    var row = el('div', 'msg msg-bot');
    var face = el('img');
    face.src = '/img/neutral.webp';
    face.alt = '';
    row.appendChild(face);
    row.appendChild(el('p', null, html));
    return row;
  }

  function play(index) {
    demoTimers.forEach(window.clearTimeout);
    demoTimers = [];
    current = index;
    chips.forEach(function (chip, i) {
      chip.classList.toggle('is-active', i === index);
      chip.setAttribute('aria-selected', i === index ? 'true' : 'false');
    });

    var s = SCENARIOS[index];
    chat.innerHTML = '';
    chat.appendChild(el('div', 'msg msg-user', s.user));

    var typing = botLine('<span class="typing"><i></i><i></i><i></i></span>');
    at(450, function () { chat.appendChild(typing); });
    at(1500, function () {
      typing.remove();
      chat.appendChild(botLine(s.bot));
    });

    if (s.card) {
      var card = el('div', 'card');
      card.appendChild(el('div', 'card-title', s.card.title));
      s.card.rows.forEach(function (r) {
        var row = el('div', 'card-row');
        row.appendChild(el('span', null, r[0]));
        var b = el('b');
        b.textContent = r[1];
        row.appendChild(b);
        card.appendChild(row);
      });
      var approve = el('span', 'block', FINGERPRINT + '<span>Approve</span>');
      card.appendChild(approve);

      at(1900, function () { chat.appendChild(card); });
      at(3300, function () { approve.classList.add('is-pressed'); });
      at(3600, function () {
        approve.remove();
        card.classList.add('is-done');
        card.appendChild(el('div', 'card-done', CHECK + '<span>' + s.card.done + '</span>'));
      });
    }

    if (autoplay && !reduced) at(s.card ? 6400 : 5000, function () { play((current + 1) % SCENARIOS.length); });
  }

  chips.forEach(function (chip, i) {
    chip.addEventListener('click', function () {
      autoplay = false;
      play(i);
    });
  });

  if (chat) {
    // Start when it's on screen, so the first thing anyone sees is the start.
    if ('IntersectionObserver' in window) {
      var seen = false;
      new IntersectionObserver(function (entries, observer) {
        if (!seen && entries[0].isIntersecting) {
          seen = true;
          observer.disconnect();
          play(0);
        }
      }, { threshold: 0.35 }).observe(chat);
    } else {
      play(0);
    }
  }

  /* --- Waitlist ------------------------------------------------------------ */

  var EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  document.querySelectorAll('[data-scroll-to-form]').forEach(function (link) {
    link.addEventListener('click', function (event) {
      event.preventDefault();
      var form = document.getElementById('join');
      form.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'center' });
      window.setTimeout(function () { form.querySelector('input[type="email"]').focus({ preventScroll: true }); }, reduced ? 0 : 450);
    });
  });

  function ordinal(n) {
    return '#' + Number(n).toLocaleString('en-US');
  }

  function joined(form, result) {
    var place = result && result.position ? ordinal(result.position) : null;
    var title = result && result.alreadyJoined ? 'You’re already on the list' : 'You’re on the list!';
    var detail = place
      ? 'You’re ' + place + '. We’ll email you when your spot opens.'
      : 'We’ll email you when your spot opens.';

    var box = el('div', 'joined');
    box.appendChild(el('span', 'joined-badge', CHECK));
    var text = el('div');
    var strong = el('strong');
    strong.textContent = title;
    var span = el('span');
    span.textContent = detail;
    text.appendChild(strong);
    text.appendChild(span);
    box.appendChild(text);

    // Every form on the page agrees: you're in.
    document.querySelectorAll('[data-waitlist]').forEach(function (other) {
      if (other.classList.contains('is-done')) return;
      other.classList.add('is-done');
      other.insertBefore(other === form ? box : box.cloneNode(true), other.querySelector('.form-note'));
      other.querySelector('.form-note').textContent = '';
    });

    mascots.forEach(function (m) { m.cheer(); });
  }

  document.querySelectorAll('[data-waitlist]').forEach(function (form) {
    var input = form.querySelector('input[type="email"]');
    var button = form.querySelector('button');
    var note = form.querySelector('.form-note');
    var defaultNote = note.textContent;
    var label = button.querySelector('span');
    var defaultLabel = label.textContent;

    function error(message) {
      note.textContent = message;
      note.classList.add('is-error');
      input.focus();
    }

    input.addEventListener('input', function () {
      if (note.classList.contains('is-error')) {
        note.classList.remove('is-error');
        note.textContent = defaultNote;
      }
    });

    form.addEventListener('submit', function (event) {
      event.preventDefault();
      var email = input.value.trim();
      if (!EMAIL.test(email)) return error('That doesn’t look like an email address.');

      button.disabled = true;
      label.textContent = 'Joining…';

      fetch(API + '/waitlist', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: email,
          source: form.dataset.source || 'web',
          website: form.querySelector('[name="website"]').value,
        }),
      })
        .then(function (response) {
          return response.json().catch(function () { return null; }).then(function (body) {
            if (response.ok && body && body.ok) return joined(form, body);
            // Only the API's own messages are worth showing; anything else
            // came from something in between.
            var message = body && body.error && body.message ? body.message : 'Something went wrong on our side. Try again in a moment.';
            error(message);
          });
        })
        .catch(function () {
          error('Can’t reach Blocky right now. Check your connection and try again.');
        })
        .then(function () {
          button.disabled = false;
          label.textContent = defaultLabel;
        });
    });
  });
})();
