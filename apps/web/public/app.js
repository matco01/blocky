/*
 * The website's behaviour: Blocky's poses, the chat demo, and the waitlist.
 * Plain DOM, no dependencies. Everything degrades: without this file the page
 * still reads top to bottom, and the forms just don't submit.
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

  // The bar's wordmark appears once the hero's own wordmark is out of sight.
  var heroStage = document.querySelector('.hero-stage');
  if (heroStage && 'IntersectionObserver' in window) {
    new IntersectionObserver(function (entries) {
      nav.classList.toggle('show-brand', !entries[0].isIntersecting);
    }, { rootMargin: '-' + nav.offsetHeight + 'px 0px 0px 0px' }).observe(heroStage);
  } else {
    nav.classList.add('show-brand');
  }

  var year = document.querySelector('[data-year]');
  if (year) year.textContent = String(new Date().getFullYear());

  /* --- Mascot -------------------------------------------------------------- */

  /*
   * The same idea as the app's <Mascot>: every pose is on the page up front
   * and only its opacity changes, so a blink never waits on an image decode.
   * A glance steps through the three turn frames (mirrored for the other way).
   */
  function Mascot(root) {
    var poses = {};
    root.querySelectorAll('[data-pose]').forEach(function (img) { poses[img.dataset.pose] = img; });
    var base = root.dataset.poseBase || 'neutral';
    var timer = null;

    var current = root.querySelector('.pose.is-on');
    var order = Array.prototype.slice.call(root.querySelectorAll('[data-pose]'));

    function setOn(img, on, mirrored) {
      img.classList.toggle('is-on', on);
      if (on) img.classList.toggle('is-mirrored', !!mirrored);
    }

    // The glance frames are drawn rounder than the standing pose, so a hard
    // swap between them reads as a snap: anything into or out of a turn frame
    // crossfades. Blinks and the intro's poses stay hard cuts.
    function show(name, mirrored) {
      var next = poses[name];
      if (!next) return;
      var prev = current;
      current = next;
      if (prev === next) return setOn(next, true, mirrored);

      var turn = function (img) { return img && /^turn/.test(img.dataset.pose); };
      var fade = !reduced && prev && (turn(prev) || turn(next)) ? (turn(prev) && turn(next) ? 70 : 160) : 0;

      Object.keys(poses).forEach(function (key) {
        var img = poses[key];
        if (img !== prev && img !== next) { img.style.transition = 'none'; setOn(img, false); }
      });
      if (!fade || !prev) {
        prev && (prev.style.transition = 'none', setOn(prev, false));
        next.style.transition = 'none';
        return setOn(next, true, mirrored);
      }
      if (order.indexOf(next) > order.indexOf(prev)) {
        // On top: fade the new frame in over the old, then drop the old.
        next.style.transition = 'opacity ' + fade + 'ms linear';
        setOn(next, true, mirrored);
        window.setTimeout(function () {
          if (current !== prev) { prev.style.transition = 'none'; setOn(prev, false); }
        }, fade);
      } else {
        // Underneath: show the new frame, and fade the old one off it.
        next.style.transition = 'none';
        setOn(next, true, mirrored);
        prev.style.transition = 'opacity ' + fade + 'ms linear';
        prev.classList.remove('is-on');
      }
    }

    function later(ms, fn) { timer = window.setTimeout(fn, ms); }

    function run(frames, then) {
      if (!frames.length) return then();
      var frame = frames[0];
      show(frame[0], frame[1]);
      // A frame that crossfaded in (frame[2]) holds until its fade is done.
      later(frame[2] || 90, function () { run(frames.slice(1), then); });
    }

    function schedule() {
      later(2400 + Math.random() * 2600, function () {
        if (base === 'neutral' && poses.turn1 && Math.random() < 0.3) {
          var m = Math.random() < 0.5;
          run([['turn1', m, 160], ['turn2', m], ['turn3', m]], function () {
            later(1800, function () { run([['turn2', m], ['turn1', m], [base]], schedule); });
          });
        } else {
          show('closed');
          later(260, function () { show(base); schedule(); });
        }
      });
    }

    return {
      show: show,
      idle: function () {
        window.clearTimeout(timer);
        show(base);
        root.classList.add('is-idle');
        schedule();
      },
      cheer: function () {
        window.clearTimeout(timer);
        if (poses.happy) show('happy');
        root.classList.remove('is-idle');
        root.classList.remove('is-cheering');
        void root.offsetWidth;
        root.classList.add('is-cheering');
        window.setTimeout(function () {
          root.classList.remove('is-cheering');
          base = poses.happy ? 'happy' : base;
          root.classList.add('is-idle');
          schedule();
        }, 1100);
      },
    };
  }

  var hero = document.querySelector('.mascot-hero');
  var heroMascot = hero ? Mascot(hero) : null;
  var finalEl = document.querySelector('.mascot-final');
  var finalMascot = finalEl ? Mascot(finalEl) : null;

  // The intro's poses, on the CSS timeline: asleep while he falls, awake once
  // he lands, a look around, a happy hop, then ordinary idle blinking.
  if (heroMascot) {
    if (reduced) {
      heroMascot.idle();
    } else {
      var beats = [
        [1100, function () { heroMascot.show('neutral'); }],
        [1300, function () { heroMascot.show('left'); }],
        [1550, function () { heroMascot.show('right'); }],
        [1800, function () { heroMascot.show('happy'); }],
        [2650, function () { heroMascot.idle(); }],
      ];
      beats.forEach(function (beat) { window.setTimeout(beat[1], beat[0]); });
    }
  }
  if (finalMascot) finalMascot.idle();

  /* --- Chat demo ----------------------------------------------------------- */

  var FINGERPRINT =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3c-4 0-7 3-7 7v2M19 12v-2a7 7 0 0 0-3-5.7M9 21c-.6-1.8-1-3.8-1-6v-3a4 4 0 0 1 8 0v1M12 12v3c0 2.4.5 4.6 1.4 6.5M16 16.5c0 1.3.2 2.6.5 3.8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
  var CHECK =
    '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  // Each scenario is what the app really does today, said the way Blocky says it.
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
      user: 'How much did I spend this month?',
      bot: '<strong>$412.80</strong> so far — $64 less than last month. Most of it went to Sam: $120.',
    },
    {
      user: 'Save $50 a month for a trip',
      bot: 'Your <strong>Trip</strong> pot is ready. $50 goes in on the 1st of every month. Rooting for you.',
    },
    {
      user: 'Split $90 dinner with Maya and Leo',
      bot: 'Asked <strong>@maya</strong> and <strong>@leo</strong> for $30 each. You’ll get a ping when they pay.',
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

    if (autoplay && !reduced) at(s.card ? 6200 : 4800, function () { play((current + 1) % SCENARIOS.length); });
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

    form.classList.add('is-done');
    var note = form.querySelector('.form-note');
    note.textContent = '';
    form.insertBefore(box, note);

    // Every form on the page agrees: you're in.
    document.querySelectorAll('[data-waitlist]').forEach(function (other) {
      if (other !== form && !other.classList.contains('is-done')) {
        other.classList.add('is-done');
        other.insertBefore(box.cloneNode(true), other.querySelector('.form-note'));
        other.querySelector('.form-note').textContent = '';
      }
    });

    if (heroMascot) heroMascot.cheer();
    if (finalMascot) finalMascot.cheer();
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
