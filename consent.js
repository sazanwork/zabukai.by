// Visit statistics behind consent — card statistics-after-consent in _docs/DECISIONS.md.
// One file for every page (/, /terms/, /privacy/): the banner, the remembered choice and,
// only after «Принять», PostHog EU through our proxy. Nothing leaves the page before
// the visitor agrees; «Отклонить» loads nothing. The choice lives in localStorage under
// zk-consent ({v, c: 'yes'|'no', t}) for a year — the consent's term (Law 99-Z art. 5 p. 5
// wants a period, never «until withdrawn»); then the banner asks again. Any element with
// data-consent-open (the footer button «Настройки статистики») opens the banner again, and
// «Отклонить» there, once PostHog runs, reloads the page, which drops the library with its queues.
// The proxy host is written without a scheme on purpose: Google followed the bare address
// from the page to t.zabukai.by/ and reported it as a 404 (_docs/gotchas.md).
(function () {
  var KEY = 'zk-consent', VERSION = 1, TERM = 365 * 864e5;
  var HOST = 't.zabukai.by';
  var PH_KEY = 'phc_tMKW3cV7JhxgKLE2nwFanv7WALTtdn8n7rHtVYVoF4WP';
  // Only the live domain counts: a test or a local preview loads the same file with the same
  // key, and 1170 such events reached the project from 25.09 to 13.10.
  var live = location.hostname === 'zabukai.by';
  var granted = false, started = false, early = [], box = null;

  function read() {
    try {
      var s = JSON.parse(localStorage.getItem(KEY));
      if (s && s.v === VERSION && (s.c === 'yes' || s.c === 'no') && Date.now() - s.t < TERM) return s.c;
    } catch (e) {}
    return null;
  }
  function save(c) {
    try { localStorage.setItem(KEY, JSON.stringify({ v: VERSION, c: c, t: Date.now() })); } catch (e) {}
  }

  // In the site's own look: paper card, ink border, the hard offset shadow in the brand orange (it stays visible over the dark footer), no heading.
  var CSS = '#zk-consent{position:fixed;z-index:70;left:16px;bottom:calc(16px + env(safe-area-inset-bottom,0px));' +
    'width:min(400px,calc(100% - 32px));box-sizing:border-box;padding:16px 18px 18px;background:#FAF9F5;color:#0D0D0D;' +
    'border:2px solid #0D0D0D;border-radius:14px;box-shadow:5px 5px 0 #FF6B35;font:14px/1.5 Manrope,system-ui,sans-serif;text-align:left;' +
    'animation:zk-consent-in .35s cubic-bezier(.2,.9,.3,1.2) both}' +
    '#zk-consent[hidden]{display:none}' +
    '#zk-consent p{margin:0 0 14px;color:#2B2B2B}' +
    '#zk-consent a{color:#0D0D0D;text-decoration:underline;text-decoration-color:#FF6B35;text-decoration-thickness:2px;text-underline-offset:3px}' +
    '#zk-consent .zk-cb{display:flex;gap:10px}' +
    '#zk-consent button{flex:1 1 0;min-height:44px;padding:10px 12px;border:2px solid #0D0D0D;border-radius:10px;' +
    'background:#FFFFFF;color:#0D0D0D;font:700 15px/1.2 Manrope,system-ui,sans-serif;white-space:nowrap;cursor:pointer;' +
    'box-shadow:2px 2px 0 #0D0D0D;transition:transform .12s,box-shadow .12s,background .12s}' +
    '#zk-consent button:hover{background:#FFE14D}' +
    '#zk-consent button:active{transform:translate(2px,2px);box-shadow:0 0 0 #0D0D0D}' +
    '#zk-consent button:focus-visible,#zk-consent a:focus-visible{outline:3px solid #FF6B35;outline-offset:2px}' +
    '@keyframes zk-consent-in{from{opacity:0;transform:translateY(16px)}}' +
    '@media (prefers-reduced-motion:reduce){#zk-consent{animation:none}#zk-consent button{transition:none}}' +
    '@media (max-width:480px){#zk-consent{left:8px;bottom:calc(8px + env(safe-area-inset-bottom,0px));width:calc(100% - 16px);padding:14px 14px 16px}}';

  // russian-content: the banner's text — one line and a link to the policy, the minimum Belarusian sites show
  // (hoster.by, onliner.by, kufar.by, a1.by; owner, 05.11: «Минимум, вообще минимум»). It asks about statistics,
  // not cookies: the site sets none. The buttons are NCZPD's own «Принять» and «Отклонить» and look the same.
  // What is collected, by whom, for how long and how to withdraw is on /privacy/#stats.
  var HTML = '<p id="zk-consent-title">Мы собираем статистику посещений, чтобы делать сайт удобнее. ' +
    'Подробнее — в <a href="/privacy/#stats">политике конфиденциальности</a>.</p>' +
    '<div class="zk-cb"><button type="button" data-consent="yes">Принять</button><button type="button" data-consent="no">Отклонить</button></div>';

  function banner() {
    if (box) return box;
    var style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    box = document.createElement('section');
    box.id = 'zk-consent';
    box.setAttribute('aria-labelledby', 'zk-consent-title');
    box.setAttribute('tabindex', '-1');
    box.hidden = true;
    box.innerHTML = HTML;
    box.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('button[data-consent]');
      if (b) decide(b.getAttribute('data-consent'));
    });
    document.body.appendChild(box);
    return box;
  }
  // A first visit gets the banner without taking the focus: the page stays usable before a choice.
  // A reopen from the footer moves the focus to the banner, since the visitor asked for it.
  function open(focus) {
    var b = banner();
    b.hidden = false;
    if (focus) b.focus();
  }
  function decide(c) {
    save(c);
    if (box) box.hidden = true;
    // A refusal after the library started reloads the page: that drops PostHog with its queues and click
    // buffers, so nothing made after the refusal leaves, and a later «Принять» starts clean.
    if (started && c !== 'yes') { location.reload(); return; }
    var was = granted;
    granted = c === 'yes';
    if (granted && !was) { start(); if (window.posthog && started) posthog.capture('consent_given', { version: VERSION }); }
  }

  // Links reach PostHog without their query except utm_* tags and without the fragment:
  // an address someone pasted into a link must not land in the statistics.
  function clean(v) {
    try {
      var u = new URL(v), keep = new URLSearchParams();
      u.searchParams.forEach(function (val, key) { if (key.indexOf('utm_') === 0) keep.append(key, val); });
      u.search = keep.toString(); u.hash = '';
      return u.toString();
    } catch (e) { return v; }
  }
  // Where a request link stands: the header, the mobile menu, the footer or the section's id
  // («hero» for the first screen, which has none).
  function place(a) {
    if (a.closest('#zk-menu')) return 'menu';
    if (a.closest('#zk-nav') || a.closest('header')) return 'header';
    if (a.closest('footer')) return 'footer';
    var s = a.closest('section');
    return s ? (s.id || 'hero') : 'page';
  }
  // A request is a click on a Telegram or mail link of ours; a demo-bot link says data-try-bot.
  // Each goes as its own event with the beacon transport, so leaving for Telegram does not lose it.
  function track(a) {
    if (a.getAttribute('data-try-bot')) {
      posthog.capture('demo_bot_clicked', { bot: a.getAttribute('data-try-bot'),
        channel: a.getAttribute('data-try-channel') || 'site' }, { transport: 'sendBeacon' });
    } else {
      posthog.capture('request_clicked', { place: place(a), kind: a.href.indexOf('mailto:') === 0 ? 'mail' : 'telegram' },
        { transport: 'sendBeacon' });
    }
  }
  var LINKS = 'a[data-try-bot],a[href^="https://t.me/"],a[href^="mailto:"]';

  function start() {
    if (started || !granted || !live) return;
    started = true;
    // PostHog's own loader stub; the library comes from the proxy, which serves its assets too.
    !function(t,e){var o,n,p,r;e.__SV||(window.posthog=e,e._i=[],e.init=function(i,s,a){function g(t,e){var o=e.split(".");2==o.length&&(t=t[o[0]],e=o[1]),t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}}(p=t.createElement("script")).type="text/javascript",p.crossOrigin="anonymous",p.async=!0,p.src=s.api_host.replace(".i.posthog.com","-assets.i.posthog.com")+"/static/array.js",(r=t.getElementsByTagName("script")[0]).parentNode.insertBefore(p,r);var u=e;for(void 0!==a?u=e[a]=[]:a="posthog",u.people=u.people||[],u.toString=function(t){var e="posthog";return"posthog"!==a&&(e+="."+a),t||(e+=" (stub)"),e},u.people.toString=function(){return u.toString(1)+".people (stub)"},o="init capture register register_once register_for_session unregister unregister_for_session getFeatureFlag getFeatureFlagPayload isFeatureEnabled reloadFeatureFlags updateEarlyAccessFeatureEnrollment getEarlyAccessFeatures on onFeatureFlags onSessionId getSurveys getActiveMatchingSurveys renderSurvey canRenderSurvey getNextSurveyStep identify setPersonProperties group resetGroups setPersonPropertiesForFlags resetPersonPropertiesForFlags setGroupPropertiesForFlags resetGroupPropertiesForFlags reset get_distinct_id getGroups get_session_id get_session_replay_url alias set_config startSessionRecording stopSessionRecording sessionRecordingStarted captureException loadToolbar get_property getSessionProperty createPersonProfile opt_in_capturing opt_out_capturing has_opted_in_capturing has_opted_out_capturing clear_opt_in_out_capturing debug".split(" "),n=0;n<o.length;n++)g(u,o[n]);e._i.push([i,s,a])},e.__SV=1)}(document,window.posthog||[]);
    posthog.init(PH_KEY, {
      api_host: 'https://' + HOST,
      ui_host: 'https://eu.posthog.com',
      defaults: '2026-05-30',
      // no cookie, no storage, a daily hash on PostHog's side; the project drops the IP (anonymize_ips)
      cookieless_mode: 'always',
      autocapture: { dom_event_allowlist: ['click'], element_allowlist: ['a', 'button'] },
      capture_heatmaps: true,
      capture_dead_clicks: true,
      capture_performance: { web_vitals: true },
      disable_session_recording: true,
      disable_surveys: true,
      capture_exceptions: true,
      // a guard for the moment between a refusal and the reload
      before_send: function (ev) {
        if (!granted) return null;
        var p = ev && ev.properties;
        if (p) {
          for (var k in p) if (typeof p[k] === 'string' && /^https?:/.test(p[k])) p[k] = clean(p[k]);
          // a clicked link's own address rides in the autocapture element list and its chain string
          if (p.$elements && p.$elements.forEach) p.$elements.forEach(function (el) {
            if (el && typeof el.href === 'string') el.href = clean(el.href);
            if (el && typeof el.attr__href === 'string') el.attr__href = clean(el.attr__href);
          });
          if (typeof p.$elements_chain === 'string') {
            p.$elements_chain = p.$elements_chain.replace(/(href|attr__href)="(https?:[^"]*)"/g, function (m, name, v) { return name + '="' + clean(v) + '"'; });
          }
        }
        return ev;
      }
    });
    // no country in cookieless mode (the IP is dropped before GeoIP): the browser's own
    // time zone tells Minsk from Moscow without asking anything of the visitor
    try { posthog.register({ tz: Intl.DateTimeFormat().resolvedOptions().timeZone }); } catch (e) {}
    while (early.length) track(early.shift());
    if (!('IntersectionObserver' in window)) return;
    var seen = {};
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        var id = e.target.id || 'hero';
        if (e.isIntersecting && !seen[id]) { seen[id] = 1; posthog.capture('section_viewed', { section: id }); io.unobserve(e.target); }
      });
    }, { rootMargin: '0px 0px -50% 0px' });
    document.querySelectorAll('section:not(#zk-consent)').forEach(function (s) { io.observe(s); });
  }

  document.addEventListener('click', function (e) {
    var t = e.target && e.target.closest ? e.target : null;
    if (!t) return;
    if (t.closest('[data-consent-open]')) { e.preventDefault(); open(true); return; }
    var a = t.closest(LINKS);
    if (!a || !granted || !live || t.closest('#zk-consent')) return;
    // a click before the page's load event starts the library at once instead of being lost
    if (started) track(a); else { early.push(a); start(); }
  }, true);

  // A choice made in another tab of the site reaches this one at once: a refusal there stops sending here.
  window.addEventListener('storage', function (e) {
    if (e.key !== KEY) return;
    var c = read();
    if (started && c !== 'yes') { location.reload(); return; }
    granted = c === 'yes';
    if (granted) start();
  });

  var choice = read();
  if (choice === 'yes') {
    granted = true;
    // init waits for the page's load event, so the library never competes with the first screen
    if (document.readyState === 'complete') start(); else window.addEventListener('load', start, { once: true });
  } else if (choice === null) {
    open(false);
  }
})();
