/* ================= دفترة — منطق التطبيق =================
   HTML/CSS/JS فقط. لا إطار عمل، لا خادم، لا حساب.
   الرصيد يُحسب دائمًا من الحركات ولا يُخزَّن.
============================================================== */
(function () {
  'use strict';

  /* ---------------- الإعدادات الثابتة ---------------- */
  var DEFAULT_CURRENCY = '₪';
  var DEFAULT_COUNTRY_CODE = '970';
  var BACKUP_REMINDER_DAYS = 1;
  var BACKUP_EVERY_HOURS = 24;    // يُسأل صاحب المحل أين يحفظ نسخة جديدة كل 24 ساعة
  var LATE_ALERT_HOUR = 9;        // التنبيه اليومي بالمتأخرين (يغيّره صاحب المحل من الإعدادات)
  var SPLASH_MIN_MS = 1500;       // شاشة الدخول المتحركة لا تُقطع قبل اكتمال حركتها
  var bootAt = Date.now();
  var OVERDUE_DAYS = 30;

  // كل العملات العربية، ومعها الدولار واليورو والليرة التركية.
  // الإعداد الأول يعرض أول SETUP_CURRENCIES منها أزرارًا، والباقي تحت «عملة أخرى».
  var CURRENCIES = [
    { v: '₪', t: 'شيكل (₪)' },
    { v: '$', t: 'دولار ($)' },
    { v: 'د.أ', t: 'دينار أردني (د.أ)' },
    { v: 'ج.م', t: 'جنيه مصري (ج.م)' },
    { v: 'ر.س', t: 'ريال سعودي (ر.س)' },
    { v: 'د.إ', t: 'درهم إماراتي (د.إ)' },
    { v: 'د.ك', t: 'دينار كويتي (د.ك)' },
    { v: 'ر.ق', t: 'ريال قطري (ر.ق)' },
    { v: 'د.ب', t: 'دينار بحريني (د.ب)' },
    { v: 'ر.ع', t: 'ريال عماني (ر.ع)' },
    { v: 'د.ع', t: 'دينار عراقي (د.ع)' },
    { v: 'ل.س', t: 'ليرة سورية (ل.س)' },
    { v: 'ل.ل', t: 'ليرة لبنانية (ل.ل)' },
    { v: 'ر.ي', t: 'ريال يمني (ر.ي)' },
    { v: 'ج.س', t: 'جنيه سوداني (ج.س)' },
    { v: 'د.ل', t: 'دينار ليبي (د.ل)' },
    { v: 'د.ت', t: 'دينار تونسي (د.ت)' },
    { v: 'د.ج', t: 'دينار جزائري (د.ج)' },
    { v: 'د.م', t: 'درهم مغربي (د.م)' },
    { v: 'أ.م', t: 'أوقية موريتانية (أ.م)' },
    { v: 'ش.ص', t: 'شلن صومالي (ش.ص)' },
    { v: 'ف.ج', t: 'فرنك جيبوتي (ف.ج)' },
    { v: 'ف.ق', t: 'فرنك قمري (ف.ق)' },
    { v: '€', t: 'يورو (€)' },
    { v: '₺', t: 'ليرة تركية (₺)' }
  ];
  var SETUP_CURRENCIES = 7;
  var PLAY_PRICE = '7$';          // سعر «دفترة الكاملة» في Google Play حتى يصل السعر المحلي من المتجر

  /* ---------------- اختصارات ---------------- */
  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }
  function fmt(n) {
    return round2(n).toLocaleString('en-US', { maximumFractionDigits: 2 });
  }
  function fmtSigned(n) { return (n < 0 ? '−' : '') + fmt(Math.abs(n)); }
  function two(n) { return n < 10 ? '0' + n : '' + n; }
  // «اليوم» / «أمس» / «الثلاثاء 14/10» — عناوين أيام سجل الحركات
  var WEEKDAYS = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
  function dayLabel(iso) {
    var w = whenLabel(iso);
    if (w === 'اليوم' || w === 'أمس') return w;
    var d = new Date(iso);
    return WEEKDAYS[d.getDay()] + ' ' + fmtDate(iso);
  }
  function fmtTime(iso) {
    var d = new Date(iso);
    return isNaN(d.getTime()) ? '' : two(d.getHours()) + ':' + two(d.getMinutes());
  }
  function fmtDate(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.getDate() + '/' + (d.getMonth() + 1) + '/' + d.getFullYear();
  }
  // تاريخ بلا وقت (YYYY-MM-DD) بالتوقيت المحلي، لا UTC
  function fmtDay(day) { return fmtDate(day + 'T12:00:00'); }
  function fmtDateTime(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return fmtDate(iso) + ' · ' + two(d.getHours()) + ':' + two(d.getMinutes());
  }
  function ymd(d) {
    d = d || new Date();
    return d.getFullYear() + '-' + two(d.getMonth() + 1) + '-' + two(d.getDate());
  }
  function daysSince(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return 0;
    var a = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    var n = new Date();
    var b = new Date(n.getFullYear(), n.getMonth(), n.getDate());
    return Math.max(0, Math.round((b - a) / 86400000));
  }
  // توحيد الحروف العربية ليعمل البحث مع أي طريقة كتابة
  function norm(s) {
    return String(s == null ? '' : s).toLowerCase().trim()
      .replace(/[ً-ْٰ]/g, '')
      .replace(/[آأإٱ]/g, 'ا')
      .replace(/ى/g, 'ي')
      .replace(/ة/g, 'ه')
      .replace(/\s+/g, ' ');
  }
  /* ---------------- الحالة ---------------- */
  var S = {
    shopName: '',
    currency: DEFAULT_CURRENCY,
    lastBackupAt: null,
    persistGranted: false,
    customers: [],
    tx: [],
    index: new Map(),
    sort: 'recent',
    started: false
  };

  function reindex() {
    S.index = new Map();
    S.customers.forEach(function (c) {
      S.index.set(c.id, { c: c, tx: [], balance: 0, last: null });
    });
    S.tx.forEach(function (t) {
      var e = S.index.get(t.customerId);
      if (e) e.tx.push(t);
    });
    S.index.forEach(function (e) {
      e.tx.sort(function (a, b) {
        if (a.date === b.date) return (b.id || 0) - (a.id || 0);
        return a.date < b.date ? 1 : -1;
      });
      var bal = 0;
      e.tx.forEach(function (t) { bal += (t.type === 'debt' ? t.amount : -t.amount); });
      e.balance = round2(bal);
      e.last = e.tx.length ? e.tx[0].date : null;
    });
  }

  function entry(id) { return S.index.get(id) || null; }

  function totalOwed() {
    var sum = 0;
    S.index.forEach(function (e) { if (e.balance > 0) sum += e.balance; });
    return round2(sum);
  }

  // التأخير يُقاس بعمر أقدم دين لم يُسدَّد، لا بآخر حركة
  function overdueDays(e, at) {
    if (e.balance <= 0) return 0;
    var oldest = null;
    e.tx.forEach(function (t) {
      if (t.type === 'debt' && (oldest === null || t.date < oldest)) oldest = t.date;
    });
    if (!oldest) return 0;
    return Math.max(0, Math.floor(((at || Date.now()) - new Date(oldest).getTime()) / 86400000));
  }

  function isOverdue(e) { return overdueDays(e) >= OVERDUE_DAYS; }

  function whenLabel(iso) {
    var ts = new Date(iso).getTime();
    if (isNaN(ts)) return '';
    var n = new Date();
    var midnight = new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime();
    if (ts >= midnight) return 'اليوم';
    if (ts >= midnight - 86400000) return 'أمس';
    var days = Math.floor((midnight - ts) / 86400000) + 1;
    if (days < 7) return 'قبل ' + days + ' أيام';
    return fmtDate(iso);
  }

  function lastLabel(e) {
    return e.tx.length ? 'آخر حركة ' + whenLabel(e.last) : 'لا حركات';
  }

  function loadData() {
    return Promise.all([DB.allCustomers(), DB.allTransactions()])
      .then(function (r) {
        S.customers = r[0];
        S.tx = r[1];
        reindex();
        scheduleNotifSync();
      });
  }

  function loadSettings() {
    return DB.getSettings().then(function (s) {
      S.shopName = s.shopName || '';
      S.currency = s.currency || DEFAULT_CURRENCY;
      S.lastBackupAt = s.lastBackupAt || null;
      S.persistGranted = !!s.persistGranted;
      S.lockEnabled = !!s.lockEnabled;
      S.backupAskedAt = s.backupAskedAt || null;
      S.lateAlert = s.lateAlert == null ? LATE_ALERT_HOUR : s.lateAlert;   // ساعة أو 'off'
      S.notifAsked = !!s.notifAsked;
      S.logo = s.logo || '';
      S.licenseCode = s.license || '';
      S.playOwned = !!s.playOwned;
      S.syncLic = s.syncLic || null;
      return refreshLicense().then(function () { checkPlay(); });
    });
  }

  /* ---------------- التنقل ---------------- */
  // nav: مكدس من {t:'view',n:'home'|'customer',id}
  //      أو {t:'ov',n:'numpad'|'sheet'|'statement'|'settings'|'dialog'}
  var nav = [{ t: 'view', n: 'home' }];

  function pushEntry(e) {
    nav.push(e);
    history.pushState({ i: nav.length - 1 }, '');
    render();
  }
  function pushView(n, id) { pushEntry({ t: 'view', n: n, id: id }); }
  function pushOverlay(n) { pushEntry({ t: 'ov', n: n }); }
  function goBack() { history.back(); }

  // استبدال أعلى المكدس دون إضافة خطوة جديدة (مثلًا: ورقة الإضافة ← بطاقة الزبون)
  function replaceTop(e) {
    nav[nav.length - 1] = e;
    history.replaceState({ i: nav.length - 1 }, '');
    render();
  }

  // رجوع ثم تنفيذ عمل بعد اكتمال الرجوع فعليًا (حتى لا تتضارب خطوات المتصفح)
  var afterPop = null;
  function goBackThen(fn) { afterPop = fn; history.back(); }

  function resetToHome() {
    while (nav.length > 1) onRemoved(nav.pop());
    nav = [{ t: 'view', n: 'home' }];
    history.replaceState({ i: 0 }, '');
    render();
  }

  function onRemoved(e) {
    if (e.t === 'ov' && e.n === 'dialog') { closeDialog(dialogPick); dialogPick = false; }
  }

  window.addEventListener('popstate', function (ev) {
    var i = (ev.state && typeof ev.state.i === 'number') ? ev.state.i : 0;
    while (nav.length > i + 1) onRemoved(nav.pop());
    render();
    if (afterPop) {
      var f = afterPop;
      afterPop = null;
      f();
    }
  });

  function currentView() {
    for (var i = nav.length - 1; i >= 0; i--) if (nav[i].t === 'view') return nav[i];
    return { t: 'view', n: 'home' };
  }
  function overlayOpen(n) {
    return nav.some(function (e) { return e.t === 'ov' && e.n === n; });
  }

  function render() {
    // مربعات التأكيد تظهر في شاشة الإعداد أيضًا (استعادة نسخة قبل بدء الدفتر)
    $('dialog').hidden = !overlayOpen('dialog');
    // الربط بجهاز آخر متاح من شاشة الإعداد أيضًا (جهاز جديد)
    $('syncjoin').hidden = !overlayOpen('syncjoin');
    if ($('syncjoin').hidden) stopScan();
    if (!S.started) return;
    var v = currentView();
    // الشاشة العريضة (الحاسوب): القائمة دائمًا، وصفحة الزبون بجانبها
    $('screen-home').hidden = v.n !== 'home' && !S.wide;
    $('screen-customer').hidden = v.n !== 'customer';
    $('pane-empty').hidden = !S.wide || v.n === 'customer';
    if (v.n === 'home' || S.wide) renderHome();
    if (v.n === 'customer') renderCustomer(v.id);
    $('numpad').hidden = !overlayOpen('numpad');
    $('sheet').hidden = !overlayOpen('sheet');
    $('statement').hidden = !overlayOpen('statement');
    $('settings').hidden = !overlayOpen('settings');
    $('remind').hidden = !overlayOpen('remind');
    $('listsheet').hidden = !overlayOpen('listsheet');
    $('activate').hidden = !overlayOpen('activate');
    $('synccode').hidden = !overlayOpen('synccode');
    $('syncbuy').hidden = !overlayOpen('syncbuy');
  }

  /* ---------------- مربعات التأكيد ---------------- */
  var dialogResolve = null;

  function ask(opts) {
    return new Promise(function (resolve) {
      if (dialogResolve) { resolve(false); return; }
      dialogResolve = resolve;
      $('dialog-title').textContent = opts.title || '';
      $('dialog-msg').textContent = opts.msg || '';
      var ok = $('dialog-ok');
      ok.textContent = opts.ok || 'تأكيد';
      ok.className = 'btn btn-lg full ' + (opts.danger ? 'btn-danger' : 'btn-primary');
      var alt = $('dialog-alt');
      alt.hidden = !opts.alt;
      alt.textContent = opts.alt || '';
      var cancel = $('dialog-cancel');
      cancel.hidden = !!opts.alert;
      cancel.textContent = opts.cancel || 'إلغاء';
      pushOverlay('dialog');
    });
  }
  function alertBox(title, msg, okLabel) {
    return ask({ title: title, msg: msg, ok: okLabel || 'حسنًا', alert: true });
  }
  function closeDialog(value) {
    if (!dialogResolve) return;
    var r = dialogResolve;
    dialogResolve = null;
    r(value);
  }

  // الجواب يصل بعد أن يكتمل إغلاق المربع (popstate)، لا قبله: وإلا قد يفتح الفعل
  // التالي مربعًا جديدًا يغلقه «رجوع» المربع القديم المتأخر.
  var dialogPick = false;
  function pick(value) { dialogPick = value; goBack(); }
  $('dialog-ok').addEventListener('click', function () { pick(true); });
  $('dialog-alt').addEventListener('click', function () { pick('alt'); });
  $('dialog-cancel').addEventListener('click', function () { pick(false); });
  $('dialog').querySelector('.sheet-backdrop').addEventListener('click', function () { pick(false); });

  /* ---------------- 1. شاشة الإعداد ---------------- */
  function fillCurrencySelect(sel, value) {
    sel.innerHTML = CURRENCIES.map(function (c) {
      return '<option value="' + esc(c.v) + '">' + esc(c.t) + '</option>';
    }).join('');
    sel.value = value;
    if (!sel.value) sel.value = DEFAULT_CURRENCY;
  }

  function isIOS() {
    var ua = navigator.userAgent || '';
    return /iPad|iPhone|iPod/.test(ua) ||
      (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  }
  function isStandalone() {
    return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
      navigator.standalone === true;
  }

  var installPrompt = null;
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    installPrompt = e;
    var b = $('install-now');
    if (b && !$('screen-setup').hidden) b.hidden = false;
  });

  function showOsGuide(os) {
    $('guide-android').hidden = os !== 'android';
    $('guide-ios').hidden = os !== 'ios';
    Array.prototype.forEach.call($('os-tabs').children, function (t) {
      t.classList.toggle('on', t.dataset.os === os);
    });
  }

  // العملة في الإعداد: أزرار للعملات الأشهر، و«عملة أخرى» تفتح القائمة الكاملة
  function paintSetupCurrency() {
    var sel = $('setup-currency'), cur = sel.value;
    var top = CURRENCIES.slice(0, SETUP_CURRENCIES);
    var isTop = top.some(function (c) { return c.v === cur; });
    function chip(v, sym, name, on) {
      return '<button type="button" role="radio" aria-checked="' + on + '" class="cur' + (on ? ' on' : '') +
        '" data-v="' + esc(v) + '"><b>' + esc(sym) + '</b><span>' + esc(name) + '</span></button>';
    }
    var other = CURRENCIES.filter(function (c) { return c.v === cur; })[0];
    $('setup-cur').innerHTML = top.map(function (c) {
      return chip(c.v, c.v, c.t.replace(/\s*\(.*\)$/, ''), c.v === cur);
    }).join('') + (isTop
      ? chip('', '…', 'عملة أخرى', false)
      : chip('', other.v, other.t.replace(/\s*\(.*\)$/, ''), true));
    sel.hidden = isTop && !sel.dataset.open;
  }
  $('setup-cur').addEventListener('click', function (e) {
    var b = e.target.closest('.cur');
    if (!b) return;
    var sel = $('setup-currency');
    if (b.dataset.v) {
      sel.value = b.dataset.v;
      delete sel.dataset.open;
    } else {
      sel.dataset.open = '1';        // «عملة أخرى»: تظهر القائمة الكاملة
      sel.hidden = false;
      sel.focus();
      return;
    }
    paintSetupCurrency();
  });
  $('setup-currency').addEventListener('change', paintSetupCurrency);

  function showSetup() {
    fillCurrencySelect($('setup-currency'), S.currency);
    paintSetupCurrency();
    // تطبيق أندرويد: خطوة واحدة فقط
    if (Native.isNative) {
      $('setup-count').hidden = true;
      $('setup-next').textContent = 'ابدأ دفترك';
    }
    $('setup-shop').value = S.shopName || '';
    $('setup-link').hidden = !Sync.available;
    $('screen-setup').hidden = false;
    setTimeout(function () { $('setup-shop').focus(); }, 150);
  }

  $('setup-next').addEventListener('click', function () {
    var name = $('setup-shop').value.trim();
    if (!name) {
      $('setup-err').hidden = false;
      $('setup-shop').focus();
      return;
    }
    $('setup-err').hidden = true;
    S.shopName = name;
    S.currency = $('setup-currency').value || DEFAULT_CURRENCY;

    // تطبيق أندرويد: بياناته خارج المتصفح ولا يحتاج خطوة «أضف إلى الشاشة الرئيسية»
    if (Native.isNative) { finishSetup(); return; }

    // طلب تخزين دائم حتى لا يمسح المتصفح الدفتر
    requestPersist();

    $('setup-step1').hidden = true;
    $('setup-step2').hidden = false;
    showOsGuide(isIOS() ? 'ios' : 'android');
    if (isStandalone()) {
      $('installed-note').hidden = false;
      $('guide-android').hidden = true;
      $('guide-ios').hidden = true;
      $('os-tabs').hidden = true;
    }
    if (installPrompt) $('install-now').hidden = false;
    window.scrollTo(0, 0);
  });

  Array.prototype.forEach.call($('os-tabs').children, function (t) {
    t.addEventListener('click', function () { showOsGuide(t.dataset.os); });
  });

  $('install-now').addEventListener('click', function () {
    if (!installPrompt) return;
    installPrompt.prompt();
    installPrompt.userChoice.then(function () {
      installPrompt = null;
      $('install-now').hidden = true;
    });
  });

  function finishSetup() {
    Promise.all([
      DB.setSetting('shopName', S.shopName),
      DB.setSetting('currency', S.currency)
    ]).then(function () {
      $('screen-setup').hidden = true;
      startApp();
    });
  }
  $('setup-done').addEventListener('click', finishSetup);
  $('setup-restore').addEventListener('click', function () { fileMode = 'restore'; $('restore-file').click(); });

  function requestPersist() {
    if (!navigator.storage || !navigator.storage.persist) return Promise.resolve(false);
    return navigator.storage.persist().then(function (granted) {
      S.persistGranted = !!granted;
      return DB.setSetting('persistGranted', !!granted).then(function () { return !!granted; });
    }).catch(function () { return false; });
  }

  /* ---------------- 4. الشاشة الرئيسية ---------------- */
  function renderHome() {
    $('home-shop').textContent = S.shopName || 'دفترة';
    $('home-date').textContent = WEEKDAYS[new Date().getDay()] + ' ' + fmtDate(new Date().toISOString());
    $('home-logo').hidden = !S.logo;
    if (S.logo && $('home-logo').getAttribute('src') !== S.logo) $('home-logo').src = S.logo;
    // المجموع مخفي حتى يضغط صاحب المحل على العين، ويُخفى ثانية عند العودة للتطبيق
    $('metric-total').textContent = S.showTotal ? fmt(totalOwed()) : '••••';
    $('total-toggle').setAttribute('aria-pressed', S.showTotal ? 'true' : 'false');
    $('total-toggle').setAttribute('aria-label', S.showTotal ? 'أخفِ مجموع الديون' : 'أظهر مجموع الديون');
    $('metric-cur').textContent = S.currency;
    $('metric-count').textContent = fmt(S.customers.length);
    renderToday();
    renderDue();
    renderBackupBanner();
    renderSortBar();
    renderCustomerList();
  }

  /* ---- ملخص اليوم ---- */
  function startOfToday() {
    var n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), n.getDate()).toISOString();
  }
  function todayTx() {
    var from = startOfToday();
    return S.tx.filter(function (t) { return t.date >= from; })
      .sort(function (a, b) { return a.date < b.date ? 1 : -1; });
  }
  function renderToday() {
    var list = todayTx(), debt = 0, pay = 0;
    list.forEach(function (t) { if (t.type === 'debt') debt += t.amount; else pay += t.amount; });
    // المبالغ تتبع زر العين مثل المجموع
    $('today-debt').textContent = S.showTotal ? fmt(debt) : '••';
    $('today-pay').textContent = S.showTotal ? fmt(pay) : '••';
    $('today-count').textContent = list.length ? list.length + ' حركة' : 'لا حركات بعد';
  }
  $('today-strip').addEventListener('click', function () {
    var list = todayTx(), debt = 0, pay = 0;
    list.forEach(function (t) { if (t.type === 'debt') debt += t.amount; else pay += t.amount; });
    openList('ملخص اليوم', 'ديون ' + fmt(debt) + ' · دفعات ' + fmt(pay) + ' ' + S.currency +
      ' · ' + list.length + ' حركة', list.map(function (t) {
        var e = entry(t.customerId);
        return {
          id: t.customerId,
          name: e ? e.c.name : '—',
          sub: fmtTime(t.date) + (t.note ? ' · ' + t.note : ''),
          amount: (t.type === 'debt' ? '+' : '−') + fmt(t.amount),
          cls: t.type
        };
      }), 'لم تُسجَّل أي حركة اليوم بعد.');
  });

  /* ---- التذكيرات المستحقة ---- */
  function isDue(c) { return !!c.remindAt && new Date(c.remindAt).getTime() <= Date.now(); }
  function dueCustomers() {
    var out = [];
    S.index.forEach(function (e) { if (isDue(e.c)) out.push(e); });
    return out.sort(function (a, b) { return a.c.remindAt < b.c.remindAt ? -1 : 1; });
  }
  function renderDue() {
    var due = dueCustomers();
    $('due-strip').hidden = !due.length;
    if (!due.length) return;
    $('due-text').textContent = due.length === 1
      ? 'تذكير: ' + (due[0].c.remindText || due[0].c.name)
      : due.length + ' تذكيرات مستحقة الآن';
  }
  $('due-strip').addEventListener('click', function () {
    var due = dueCustomers();
    if (due.length === 1) { pushView('customer', due[0].c.id); return; }
    openList('تذكيرات مستحقة', '', due.map(function (e) {
      return { id: e.c.id, name: e.c.name, sub: e.c.remindText || '', amount: e.balance > 0 ? fmt(e.balance) : '', cls: 'debt' };
    }), '');
  });

  /* ---- قائمة عامة في شيت: صفوف تفتح صفحة الزبون ---- */
  function openList(title, sub, rows, empty) {
    $('list-title').textContent = title;
    $('list-sub').textContent = sub || '';
    $('list-rows').innerHTML = rows.length ? rows.map(function (r) {
      return '<li><button class="lrow" type="button" data-id="' + r.id + '">' +
        '<span class="lrow-main"><span class="lrow-name">' + esc(r.name) + '</span>' +
        '<span class="lrow-sub">' + esc(r.sub) + '</span></span>' +
        '<span class="lrow-amt num ' + (r.cls || '') + '">' + esc(r.amount) + '</span></button></li>';
    }).join('') : '<li class="lrow-empty">' + esc(empty) + '</li>';
    pushOverlay('listsheet');
  }
  $('list-rows').addEventListener('click', function (ev) {
    var b = ev.target.closest('.lrow');
    if (!b) return;
    var id = Number(b.dataset.id);
    goBackThen(function () { if (entry(id)) pushView('customer', id); });
  });
  $('list-close').addEventListener('click', goBack);
  $('listsheet').querySelector('.sheet-backdrop').addEventListener('click', goBack);

  // «متأخرون» في بطاقة المجموع: يرتّب القائمة بالمتأخرين وينزل إليها
  $('late-pill').addEventListener('click', function () {
    S.sort = 'late';
    render();
    $('sortbar').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  $('total-toggle').addEventListener('click', function () {
    S.showTotal = !S.showTotal;
    renderHome();
  });

  function renderSortBar() {
    var late = 0;
    S.index.forEach(function (e) { if (isOverdue(e)) late++; });
    $('sort-late').textContent = late ? 'متأخرون · ' + late : 'متأخرون';
    $('late-pill').hidden = !late;
    $('late-count').textContent = String(late);
    Array.prototype.forEach.call($('sortbar').children, function (b) {
      b.classList.toggle('on', b.dataset.sort === S.sort);
    });
  }

  function backupOverdueDays() {
    if (!S.lastBackupAt) return null;
    return daysSince(S.lastBackupAt);
  }

  function renderBackupBanner() {
    var d = backupOverdueDays();
    var show = (d === null) ? S.customers.length > 0 : d >= BACKUP_REMINDER_DAYS;
    $('backup-banner').hidden = !show;
    if (!show) return;
    $('backup-banner-text').textContent = (d === null)
      ? 'لم تحفظ نسخة احتياطية بعد.'
      : 'آخر نسخة احتياطية قبل ' + d + ' يوم.';
  }

  function sortedCustomers() {
    var list = [];
    S.index.forEach(function (e) { list.push(e); });
    if (S.sort === 'late') {
      return list.filter(isOverdue).sort(function (a, b) {
        return overdueDays(b) - overdueDays(a);
      });
    }
    if (S.sort === 'debt') {
      return list.sort(function (a, b) { return b.balance - a.balance; });
    }
    if (S.sort === 'name') {
      return list.sort(function (a, b) { return a.c.name.localeCompare(b.c.name, 'ar'); });
    }
    return list.sort(function (a, b) {                 // الأحدث حركةً
      var la = a.last ? new Date(a.last).getTime() : 0;
      var lb = b.last ? new Date(b.last).getTime() : 0;
      return lb - la;
    });
  }

  function renderCustomerList() {
    var raw = $('search').value;
    var q = norm(raw);
    // 0599… يطابق +970599…: نبحث بالأرقام دون الأصفار في أولها
    var digits = q.replace(/\D/g, '').replace(/^0+/, '');
    $('search-clear').hidden = !raw;

    var list = sortedCustomers().filter(function (e) {
      if (!q) return true;
      if (norm(e.c.name).indexOf(q) !== -1) return true;
      if (e.c.note && norm(e.c.note).indexOf(q) !== -1) return true;
      return digits !== '' &&
        String(e.c.phone || '').replace(/\D/g, '').indexOf(digits) !== -1;
    });

    $('customer-list').innerHTML = list.map(function (e) {
      var owed = e.balance > 0;
      var od = overdueDays(e);
      var amount = owed
        ? '<span class="row-right"><span class="row-amount num">' + fmt(e.balance) + '</span><span class="row-tag">عليه</span></span>'
        : (e.balance < 0
            ? '<span class="row-right"><span class="row-amount num credit">' + fmt(-e.balance) + '</span><span class="row-tag credit">له</span></span>'
            : '<span class="row-right"><span class="row-amount settled">مسدّد</span></span>');
      var sel = S.wide && currentView().n === 'customer' && currentView().id === e.c.id;
      return '<li><button class="row' + (od >= OVERDUE_DAYS ? ' is-late' : '') + (sel ? ' sel' : '') + '" type="button" data-id="' + e.c.id + '">' +
        '<span class="row-mark av-' + avatarHue(e.c.name) + '" aria-hidden="true">' +
          esc(String(e.c.name).trim().charAt(0)) + '</span>' +
        '<span class="row-main">' +
          '<span class="row-name">' + esc(e.c.name) + '</span>' +
          '<span class="row-sub"><span>' + esc(lastLabel(e)) + '</span>' +
            (e.c.remindAt ? '<span class="row-bell' + (isDue(e.c) ? ' is-due' : '') + '">🔔</span>' : '') +
            (od >= OVERDUE_DAYS ? '<span class="late">متأخر ' + od + ' يوم</span>' : '') +
          '</span>' +
        '</span>' + amount +
      '</button></li>';
    }).join('');

    var empty = $('home-empty');
    empty.hidden = list.length > 0;
    if (list.length) return;
    var title, hint;
    if (raw.trim()) {
      title = 'لا نتائج';
      hint = 'لا يوجد زبون بهذا الاسم.';
    } else if (S.sort === 'late' && S.customers.length) {
      title = 'لا متأخرين';
      hint = 'لا يوجد زبون تأخر أكثر من ' + OVERDUE_DAYS + ' يوم.';
    } else {
      title = 'الدفتر فارغ';
      hint = 'أضف أول زبون لتبدأ بتسجيل الديون والدفعات.';
    }
    $('empty-import').hidden = S.customers.length > 0;
    $('empty-title').textContent = title;
    $('empty-hint').textContent = hint;
  }

  $('sortbar').addEventListener('click', function (ev) {
    var b = ev.target.closest('.sort');
    if (!b || b.dataset.sort === S.sort) return;
    S.sort = b.dataset.sort;
    renderSortBar();
    renderCustomerList();
    $('home-scroll').scrollTop = 0;
  });

  $('customer-list').addEventListener('click', function (e) {
    var btn = e.target.closest('.row');
    if (!btn) return;
    openCustomer(Number(btn.dataset.id));
  });

  $('search').addEventListener('input', renderCustomerList);
  $('search-clear').addEventListener('click', function () {
    $('search').value = '';
    renderCustomerList();
    $('search').focus();
  });

  $('go-settings').addEventListener('click', openSettings);
  $('backup-banner-btn').addEventListener('click', function () { doBackup(); });
  $('fab-new').addEventListener('click', function () { openNewCustomer(); });

  function openCustomer(id) {
    // في الشاشة العريضة: الزبون التالي يحل محل المفتوح بدل أن يتكدّس في «رجوع»
    var top = nav[nav.length - 1];
    if (S.wide && top.t === 'view' && top.n === 'customer') replaceTop({ t: 'view', n: 'customer', id: id });
    else pushView('customer', id);
    $('cust-scroll').scrollTop = 0;
  }

  // لون ثابت لكل زبون من اسمه (6 ألوان)، حتى تتميّز الأسماء في القائمة بنظرة
  function avatarHue(name) {
    var h = 0, s = String(name);
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return h % 6;
  }

  /* ---------------- 2. صفحة الزبون ---------------- */
  var ICON_TRASH = '<svg class="ic" viewBox="0 0 256 256" width="19" height="19" fill="currentColor" aria-hidden="true"><path d="M200,56V208a8,8,0,0,1-8,8H64a8,8,0,0,1-8-8V56Z" opacity="0.2"/><path d="M216,48H176V40a24,24,0,0,0-24-24H104A24,24,0,0,0,80,40v8H40a8,8,0,0,0,0,16h8V208a16,16,0,0,0,16,16H192a16,16,0,0,0,16-16V64h8a8,8,0,0,0,0-16ZM96,40a8,8,0,0,1,8-8h48a8,8,0,0,1,8,8v8H96Zm96,168H64V64H192ZM112,104v64a8,8,0,0,1-16,0V104a8,8,0,0,1,16,0Zm48,0v64a8,8,0,0,1-16,0V104a8,8,0,0,1,16,0Z"/></svg>';

  var ICON_EDIT = '<svg class="ic" viewBox="0 0 256 256" width="19" height="19" fill="currentColor" aria-hidden="true"><path d="M221.66,90.34,192,120,136,64l29.66-29.66a8,8,0,0,1,11.31,0L221.66,79A8,8,0,0,1,221.66,90.34Z" opacity="0.2"/><path d="M227.31,73.37,182.63,28.68a16,16,0,0,0-22.63,0L36.69,152A15.86,15.86,0,0,0,32,163.31V208a16,16,0,0,0,16,16H92.69A15.86,15.86,0,0,0,104,219.31L227.31,96a16,16,0,0,0,0-22.63ZM92.69,208H48V163.31l88-88L180.69,120ZM192,108.68,147.31,64l24-24L216,84.68Z"/></svg>';

  function renderCustomer(id) {
    var e = entry(id);
    if (!e) { goBack(); return; }
    var c = e.c;

    $('cust-name').textContent = c.name;
    $('cust-av').textContent = String(c.name).trim().charAt(0);
    $('cust-av').className = 'cust-av av-' + avatarHue(c.name);
    $('cust-phone').innerHTML = c.phone
      ? '<span class="num">' + esc(c.phone) + '</span>'
      : 'بلا رقم هاتف';
    var od = overdueDays(e);
    $('cust-late').textContent = od >= OVERDUE_DAYS ? 'متأخر ' + od + ' يوم' : '';

    var block = $('balance-block');
    block.classList.toggle('owed', e.balance > 0);
    block.classList.toggle('credit', e.balance < 0);
    $('balance-label').textContent = e.balance > 0 ? 'الرصيد المستحق'
      : (e.balance < 0 ? 'رصيد لصالح الزبون' : 'الحساب');
    $('balance-value').textContent = fmt(Math.abs(e.balance));
    document.querySelector('.bal-cur').textContent = S.currency;
    var debts = 0, pays = 0;
    e.tx.forEach(function (t) { if (t.type === 'debt') debts += t.amount; else pays += t.amount; });
    $('bal-debt').textContent = fmt(debts);
    $('bal-pay').textContent = fmt(pays);
    $('bal-last').textContent = e.last ? 'آخر حركة ' + whenLabel(e.last) : 'لا حركات بعد';

    $('cust-note').hidden = !c.note;
    $('cust-note-text').textContent = c.note || '';
    renderRemindBox(e);

    $('tx-count').textContent = e.tx.length ? String(e.tx.length) : '';
    // الرصيد بعد كل حركة: يُحسب من الأقدم للأحدث، ثم تُعرض الأحدث أولًا مجمّعة باليوم
    var after = {}, run = 0;
    e.tx.slice().reverse().forEach(function (t) {
      run = round2(run + (t.type === 'debt' ? t.amount : -t.amount));
      after[t.id] = run;
    });
    var lastDay = null;
    $('tx-list').innerHTML = e.tx.map(function (t) {
      var day = dayLabel(t.date), head = '';
      if (day !== lastDay) { head = '<li class="tx-day">' + esc(day) + '</li>'; lastDay = day; }
      var debt = t.type === 'debt';
      return head + '<li><button class="tx ' + t.type + '" type="button" data-id="' + t.id + '" aria-label="تعديل الحركة">' +
        '<span class="tx-ic" aria-hidden="true">' + (debt ? '↑' : '↓') + '</span>' +
        '<span class="tx-main">' +
          '<span class="tx-label">' + (debt ? 'دين' : 'دفعة') + (t.note ? '<span class="tx-note"> · ' + esc(t.note) + '</span>' : '') + '</span>' +
          '<span class="tx-when num">' + esc(fmtTime(t.date)) + '</span>' +
        '</span>' +
        '<span class="tx-right">' +
          '<span class="tx-amount num">' + (debt ? '+' : '−') + fmt(t.amount) + '</span>' +
          '<span class="tx-after">الرصيد <span class="num">' + fmtSigned(after[t.id]) + '</span></span>' +
        '</span>' +
      '</button></li>';
    }).join('');
    $('tx-empty').hidden = e.tx.length > 0;
  }

  $('cust-back').addEventListener('click', goBack);
  $('cust-note').addEventListener('click', function () { openEditCustomer(currentView().id, { focusNote: true }); });

  /* ---- تذكير عن الزبون: لصاحب المحل، في موعد يختاره ---- */
  function renderRemindBox(e) {
    var c = e.c, has = !!c.remindAt, due = has && isDue(c);
    var box = $('remind-box');
    box.className = 'remind' + (has ? ' set' : '') + (due ? ' due' : '');
    // سطران: الموعد، ثم نص التذكير — حتى لا يختلط التاريخ بالنص العربي
    $('remind-text').innerHTML = has
      ? '<span class="remind-when">' + (due ? 'مستحق الآن · ' : 'تذكير · ') +
          '<span class="num">' + esc(fmtDate(c.remindAt)) + ' ' + esc(fmtTime(c.remindAt)) + '</span></span>' +
        '<span class="remind-msg">' + esc(c.remindText || 'تذكير بالمطالبة') + '</span>'
      : 'أضف تذكيرًا بالمطالبة';
    $('remind-wa').hidden = !(has && normalizePhone(c.phone) && e.balance > 0);
    $('remind-sms').hidden = $('remind-wa').hidden;
    $('remind-ask').hidden = $('remind-wa').hidden;
    $('remind-done').hidden = !has;
  }

  var remindId = null;
  function localInput(d) {   // ← قيمة حقل datetime-local بالتوقيت المحلي
    return d.getFullYear() + '-' + two(d.getMonth() + 1) + '-' + two(d.getDate()) +
      'T' + two(d.getHours()) + ':' + two(d.getMinutes());
  }
  function daysFromNow(n) {
    var d = new Date();
    d.setDate(d.getDate() + n);
    d.setHours(9, 0, 0, 0);
    return d;
  }
  function openRemind(id) {
    var e = entry(id);
    if (!e) return;
    remindId = id;
    $('remind-title').textContent = 'تذكير عن ' + e.c.name;
    $('remind-at').value = localInput(e.c.remindAt ? new Date(e.c.remindAt) : daysFromNow(1));
    $('remind-msg').value = e.c.remindText ||
      ('طالب ' + e.c.name + ' بالسداد' + (e.balance > 0 ? ' (' + fmt(e.balance) + ' ' + S.currency + ')' : ''));
    $('remind-clear').hidden = !e.c.remindAt;
    $('remind-hint').textContent = Native.isNative && !Native.isDesktop
      ? 'يصلك إشعار على الجوال في الموعد، ويظهر في أعلى الشاشة الرئيسية.'
      : 'يظهر التذكير في أعلى الشاشة الرئيسية حين تفتح التطبيق في موعده أو بعده.';
    pushOverlay('remind');
  }
  $('remind-open').addEventListener('click', function () { openRemind(currentView().id); });
  $('remind-quick').addEventListener('click', function (ev) {
    var b = ev.target.closest('.chip');
    if (b) $('remind-at').value = localInput(daysFromNow(Number(b.dataset.days)));
  });
  $('remind-form').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var d = new Date($('remind-at').value);
    if (isNaN(d.getTime())) { $('remind-at').focus(); return; }
    var id = remindId;
    DB.setReminder(id, d.toISOString(), $('remind-msg').value.trim())
      .then(loadData)
      .then(function () { return ensureNotifPermission(); })
      .then(function () { goBack(); });
  });
  $('remind-clear').addEventListener('click', function () {
    DB.setReminder(remindId, '', '').then(loadData).then(function () { goBack(); });
  });
  $('remind-cancel').addEventListener('click', goBack);
  $('remind').querySelector('.sheet-backdrop').addEventListener('click', goBack);
  $('remind-done').addEventListener('click', function () {
    DB.setReminder(currentView().id, '', '').then(loadData).then(render);
  });
  // رسالة تذكير مهذبة للزبون نفسه عبر واتساب أو SMS
  function reminderText(e) {
    return 'مرحبًا ' + e.c.name + '،\nتذكير لطيف من ' + S.shopName + ': رصيدك المستحق ' +
      fmt(e.balance) + ' ' + S.currency + '.\nشكرًا لتعاملك معنا.';
  }
  $('remind-wa').addEventListener('click', function () {
    var e = entry(currentView().id);
    if (e) openWhatsApp(normalizePhone(e.c.phone), reminderText(e));
  });
  $('remind-sms').addEventListener('click', function () {
    var e = entry(currentView().id);
    if (e) openSms(normalizePhone(e.c.phone), reminderText(e));
  });
  $('btn-debt').addEventListener('click', function () { openNumpad('debt'); });
  $('btn-pay').addEventListener('click', function () { openNumpad('payment'); });
  $('cust-edit').addEventListener('click', function () { openEditCustomer(currentView().id); });
  $('btn-send').addEventListener('click', function () { sendStatement(currentView().id); });
  // SMS مباشرة من صفحة الزبون: كشف الحساب نصًا إلى تطبيق الرسائل (بلا رقم: نطلبه أولًا)
  $('btn-sms').addEventListener('click', function smsFor() {
    var id = currentView().id, e = entry(id);
    if (!e) return;
    var phone = normalizePhone(e.c.phone);
    if (!phone) {
      openEditCustomer(id, {
        msg: 'أضف رقم الزبون لإرسال كشف الحساب برسالة SMS.',
        focusPhone: true,
        after: function () { smsFor(); }
      });
      return;
    }
    openSms(phone, buildStatement(e));
  });

  // الضغط على الحركة يفتحها للتعديل؛ الحذف من داخل شيت التعديل
  $('tx-list').addEventListener('click', function (ev) {
    var b = ev.target.closest('.tx');
    if (b) openEditTx(Number(b.dataset.id));
  });
  $('numpad-delete').addEventListener('click', function () {
    var id = np.editId;
    goBackThen(function () { confirmDeleteTx(id); });
  });

  function flashBalance() {
    var b = $('balance-block');
    b.classList.remove('pop');
    void b.offsetWidth;
    b.classList.add('pop');
  }

  function openEditTx(id) {
    for (var i = 0; i < S.tx.length; i++) {
      if (S.tx[i].id === id) { openNumpad(S.tx[i].type, S.tx[i]); return; }
    }
  }

  function confirmDeleteTx(id) {
    var t = null;
    for (var i = 0; i < S.tx.length; i++) if (S.tx[i].id === id) { t = S.tx[i]; break; }
    if (!t) return;
    ask({
      title: (t.type === 'debt' ? 'حذف دين ' : 'حذف دفعة ') + fmt(t.amount) + ' ' + S.currency + '؟',
      msg: 'سيُحذف هذا السجل من دفتر الزبون ويتغير الرصيد. لا يمكن التراجع.',
      ok: 'احذف الحركة',
      danger: true
    }).then(function (yes) {
      if (!yes) return;
      return DB.deleteTransaction(id).then(loadData).then(function () {
        render();
        flashBalance();
      });
    });
  }

  /* ---------------- 3. تسجيل دين أو دفعة (شيت) ----------------
     مبالغ صحيحة فقط: لا فاصلة عشرية، ومفتاح 00 بدلًا منها. */
  var MAX_DIGITS = 7;
  var np = { type: 'debt', customerId: null, buf: '', editId: null };

  // tx: حركة موجودة للتعديل (اختياري) — يُفتح الشيت بمبلغها وملاحظتها
  function openNumpad(type, tx) {
    var v = currentView();
    if (v.n !== 'customer') return;
    np.type = type;
    np.customerId = v.id;
    np.editId = tx ? tx.id : null;
    np.buf = tx ? String(Math.round(tx.amount)) : '';
    var e = entry(v.id);
    $('numpad-title').textContent = (tx ? 'تعديل ' : 'تسجيل ') + (type === 'debt' ? 'دين' : 'دفعة');
    $('numpad-for').textContent = e ? e.c.name : '';
    $('numpad-cur').textContent = S.currency;
    $('numpad-notefield').value = tx ? (tx.note || '') : '';
    // تاريخ الحركة: اليوم افتراضيًا، أو تاريخها عند التعديل؛ لا تاريخ في المستقبل
    np.origDate = tx ? tx.date : null;
    $('numpad-date').max = ymd();
    $('numpad-date').value = ymd(tx ? new Date(tx.date) : new Date());
    paintNumpadDate();
    $('numpad-delete').hidden = !tx;
    $('amount-display').className = 'amount-display ' + type;
    paintNumpad();
    pushOverlay('numpad');
  }

  function paintNumpadDate() {
    var d = parseYmd($('numpad-date').value);
    var label = d ? dayLabel(d.toISOString()) : 'اليوم';
    $('numpad-date-label').textContent = label;
    $('numpad-date').parentNode.classList.toggle('past', label !== 'اليوم');
  }
  $('numpad-date').addEventListener('change', function () {
    if (!$('numpad-date').value || $('numpad-date').value > ymd()) $('numpad-date').value = ymd();
    paintNumpadDate();
  });

  // التاريخ الذي يُحفظ: لم يتغيّر اليوم ← null (الآن، أو تاريخ الحركة الأصلي عند التعديل).
  // يوم آخر ← ذلك اليوم بنفس ساعة الحركة (أو ساعة الآن) ليبقى ترتيب حركات اليوم صحيحًا
  function numpadDate() {
    var picked = $('numpad-date').value;
    var base = np.origDate ? new Date(np.origDate) : new Date();
    if (!picked || picked === ymd(base)) return null;
    var d = parseYmd(picked);
    d.setHours(base.getHours(), base.getMinutes(), base.getSeconds(), base.getMilliseconds());
    return d.toISOString();
  }

  function amountValue() { return parseInt(np.buf || '0', 10) || 0; }

  function paintNumpad() {
    var amount = amountValue();
    $('numpad-value').textContent = fmt(amount);
    var btn = $('numpad-confirm');
    btn.className = 'btn btn-lg full ' + (np.type === 'debt' ? 'btn-debt' : 'btn-pay-solid');
    btn.textContent = np.editId != null ? 'احفظ التعديل'
      : (np.type === 'debt' ? 'أضف الدين' : 'أضف الدفعة');
    btn.disabled = amount <= 0;
  }

  function pressKey(k) {
    if (k === 'back') {
      np.buf = np.buf.slice(0, -1);
    } else {
      if (np.buf.length + k.length > MAX_DIGITS) return;
      np.buf = (np.buf + k).replace(/^0+(?=\d)/, '');
    }
    paintNumpad();
  }

  $('keys').addEventListener('click', function (ev) {
    var b = ev.target.closest('.key');
    if (b) pressKey(b.dataset.k);
  });

  $('quick').addEventListener('click', function (ev) {
    var b = ev.target.closest('.quick-btn');
    if (!b) return;
    np.buf = String(Math.min(9999999, amountValue() + Number(b.dataset.add)));
    paintNumpad();
  });

  $('numpad').querySelector('.sheet-backdrop').addEventListener('click', goBack);

  $('numpad-confirm').addEventListener('click', function () {
    var amount = amountValue();
    if (amount <= 0) return;
    var note = $('numpad-notefield').value.trim();
    var cid = np.customerId;
    $('numpad-confirm').disabled = true;
    (np.editId != null
      ? DB.updateTransaction(np.editId, amount, note, numpadDate())
      : DB.addTransaction(cid, np.type, amount, note, numpadDate()))
      .then(loadData)
      .then(function () {
        goBackThen(function () { flashBalance(); });
      })
      .catch(function () { $('numpad-confirm').disabled = false; });
  });

  /* ---------------- ورقة الزبون (إضافة/تعديل) ---------------- */
  var sheetMode = 'new';
  var sheetId = null;
  var sheetAfter = null;

  function openSheet(opts) {
    sheetMode = opts.mode;
    sheetId = opts.id || null;
    sheetAfter = opts.after || null;
    $('sheet-title').textContent = opts.title;
    $('sheet-name').value = opts.name || '';
    $('sheet-note').value = opts.note || '';
    var sp = splitPhone(opts.phone);
    $('sheet-cc').value = codeInfo(sp.cc) ? sp.cc : DEFAULT_COUNTRY_CODE;
    $('sheet-phone').value = sp.local;
    paintPhoneHint();
    $('sheet-err').hidden = true;
    $('sheet-delete').hidden = opts.mode !== 'edit';
    $('sheet-msg').hidden = !opts.msg;
    if (opts.msg) $('sheet-msg').textContent = opts.msg;
    pushOverlay('sheet');
    setTimeout(function () {
      (opts.focusPhone ? $('sheet-phone') : opts.focusNote ? $('sheet-note') : $('sheet-name')).focus();
    }, 120);
  }

  function openNewCustomer() {
    if (!canAdd(1)) { openActivation(); return; }
    openSheet({ mode: 'new', title: 'زبون جديد' });
  }

  function openEditCustomer(id, opts) {
    var e = entry(id);
    if (!e) return;
    opts = opts || {};
    openSheet({
      mode: 'edit',
      id: id,
      title: 'تعديل بيانات الزبون',
      name: e.c.name,
      phone: e.c.phone,
      note: e.c.note,
      focusNote: !!opts.focusNote,
      msg: opts.msg,
      focusPhone: !!opts.focusPhone,
      after: opts.after
    });
  }

  $('sheet-form').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var name = $('sheet-name').value.trim();
    if (!name) {
      $('sheet-err').textContent = 'اكتب اسم الزبون';
      $('sheet-err').hidden = false;
      $('sheet-name').focus();
      return;
    }
    // لا زبونان بنفس الاسم: يختلط الحساب عند البحث والإرسال
    var twin = null;
    S.customers.forEach(function (c) { if (c.id !== sheetId && norm(c.name) === norm(name)) twin = c; });
    if (twin) {
      $('sheet-err').textContent = 'يوجد زبون باسم «' + twin.name + '». أضف ما يميّزه: اسم العائلة أو الحي أو المهنة.';
      $('sheet-err').hidden = false;
      $('sheet-name').focus();
      return;
    }
    var pr = readPhone();
    if (!pr.ok) {
      paintPhoneHint();
      $('sheet-phone').focus();
      return;
    }
    var phone = pr.phone;
    var note = $('sheet-note').value.trim();
    var after = sheetAfter;
    var id = sheetId;
    var p;
    if (sheetMode === 'new') {
      p = DB.addCustomer(name, phone, note).then(function (newId) {
        return loadData().then(function () {
          // ورقة الإضافة تتحوّل إلى بطاقة الزبون ليسجّل أول دين فورًا
          replaceTop({ t: 'view', n: 'customer', id: newId });
          $('cust-scroll').scrollTop = 0;
        });
      });
    } else {
      p = DB.updateCustomer(id, name, phone, note).then(loadData).then(function () {
        goBackThen(function () { if (after) after(id); });
      });
    }
    p.catch(function () {});
  });

  $('sheet-cancel').addEventListener('click', goBack);
  $('sheet').querySelector('.sheet-backdrop').addEventListener('click', goBack);

  $('sheet-delete').addEventListener('click', function () {
    var id = sheetId;
    var e = entry(id);
    if (!e) return;
    ask({
      title: 'حذف الزبون؟',
      msg: 'سيُحذف «' + e.c.name + '» مع كل حركاته (' + e.tx.length + '). لا يمكن التراجع.',
      ok: 'احذف',
      danger: true
    }).then(function (yes) {
      if (!yes) return;
      return confirmIdentity().then(function (pass) {
        if (!pass) return alertBox('لم يُحذف الزبون', 'الحذف يحتاج تأكيد البصمة أو رمز قفل الجوال.');
        return DB.deleteCustomer(id).then(loadData).then(resetToHome);
      });
    });
  });

  /* ---------------- رقم واتساب: مقدمة الدولة + الرقم ----------------
     يُحفظ الرقم دوليًا كاملًا (+970599123456) حتى يصل كشف الحساب لواتساب الصحيح.
     local: طول الرقم بعد المقدمة، و start: بماذا يبدأ (للأرقام المعروفة). */
  var PHONE_CODES = [
    { cc: '970', name: 'فلسطين', len: [9], start: /^5[69]/, example: '599 123 456' },
    { cc: '972', name: 'الداخل', len: [9], start: /^5/, example: '501 234 567' },
    { cc: '20', name: 'مصر', len: [10], start: /^1/, example: '100 123 4567' },
    { cc: '962', name: 'الأردن', len: [9], start: /^7/, example: '790 123 456' },
    { cc: '966', name: 'السعودية', len: [9], start: /^5/, example: '501 234 567' },
    { cc: '971', name: 'الإمارات', len: [9], start: /^5/, example: '501 234 567' },
    { cc: '974', name: 'قطر', len: [8], start: /^[3-7]/, example: '3312 3456' },
    { cc: '90', name: 'تركيا', len: [10], start: /^5/, example: '501 234 5678' }
  ];

  $('sheet-cc').innerHTML = PHONE_CODES.map(function (p) {
    // المقدمة وحدها في القائمة: خلط العربي مع «+970» داخل قائمة منسدلة يقلب الإشارة
    // في بعض المتصفحات. اسم الدولة يظهر في السطر تحت الحقل.
    return '<option value="' + p.cc + '">+' + p.cc + '</option>';
  }).join('');

  function codeInfo(cc) {
    for (var i = 0; i < PHONE_CODES.length; i++) if (PHONE_CODES[i].cc === cc) return PHONE_CODES[i];
    return null;
  }

  // رقم محفوظ (قديم محلي أو دولي) ← {cc, local} لتعبئة الحقلين
  function splitPhone(stored) {
    var d = normalizePhone(stored);
    if (!d) return { cc: DEFAULT_COUNTRY_CODE, local: '' };
    for (var i = 0; i < PHONE_CODES.length; i++) {
      if (d.indexOf(PHONE_CODES[i].cc) === 0) return { cc: PHONE_CODES[i].cc, local: d.slice(PHONE_CODES[i].cc.length) };
    }
    return { cc: DEFAULT_COUNTRY_CODE, local: d };
  }

  // يقرأ الحقلين ويعيد {ok, phone:'+970…', msg}. الحقل الفارغ مقبول (الرقم اختياري).
  function readPhone() {
    var raw = $('sheet-phone').value.trim();
    var cc = $('sheet-cc').value;
    if (!raw) return { ok: true, phone: '' };
    // لصق رقم دولي كامل (+970… أو 00970…): نأخذ المقدمة منه
    var digits = raw.replace(/\D/g, '');
    if (/^\+|^00/.test(raw)) {
      digits = digits.replace(/^00/, '');
      for (var i = 0; i < PHONE_CODES.length; i++) {
        if (digits.indexOf(PHONE_CODES[i].cc) === 0) { cc = PHONE_CODES[i].cc; digits = digits.slice(cc.length); break; }
      }
    }
    var local = digits.replace(/^0+/, '');   // 0599… ← 599…
    var info = codeInfo(cc);
    var ok = info && info.len.indexOf(local.length) !== -1 && info.start.test(local);
    return ok
      ? { ok: true, phone: '+' + cc + local, cc: cc, local: local }
      : { ok: false, cc: cc, msg: info
          ? 'رقم غير صحيح لـ +' + cc + ' (' + info.name + '). مثال: ' + info.example
          : 'رقم غير صحيح' };
  }

  function paintPhoneHint() {
    var r = readPhone();
    var hint = $('sheet-phone-hint');
    if (r.cc && r.cc !== $('sheet-cc').value) $('sheet-cc').value = r.cc;
    var info = codeInfo($('sheet-cc').value);
    if (!$('sheet-phone').value.trim()) {
      hint.className = 'field-hint';
      hint.textContent = info ? info.name + ' — مثال: ' + info.example : '';
      return;
    }
    hint.className = 'field-hint ' + (r.ok ? 'ok' : 'bad');
    hint.textContent = r.ok ? '✓ ' + info.name + ' — سيصل كشف الحساب إلى واتساب ‎' + r.phone : r.msg;
  }
  $('sheet-phone').addEventListener('input', paintPhoneHint);
  $('sheet-cc').addEventListener('change', paintPhoneHint);

  /* ---------------- كشف الحساب عبر واتساب ---------------- */
  // "0599123456" ← رقم محلي  →  "970599123456"
  // "+972501234567" أو "00972…" ← رقم دولي يبقى كما هو
  function normalizePhone(raw) {
    var s = String(raw || '').trim();
    var intl = /^\+/.test(s);
    var d = s.replace(/\D/g, '');
    if (!d) return '';
    if (!intl && d.indexOf('00') === 0) { d = d.slice(2); intl = true; }  // بادئة الاتصال الدولي
    if (intl) {
      d = d.replace(/^0+/, '');
      if (d.indexOf(DEFAULT_COUNTRY_CODE) === 0 || d.length >= 10) return d;
      return DEFAULT_COUNTRY_CODE + d;
    }
    if (d.indexOf(DEFAULT_COUNTRY_CODE) === 0) return d;
    d = d.replace(/^0+/, '');
    if (d.length >= 11) return d;               // يبدو أنه يحمل رمز دولة أصلًا
    return DEFAULT_COUNTRY_CODE + d;
  }

  var STATEMENT_LINES = 6;      // في المعاينة
  var STATEMENT_MSG_LINES = 25; // في رسالة واتساب / SMS؛ الكشف الكامل في PDF

  /* فترة الكشف: الكل، آخر 7 أيام، آخر 30 يومًا، أو من تاريخ إلى تاريخ.
     الكشف لفترة يبدأ بـ«رصيد سابق» (كل ما قبل الفترة)، وينتهي برصيد آخر الفترة. */
  var stPeriod = { kind: 'all', from: '', to: '' };

  function dayStart(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
  function parseYmd(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
    return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
  }

  // {from, to}: بداية اليوم الأول ونهاية اليوم الأخير (بتوقيت الجوال)، أو null بلا حد
  function periodBounds() {
    var today = dayStart(new Date());
    var from = null, to = null;
    if (stPeriod.kind === '7' || stPeriod.kind === '30') {
      from = new Date(today.getTime());
      from.setDate(from.getDate() - (+stPeriod.kind - 1));
    } else if (stPeriod.kind === 'custom') {
      from = parseYmd(stPeriod.from);
      to = parseYmd(stPeriod.to);
      if (from && to && from > to) { var x = from; from = to; to = x; }
      if (to) { to = new Date(to.getTime()); to.setDate(to.getDate() + 1); }   // حتى نهاية اليوم
      if (to && to > today) to = null;   // حتى اليوم = حتى الآن
    }
    return { from: from, to: to };
  }

  // حركات الفترة (الأحدث أولًا) مع الرصيد السابق ورصيد آخر الفترة
  function statementData(e) {
    var r = periodBounds();
    var opening = 0, closing = 0, debts = 0, payments = 0, tx = [];
    e.tx.forEach(function (t) {
      var d = new Date(t.date), v = t.type === 'debt' ? t.amount : -t.amount;
      if (r.to && d >= r.to) return;
      closing += v;
      if (r.from && d < r.from) { opening += v; return; }
      tx.push(t);
      if (t.type === 'debt') debts += t.amount; else payments += t.amount;
    });
    var lastDay = r.to ? new Date(r.to.getTime() - 1) : null;
    return {
      tx: tx,
      all: !r.from && !r.to,
      opening: round2(opening),
      closing: round2(closing),
      debts: round2(debts),
      payments: round2(payments),
      fromLabel: r.from ? fmtDate(r.from.toISOString()) : '',
      toLabel: lastDay ? fmtDate(lastDay.toISOString()) : '',
      label: periodLabel(r, lastDay),
      ended: !!r.to   // الفترة تنتهي قبل اليوم: الرصيد رصيد ذلك اليوم لا الرصيد الحالي
    };
  }
  function periodLabel(r, lastDay) {
    if (!r.from && !r.to) return 'كل الحركات';
    if (stPeriod.kind === '7') return 'آخر 7 أيام';
    if (stPeriod.kind === '30') return 'آخر 30 يومًا';
    var a = r.from ? fmtDate(r.from.toISOString()) : 'البداية';
    var b = lastDay ? fmtDate(lastDay.toISOString()) : fmtDate(new Date().toISOString());
    return 'من ' + a + ' إلى ' + b;
  }

  function txLine(t) {
    return {
      when: fmtDate(t.date),
      what: (t.type === 'debt' ? 'دين' : 'دفعة') + (t.note ? ' · ' + t.note : ''),
      amount: (t.type === 'debt' ? '+' : '−') + fmt(t.amount),
      type: t.type
    };
  }
  function balanceLabel(d, v) {
    if (d.ended) return 'الرصيد في ' + d.toLabel;
    return v > 0 ? 'الرصيد المستحق' : (v < 0 ? 'رصيد لصالح الزبون' : 'الحساب');
  }

  function buildStatement(e) {
    var d = statementData(e);
    var L = [];
    L.push(S.shopName + ' — كشف حساب');
    L.push('');
    L.push('الزبون: ' + e.c.name);
    if (!d.all) L.push('الفترة: ' + d.label);
    L.push('');
    if (!d.all && d.opening) L.push('رصيد سابق: ' + fmt(d.opening) + ' ' + S.currency);
    if (!d.tx.length) {
      L.push(d.all ? 'لا توجد حركات.' : 'لا توجد حركات في هذه الفترة.');
    } else {
      d.tx.slice(0, STATEMENT_MSG_LINES).map(txLine).forEach(function (l) {
        L.push('• ' + l.when + ' — ' + l.what + ' — ' + l.amount + ' ' + S.currency);
      });
      var more = d.tx.length - STATEMENT_MSG_LINES;
      if (more > 0) L.push('… و' + more + ' حركة أقدم (الكشف الكامل في ملف PDF)');
    }
    L.push('');
    var v = d.closing;
    if (d.ended) L.push(balanceLabel(d, v) + ': ' + fmt(v) + ' ' + S.currency);
    else if (v > 0) L.push('الرصيد المستحق: ' + fmt(v) + ' ' + S.currency);
    else if (v < 0) L.push('رصيد لك: ' + fmt(-v) + ' ' + S.currency);
    else L.push('الرصيد: 0 ' + S.currency + ' — سدّد بالكامل، شكرًا لك.');
    L.push('التاريخ: ' + fmtDate(new Date().toISOString()));
    return L.join('\n');
  }

  var stId = null;

  function openStatement(id) {
    var e = entry(id);
    if (!e) return;
    stId = id;
    $('st-shop').textContent = S.shopName + ' — كشف حساب';
    $('st-to').textContent = e.c.name;

    paintPeriod();
    renderStatementBody(e);

    var phone = normalizePhone(e.c.phone);
    $('st-target').textContent = phone
      ? 'واتساب: ‎+' + phone
      : 'لا يوجد رقم واتساب لهذا الزبون — PDF يعمل بدونه.';
    $('st-send').lastChild.textContent = phone ? 'أرسل عبر واتساب' : 'أضف رقم الزبون للإرسال';
    $('st-sms').hidden = !phone;
    pushOverlay('statement');
  }

  function renderStatementBody(e) {
    var d = statementData(e);
    var rows = d.tx.slice(0, STATEMENT_LINES).map(txLine).map(function (l) {
      return '<div class="st-line">' +
        '<span class="st-when">' + esc(l.when) + '</span>' +
        '<span class="st-what">' + esc(l.what) + '</span>' +
        '<span class="st-amount ' + l.type + '">' + esc(l.amount) + '</span>' +
      '</div>';
    });
    var more = d.tx.length - STATEMENT_LINES;
    if (more > 0) rows.push('<div class="st-more">و' + more + ' حركة أقدم' + (d.all ? '' : ' في الفترة') + ' — كلها في ملف PDF</div>');
    if (!d.all && d.opening) {
      rows.push('<div class="st-line st-open"><span class="st-what">رصيد سابق' +
        (d.fromLabel ? ' (قبل ' + esc(d.fromLabel) + ')' : '') + '</span>' +
        '<span class="st-amount">' + esc(fmt(d.opening)) + '</span></div>');
    }
    $('st-lines').innerHTML = rows.length ? rows.join('')
      : '<div class="st-empty">' + (d.all ? 'لا توجد حركات بعد.' : 'لا توجد حركات في هذه الفترة.') + '</div>';

    var v = d.closing;
    var total = $('st-total-value').parentNode;
    total.className = 'st-total' + (v > 0 ? '' : (v < 0 ? ' credit' : ' settled'));
    $('st-total-label').textContent = balanceLabel(d, v);
    $('st-total-value').textContent = fmt(Math.abs(v));
  }

  function paintPeriod() {
    Array.prototype.forEach.call($('st-period').children, function (b) {
      var on = b.dataset.p === stPeriod.kind;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    $('st-range').hidden = stPeriod.kind !== 'custom';
    $('st-date-from').value = stPeriod.from;
    $('st-date-to').value = stPeriod.to;
    $('st-date-from').max = $('st-date-to').max = ymd();
  }
  $('st-period').addEventListener('click', function (ev) {
    var b = ev.target.closest('button');
    if (!b) return;
    stPeriod.kind = b.dataset.p;
    if (stPeriod.kind === 'custom' && !stPeriod.from && !stPeriod.to) {
      var now = new Date();
      stPeriod.from = ymd(new Date(now.getFullYear(), now.getMonth(), 1));   // من أول الشهر
      stPeriod.to = ymd(now);
    }
    paintPeriod();
    var e = entry(stId);
    if (e) renderStatementBody(e);
  });
  ['st-date-from', 'st-date-to'].forEach(function (id) {
    $(id).addEventListener('change', function () {
      stPeriod.from = $('st-date-from').value;
      stPeriod.to = $('st-date-to').value;
      var e = entry(stId);
      if (e) renderStatementBody(e);
    });
  });

  $('st-cancel').addEventListener('click', goBack);
  $('statement').querySelector('.sheet-backdrop').addEventListener('click', goBack);

  $('st-send').addEventListener('click', function () {
    var e = entry(stId);
    if (!e) return;
    var phone = normalizePhone(e.c.phone);
    if (!phone) {
      var id = stId;
      goBackThen(function () {
        openEditCustomer(id, {
          msg: 'أضف رقم واتساب الزبون لإرسال كشف الحساب.',
          focusPhone: true,
          after: function (cid) { openStatement(cid); }
        });
      });
      return;
    }
    openWhatsApp(phone, buildStatement(e));
    goBack();
  });
  $('st-sms').addEventListener('click', function () {
    var e = entry(stId);
    if (!e) return;
    var phone = normalizePhone(e.c.phone);
    if (!phone) { $('st-send').click(); return; }   // نفس مسار «أضف رقمًا»
    openSms(phone, buildStatement(e));
    goBack();
  });

  // رسالة SMS عادية (لمن لا يستخدم واتساب أو بلا إنترنت). phone: أرقام دولية بلا +
  function openSms(phone, text) {
    window.location.href = 'sms:+' + phone + (isIOS() ? '&' : '?') + 'body=' + encodeURIComponent(text);
  }

  function openWhatsApp(phone, text) {
    var url = 'https://wa.me/' + phone + '?text=' + encodeURIComponent(text);
    // داخل التطبيق يفتح Capacitor الرابط في واتساب مباشرة
    var w = Native.isNative ? null : window.open(url, '_blank', 'noopener');
    if (!w) window.location.href = url;
  }

  // زر «كشف الحساب» في صفحة الزبون: المعاينة دائمًا (PDF لا يحتاج رقمًا، وواتساب يطلبه هناك)
  function sendStatement(id) { openStatement(id); }

  // كشف الحساب PDF: كل الحركات، مع الرصيد بعد كل حركة
  $('st-pdf').addEventListener('click', function () {
    var e = entry(stId);
    if (!e) return;
    var btn = $('st-pdf');
    btn.disabled = true;
    var phone = normalizePhone(e.c.phone);
    var d = statementData(e);
    StatementPdf.make({
      shop: S.shopName, currency: S.currency, name: e.c.name, phone: phone ? '+' + phone : '', logo: S.logo,
      tx: d.tx.slice().reverse(), fmtNum: fmt, fmtDate: fmtDate,
      period: d.all ? '' : d.label, opening: d.all ? 0 : d.opening,
      openingDate: d.fromLabel, endLabel: d.ended ? balanceLabel(d, d.closing) : ''
    }).then(function (bytes) {
      btn.disabled = false;
      var safe = String(e.c.name).replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'زبون';
      return deliverFile({
        name: 'كشف حساب - ' + safe + ' - ' + ymd() + '.pdf',
        downloadName: 'daftara-statement-' + ymd() + '.pdf',
        mime: 'application/pdf',
        bytes: bytes,
        title: 'كشف حساب PDF',
        msg: 'كشف حساب «' + e.c.name + '» جاهز. ماذا تريد أن تفعل به؟',
        saveLabel: 'احفظه في مكان تختاره',
        sendLabel: 'أرسله (واتساب وغيره)'
      });
    }).catch(function () {
      btn.disabled = false;
      alertBox('تعذّر إنشاء الملف', 'لم نستطع إنشاء كشف PDF. حاول مرة أخرى.');
    });
  });

  /* ---------------- 6. الإعدادات (شيت) ---------------- */
  function openSettings() {
    $('set-shop').value = S.shopName;
    fillCurrencySelect($('set-currency'), S.currency);
    $('info-count').textContent = fmt(S.customers.length);
    $('info-total').textContent = S.showTotal ? fmt(totalOwed()) + ' ' + S.currency : '••••';
    $('info-backup').textContent = backupAgo();
    if (Native.isDesktop) {
      var ad = Native.auto;
      $('persist-note').textContent = !ad
        ? 'نسخة تلقائية تُحفظ في الحاسوب (Documents\\Daftara) بعد كل تعديل.'
        : ad.error
          ? 'تعذّر حفظ النسخة التلقائية في الحاسوب: ' + ad.error
          : 'آخر نسخة تلقائية: ' + fmtDateTime(ad.at) + ' — في ' + ad.file +
            '. للحماية من تعطّل الحاسوب احفظ نسخة على فلاشة أو أرسلها إلى واتساب.';
      $('btn-persist').hidden = true;
    } else if (Native.isNative) {
      var a = Native.auto;
      $('persist-note').textContent = !a
        ? 'نسخة تلقائية تُحفظ في ذاكرة الجوال (Documents/Daftara) بعد كل تعديل.'
        : a.error
          ? 'تعذّر حفظ النسخة التلقائية في ذاكرة الجوال: ' + a.error
          : 'آخر نسخة تلقائية: ' + fmtDateTime(a.at) + ' — في ' + a.file +
            '. تبقى حتى لو حُذف التطبيق. للحماية من ضياع الجوال أرسل نسخة إلى واتساب.';
      $('btn-persist').hidden = true;
    } else {
      $('persist-note').textContent = S.persistGranted
        ? 'حماية التخزين مفعّلة — لن يمسح المتصفح دفترك تلقائيًا.'
        : 'حماية التخزين غير مفعّلة. قد يمسح المتصفح البيانات عند امتلاء الذاكرة، فاحفظ نسخة بانتظام.';
      $('btn-persist').hidden = S.persistGranted;
    }
    renderLockSetting();
    renderLicenseSetting();
    renderSyncSetting();
    renderLogoSetting();
    $('set-theme').value = currentTheme();
    paintThemeSeg();
    $('late-alert-box').hidden = !Native.isNative || Native.isDesktop;   // إشعارات الجوال
    $('set-late-alert').value = String(S.lateAlert);
    renderNotifNote();
    pushOverlay('settings');
  }

  // «اليوم» / «أمس» / «قبل 5 أيام» — قصيرة لتتسع في مربع الإحصاءات
  function backupAgo() {
    if (!S.lastBackupAt) return 'لا يوجد';
    var d = daysSince(S.lastBackupAt);
    return d === 0 ? 'اليوم' : d === 1 ? 'أمس' : 'قبل ' + d + ' يوم';
  }

  // الاسم والعملة يُحفظان عند تغييرهما؛ «تم» يغلق فقط (ويحفظ أيضًا عبر submit)
  function saveShop() {
    var name = $('set-shop').value.trim();
    if (name) S.shopName = name;
    S.currency = $('set-currency').value || DEFAULT_CURRENCY;
    return Promise.all([DB.setSetting('shopName', S.shopName), DB.setSetting('currency', S.currency)]);
  }
  $('set-shop').addEventListener('change', saveShop);
  $('set-currency').addEventListener('change', saveShop);
  $('settings').querySelector('.sheet-backdrop').addEventListener('click', goBack);

  $('settings-form').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var name = $('set-shop').value.trim();
    if (name) S.shopName = name;
    S.currency = $('set-currency').value || DEFAULT_CURRENCY;
    Promise.all([
      DB.setSetting('shopName', S.shopName),
      DB.setSetting('currency', S.currency)
    ]).then(function () { goBack(); });
  });

  $('btn-persist').addEventListener('click', function () {
    requestPersist().then(function (granted) {
      $('persist-note').textContent = granted
        ? 'حماية التخزين مفعّلة — لن يمسح المتصفح دفترك تلقائيًا.'
        : 'المتصفح لم يفعّل الحماية. أضف التطبيق إلى الشاشة الرئيسية واحفظ نسخة بانتظام.';
      $('btn-persist').hidden = granted;
    });
  });

  /* ---------------- القفل بالبصمة (تطبيق أندرويد) ---------------- */
  var LOCK_AFTER_MS = 60 * 1000;   // يُقفل التطبيق إن بقي في الخلفية أكثر من دقيقة
  var locking = null;

  // يعرض شاشة القفل حتى ينجح التحقق. إن لم يعد في الجوال بصمة ولا رمز قفل
  // (أو استُعيدت نسخة من جوال آخر) لا نقفل، حتى لا يُحبس صاحب المحل خارج دفتره.
  function unlock() {
    if (locking) return locking;
    locking = Native.canLock().then(function (ok) {
      if (!ok) { $('screen-lock').hidden = true; return; }
      $('screen-lock').hidden = false;
      return new Promise(function (resolve) {
        function attempt() {
          Native.verify().then(function (pass) {
            if (!pass) return;
            $('screen-lock').hidden = true;
            $('lock-open').onclick = null;
            resolve();
          });
        }
        $('lock-open').onclick = attempt;
        attempt();
      });
    }).then(function () { locking = null; });
    return locking;
  }

  // تأكيد الهوية قبل الأفعال التي لا رجعة فيها (حذف زبون، استبدال الدفتر).
  // في المتصفح، أو جوال بلا بصمة ولا رمز قفل، يكفي مربع التأكيد.
  function confirmIdentity() {
    if (!Native.isNative) return Promise.resolve(true);
    return Native.canLock().then(function (ok) { return ok ? Native.verify() : true; });
  }

  if (Native.onResume) {
    Native.onResume(function (awayMs) {
      if (S.lockEnabled && awayMs > LOCK_AFTER_MS) unlock();
      S.showTotal = false;
      if (S.started) render();
      onForeground();
    });
  }

  // صف «القفل بالبصمة» مع مفتاح تشغيل؛ يظهر في التطبيق فقط
  function renderLockSetting() {
    $('sec-box').hidden = !Native.isNative || Native.isDesktop;
    if ($('sec-box').hidden) return;
    Native.canLock().then(function (ok) {
      $('btn-lock').hidden = false;
      $('btn-lock').classList.toggle('disabled', !ok && !S.lockEnabled);
      $('lock-switch').classList.toggle('on', !!S.lockEnabled);
      $('lock-note').textContent = !ok
        ? 'أضف بصمة أو رمز قفل للجوال من إعداداته لتفعيله'
        : S.lockEnabled
          ? 'مفعّل: عند الفتح، وبعد دقيقة في الخلفية'
          : 'يطلب البصمة عند فتح التطبيق';
    });
  }

  // التفعيل والإيقاف كلاهما يحتاج البصمة: يتأكد أنها تعمل، ولا يوقفه غير صاحبها.
  // إن لم يعد في الجوال بصمة ولا رمز فالقفل معطّل فعليًا، فيُسمح بإيقافه مباشرة.
  $('btn-lock').addEventListener('click', function () {
    Native.canLock().then(function (ok) {
      return ok ? Native.verify() : S.lockEnabled;
    }).then(function (pass) {
      if (!pass) return;
      S.lockEnabled = !S.lockEnabled;
      return DB.setSetting('lockEnabled', S.lockEnabled).then(renderLockSetting);
    });
  });

  /* ---------------- شعار المحل (اختياري) ----------------
     يُصغَّر إلى 320 بكسل ويُحفظ صورةً داخل الإعدادات، فيدخل في النسخ الاحتياطية. */
  var LOGO_MAX = 320;
  function renderLogoSetting() {
    $('set-logo-img').hidden = !S.logo;
    if (S.logo) $('set-logo-img').src = S.logo;
    $('set-logo-del').hidden = !S.logo;
    $('logo-empty').hidden = !!S.logo;
  }
  $('set-logo-pick').addEventListener('click', function () { $('logo-file').click(); });
  $('logo-file').addEventListener('change', function () {
    var f = $('logo-file').files && $('logo-file').files[0];
    $('logo-file').value = '';
    if (!f) return;
    var url = URL.createObjectURL(f);
    var img = new Image();
    img.onload = function () {
      var k = Math.min(1, LOGO_MAX / Math.max(img.width, img.height));
      var c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(img.width * k));
      c.height = Math.max(1, Math.round(img.height * k));
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      S.logo = c.toDataURL('image/png');
      DB.setSetting('logo', S.logo).then(function () { renderLogoSetting(); });
    };
    img.onerror = function () { URL.revokeObjectURL(url); alertBox('صورة غير صالحة', 'اختر صورة بصيغة JPG أو PNG.'); };
    img.src = url;
  });
  $('set-logo-del').addEventListener('click', function () {
    S.logo = '';
    DB.setSetting('logo', '').then(renderLogoSetting);
  });

  /* ---------------- التفعيل الدائم (بلا إنترنت) — license.js ---------------- */
  // مفعّلة بكود MakeFlow (النسخة المباشرة) أو بشراء عبر Google Play (نسخة المتجر)
  function refreshLicense() {
    return License.deviceCode().then(function (dc) {
      S.deviceCode = dc;
      Sync.setDeviceCode(dc);
      S.codeOk = License.verify(S.licenseCode, dc);
    }, function () { S.codeOk = false; }).then(function () {
      S.licensed = true;   // دفترة الكاملة: زبائن بلا حدود
    });
  }
  // جهاز مربوط بدفتر فعّله جهاز آخر (المزامنة): التفعيل يشمله ما دام مربوطًا
  function syncLicensed() { return Sync.linked && Sync.licValid(S.syncLic); }

  // نسخة Google Play: حالة الشراء من متجر Play (يقرؤها المتجر من ذاكرته حتى بلا إنترنت).
  // تُحفظ آخر حالة مؤكدة، فلا يُقفل الدفتر إن تعذّر الوصول إلى المتجر.
  function checkPlay() {
    if (!Native.isPlay) return Promise.resolve(null);
    return Native.billingInfo().then(function (r) {
      if (r.price) S.playPrice = r.price;
      S.playPending = !!r.pending;
      if (r.ok) setPlayOwned(!!r.owned);   // owned=false مع ok: لم يُشترَ أو استُرجع المبلغ
      return r;
    });
  }
  function setPlayOwned(owned) {
    if (owned === S.playOwned) return;
    S.playOwned = owned;
    S.licensed = true;
    DB.setSetting('playOwned', owned);
    if (!$('settings').hidden) renderLicenseSetting();
  }
  // اكتمل الشراء (من زر الشراء، أو دفعة معلّقة اكتملت، أو «استعد الشراء»): مبروك مرة واحدة
  var playCelebrated = false;
  function onPlayOwned() {
    setPlayOwned(true);
    if (playCelebrated) return;
    playCelebrated = true;
    var show = function () {
      if (!$('settings').hidden) renderLicenseSetting();
      celebrate();
    };
    if (!$('activate').hidden) goBackThen(show); else show();
  }
  function celebrate() {
    alertBox('🎉 مبروك، دفترة مفعّلة!', 'التفعيل دائم مدى الحياة. أضف ما شئت من الزبائن، بلا حدود. شكرًا لاختيارك دفترة.', 'ابدأ');
  }
  if (Native.onPurchase) Native.onPurchase(function (r) { if (r && r.owned) onPlayOwned(); });
  function canAdd(n) { return true; }

  function renderLicenseSetting() {
    $('info-license').textContent = S.licensed
      ? '✓ دفترة مفعّلة مدى الحياة — زبائن بلا حدود'
      : 'النسخة المجانية — ' + S.customers.length + ' من ' + License.FREE_LIMIT + ' زبونًا';
    $('btn-activate').hidden = !!S.licensed;
    $('btn-activate').textContent = Native.isPlay
      ? 'احصل على دفترة الكاملة — ' + (S.playPrice || PLAY_PRICE) + ' مرة واحدة'
      : 'فعّل الآن — ' + License.PRICE + ' مرة واحدة مدى الحياة';
    $('lic-card').classList.toggle('done', !!S.licensed);
    $('lic-bar').hidden = !!S.licensed;
    $('lic-fill').style.width = Math.min(100, Math.round(100 * S.customers.length / License.FREE_LIMIT)) + '%';
  }

  function openActivation(msg) {
    // السعر والعرض ثابتان في أعلى الشيت؛ هنا سبب ظهوره، ثم ما يطمئن صاحب المحل
    $('act-msg').textContent = msg || ('وصلت إلى حد النسخة المجانية: ' + License.FREE_LIMIT + ' زبونًا.');
    // نسخة Google Play: شراء عبر المتجر بدل خطوات كود التفعيل
    var play = Native.isPlay;
    $('act-price').textContent = License.PRICE;
    $('act-steps').hidden = play;
    $('act-play').hidden = !play;
    if (play) {
      paintPlayOffer();
      $('act-buy-err').hidden = true;
      checkPlay().then(paintPlayOffer);   // السعر بعملة البلد، ودفعة معلّقة إن وُجدت
    }
    $('act-copy').lastChild.textContent = 'نسخ';
    // زر «الصق» فقط حيث يسمح الجهاز بقراءة الحافظة
    $('act-paste').hidden = !(navigator.clipboard && navigator.clipboard.readText);
    $('act-device').textContent = S.deviceCode || '—';
    $('act-code').value = '';
    $('act-err').hidden = true;
    pushOverlay('activate');
  }
  function activationRequest() {
    return 'السلام عليكم، أريد تفعيل دفترة الدائم (' + License.PRICE + '، زبائن بلا حدود).\nالمحل: ' + (S.shopName || '—') +
      '\nرقم الجهاز: ' + S.deviceCode + '\nعدد الزبائن: ' + S.customers.length;
  }
  $('btn-activate').addEventListener('click', function () { openActivation(); });
  $('act-wa').addEventListener('click', function () { openWhatsApp(License.OWNER_PHONE, activationRequest()); });
  $('act-copy').addEventListener('click', function () {
    var b = $('act-copy');
    var done = function () { b.lastChild.textContent = '✓ نُسخ'; };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(S.deviceCode || '').then(done, function () {});
    }
  });
  $('act-paste').addEventListener('click', function () {
    navigator.clipboard.readText().then(function (t) {
      if (t) { $('act-code').value = t; $('act-err').hidden = true; }
    }, function () {
      // لم يسمح الجهاز: نترك صاحب المحل يلصق يدويًا بالضغط المطوّل
      $('act-code').focus();
    });
  });

  $('act-go').addEventListener('click', function () {
    var code = License.extract($('act-code').value);
    var err = $('act-err');
    if (!code) { err.textContent = 'لم أجد كود التفعيل في النص. الصق الرسالة كاملة كما وصلتك.'; err.hidden = false; return; }
    if (!License.verify(code, S.deviceCode)) {
      err.textContent = 'هذا الكود لا يخص هذا الجهاز (' + S.deviceCode + '). تأكد أنك أرسلت رقم الجهاز الصحيح.';
      err.hidden = false;
      return;
    }
    S.licenseCode = code;
    S.licensed = true;
    // رسالة «الكاملة + المزامنة» لُصقت هنا: نفعّل المزامنة معها
    var syncCode = License.extractSync($('act-code').value);
    if (syncCode && License.verifySync(syncCode, S.deviceCode)) Sync.addPass(syncCode);
    DB.setSetting('license', code).then(function () {
      goBackThen(function () {
        if (!$('settings').hidden) renderLicenseSetting();
        celebrate();
      });
    });
  });
  /* نسخة Google Play */
  function paintPlayOffer() {
    $('act-price').textContent = S.playPrice || PLAY_PRICE;
    $('act-pending').hidden = !S.playPending;
  }
  function playError(r) {
    return 'تعذّر الوصول إلى Google Play. تأكد من اتصال الإنترنت ومن تسجيل الدخول إلى متجر Play، ثم حاول مرة أخرى.' +
      (r && r.code != null ? ' (رمز ' + r.code + ')' : '');
  }
  $('act-buy').addEventListener('click', function () {
    var b = $('act-buy'), err = $('act-buy-err');
    b.disabled = true;
    err.hidden = true;
    Native.buy().then(function (r) {
      b.disabled = false;
      if (r.owned) { onPlayOwned(); return; }
      if (r.cancelled) return;
      if (r.pending) { S.playPending = true; paintPlayOffer(); return; }
      err.textContent = playError(r);
      err.hidden = false;
    });
  });
  $('act-restore').addEventListener('click', function () {
    var err = $('act-buy-err');
    err.hidden = true;
    checkPlay().then(function (r) {
      if (r && r.owned) { onPlayOwned(); return; }
      paintPlayOffer();
      if (S.playPending) return;          // الملاحظة الظاهرة تكفي
      err.textContent = r && r.ok ? 'لم نجد شراءً لدفترة على حساب Google المسجّل في هذا الجوال.' : playError(r);
      err.hidden = false;
    });
  });

  // كود هدية من MakeFlow (أكواد ترويجية من Play Console): يُستخدم في متجر Play نفسه،
  // ثم يظهر شراءً عاديًا نلتقطه عند العودة إلى التطبيق
  $('act-gift').addEventListener('click', function () {
    window.location.href = 'https://play.google.com/redeem';
  });
  if (Native.isPlay && Native.onResume) {
    Native.onResume(function () {
      if (S.playOwned) return;
      checkPlay().then(function (r) { if (r && r.owned) onPlayOwned(); });
    });
  }

  $('act-cancel').addEventListener('click', goBack);
  $('activate').querySelector('.sheet-backdrop').addEventListener('click', goBack);

  /* ---------------- المظهر: تلقائي / فاتح / ليلي ---------------- */
  // يُحفظ في localStorage لأن index.html يقرؤه قبل أول رسم (بلا وميض أبيض ليلًا)
  function currentTheme() {
    try { return localStorage.getItem('daftara-theme') || 'auto'; } catch (e) { return 'auto'; }
  }
  function applyTheme(t) {
    try { localStorage.setItem('daftara-theme', t); } catch (e) {}
    if (t === 'auto') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = t;
    var dark = t === 'dark' || (t === 'auto' && window.matchMedia &&
      window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.querySelector('meta[name="theme-color"]').setAttribute('content', dark ? '#131816' : '#f3f2f2');
  }
  function isDark() {
    var t = currentTheme();
    return t === 'dark' || (t === 'auto' && window.matchMedia &&
      window.matchMedia('(prefers-color-scheme: dark)').matches);
  }
  function paintThemeToggle() {
    var dark = isDark();
    $('theme-toggle').classList.toggle('is-dark', dark);
    $('theme-toggle').setAttribute('aria-label', dark ? 'الوضع النهاري' : 'الوضع الليلي');
  }
  applyTheme(currentTheme());
  paintThemeToggle();
  $('set-theme').addEventListener('change', function () { applyTheme($('set-theme').value); paintThemeToggle(); paintThemeSeg(); });
  function paintThemeSeg() {
    var t = currentTheme();
    Array.prototype.forEach.call($('theme-seg').children, function (b) {
      b.classList.toggle('on', b.dataset.v === t);
      b.setAttribute('aria-checked', b.dataset.v === t ? 'true' : 'false');
    });
  }
  $('theme-seg').addEventListener('click', function (ev) {
    var b = ev.target.closest('button');
    if (!b) return;
    $('set-theme').value = b.dataset.v;
    $('set-theme').dispatchEvent(new Event('change'));
  });
  // زر الرئيسية: يقلب بين الفاتح والليلي (ويثبّت الاختيار بدل «تلقائي»)
  $('theme-toggle').addEventListener('click', function () {
    applyTheme(isDark() ? 'light' : 'dark');
    paintThemeToggle();
    paintThemeSeg();
  });

  /* ---------------- الإشعارات: التذكيرات والتنبيه اليومي بالمتأخرين ----------------
     كل شيء يُحسب على الجوال ويُجدول مسبقًا (بلا إنترنت): تذكير كل زبون في موعده،
     وتنبيه يومي للأيام السبعة القادمة بأسماء من سيكون متأخرًا في ذلك اليوم.
     يُعاد الجدول بعد كل تعديل وكلما فُتح التطبيق. */
  var notifTimer = null;
  function scheduleNotifSync() {
    if (!Native.syncNotifications) return;
    clearTimeout(notifTimer);
    notifTimer = setTimeout(syncNotifications, 1200);
  }

  function lateTitle(n) {
    return n === 1 ? 'زبون متأخر عن السداد' : n === 2 ? 'زبونان متأخران عن السداد' : n + ' زبائن متأخرون عن السداد';
  }

  function notificationPlan() {
    var out = [], now = Date.now();
    S.index.forEach(function (e) {
      if (!e.c.remindAt) return;
      var t = new Date(e.c.remindAt).getTime();
      if (t > now) out.push({ id: 100000 + e.c.id, title: '🔔 ' + e.c.name, body: e.c.remindText || 'تذكير بالمطالبة', at: t, extra: { customerId: e.c.id } });
    });
    if (S.lateAlert !== 'off' && S.shopName) {
      for (var d = 0; d < 7; d++) {
        var at = new Date();
        at.setDate(at.getDate() + d);
        at.setHours(Number(S.lateAlert), 0, 0, 0);
        if (at.getTime() <= now + 60000) continue;
        var late = [];
        S.index.forEach(function (e) { if (overdueDays(e, at.getTime()) >= OVERDUE_DAYS) late.push(e.c.name); });
        if (!late.length) continue;
        out.push({
          id: 900000 + d, title: 'دفترة — ' + lateTitle(late.length),
          body: late.slice(0, 4).join('، ') + (late.length > 4 ? ' و' + (late.length - 4) + ' غيرهم' : ''),
          at: at.getTime(), extra: { open: 'late' }
        });
      }
    }
    return out;
  }

  function syncNotifications() {
    return Native.notifGranted().then(function (ok) {
      if (!ok) return;
      return Native.syncNotifications(notificationPlan());
    }).catch(function () {});
  }

  // يطلب الإذن مرة (أول تذكير، أو أول تشغيل فيه متأخرون)، ثم يجدول
  function ensureNotifPermission() {
    if (!Native.requestNotif) return Promise.resolve(false);
    return Native.notifGranted().then(function (ok) {
      if (ok) return true;
      S.notifAsked = true;
      return DB.setSetting('notifAsked', true).then(Native.requestNotif);
    }).then(function (ok) { syncNotifications(); renderNotifNote(); return ok; })
      .catch(function () { return false; });
  }

  function renderNotifNote() {
    if (!Native.notifGranted) return;
    Native.notifGranted().then(function (ok) {
      $('notif-note').hidden = ok;
      $('notif-note').textContent = 'الإشعارات مغلقة لدفترة. فعّلها من إعدادات الجوال ← التطبيقات ← دفترة ← الإشعارات.';
    });
  }

  $('set-late-alert').addEventListener('change', function () {
    var v = $('set-late-alert').value;
    S.lateAlert = v === 'off' ? 'off' : Number(v);
    DB.setSetting('lateAlert', S.lateAlert).then(function () {
      return S.lateAlert === 'off' ? syncNotifications() : ensureNotifPermission();
    });
  });

  // الضغط على إشعار: تذكير ← صفحة الزبون، تنبيه المتأخرين ← قائمة المتأخرين
  var pendingTap = null;
  function handleNotifTap(extra) {
    if (!extra) return;
    if (!S.started) { pendingTap = extra; return; }
    pendingTap = null;
    $('search').value = '';
    resetToHome();
    if (extra.customerId && entry(extra.customerId)) pushView('customer', extra.customerId);
    else if (extra.open === 'late') { S.sort = 'late'; render(); }
  }
  if (Native.onNotificationTap) Native.onNotificationTap(handleNotifTap);

  /* ---------------- النسخ الاحتياطي والاستعادة ---------------- */
  function downloadBlob(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }

  // يسأل أين يذهب الملف: مكان يختاره صاحب المحل على الجوال، أو يُرسَل (واتساب...).
  // f: {name, mime, text | bytes, title, msg, saveLabel, sendLabel, cancel}
  // يعيد true إن حُفظ أو أُرسل، وnull إن ألغى.
  function deliverFile(f) {
    var blob = new Blob([f.bytes || f.text], { type: f.mime });
    var file = null;
    try { file = new File([blob], f.name, { type: f.mime }); } catch (e) { file = null; }
    var nativeFile = { name: f.name, mime: f.mime, title: f.title, text: f.bytes ? undefined : f.text,
                       base64: f.bytes ? StatementPdf.toBase64(f.bytes) : undefined };
    // الحاسوب: لا شاشة مشاركة؛ كشف PDF يُفتح في برنامج الجهاز للطباعة بدلًا منها
    var printable = Native.isDesktop && f.mime === 'application/pdf';
    var shareable = (Native.isNative && !Native.isDesktop) || !!(file && navigator.share && navigator.canShare &&
      navigator.canShare({ files: [file] }));

    function save() {
      // اسم التنزيل في المتصفح بحروف لاتينية: بعض المتصفحات تتجاهل الأسماء العربية
      if (!Native.isNative) { downloadBlob(blob, f.downloadName || f.name); return Promise.resolve(true); }
      return Native.saveAs(nativeFile).then(function (saved) { return saved || null; }, function () {
        alertBox('تعذّر الحفظ', 'لم نستطع الحفظ في هذا المكان. جرّب مكانًا آخر أو أرسل الملف.');
        return null;
      });
    }
    function send() {
      if (printable) {
        return Native.openFile(nativeFile).catch(function () {
          alertBox('تعذّر فتح الملف', 'لم نستطع فتح الكشف. احفظه ثم افتحه من مكانه.');
          return null;
        });
      }
      if (Native.isNative) {
        return Native.shareFile(nativeFile).catch(function () {
          alertBox('تعذّرت المشاركة', 'لم نستطع فتح شاشة المشاركة.');
          return null;
        });
      }
      return navigator.share({ files: [file], title: f.title })
        .then(function () { return true; })
        .catch(function (err) {
          if (err && err.name === 'AbortError') return null;   // ألغى المستخدم
          downloadBlob(blob, f.name);
          return true;
        });
    }

    return ask({
      title: f.title,
      msg: f.msg,
      ok: Native.isNative ? f.saveLabel : 'نزّله على الجهاز',
      alt: printable ? 'افتحه للطباعة' : (shareable ? f.sendLabel : ''),
      cancel: f.cancel || 'إلغاء'
    }).then(function (choice) {
      if (choice === true) return save();
      if (choice === 'alt') return send();
      return null;
    });
  }

  // opts: {title, msg, later} — later يجعل زر الإلغاء «لاحقًا»
  function doBackup(opts) {
    opts = opts || {};
    S.backupBusy = true;
    return DB.exportAll().then(function (data) {
      return deliverFile({
        name: 'daftara-backup-' + ymd() + '.json',
        mime: 'application/json',
        text: JSON.stringify(data, null, 2),
        title: opts.title || 'نسخة احتياطية',
        msg: opts.msg || 'أين تريد أن تحتفظ بالنسخة؟',
        saveLabel: 'احفظها في مكان تختاره',
        sendLabel: 'أرسلها (واتساب وغيره)',
        cancel: opts.later ? 'لاحقًا' : 'إلغاء'
      }).then(function (done) {
        if (done) return recordBackup();
      });
    }).then(function () { S.backupBusy = false; }, function () { S.backupBusy = false; });
  }
  function recordBackup() {
    var now = new Date().toISOString();
    S.lastBackupAt = now;
    return DB.setSetting('lastBackupAt', now).then(function () {
      if (!$('settings').hidden) {
        $('info-backup').textContent = backupAgo();
      }
      render();
    });
  }

  // حفظ اكتمل بعد أن هدم أندرويد شاشة التطبيق خلف منتقي الملفات (شاومي): التطبيق بدأ
  // من جديد، فنطمئن صاحب المحل أن الملف حُفظ، ونسجّل النسخة الاحتياطية إن كانت كذلك
  var restoredSave = null;
  if (Native.onRestoredSave) Native.onRestoredSave(function (name) { restoredSave = name; });
  function showRestoredSave() {
    if (restoredSave == null) return;
    var backup = /\.json$/i.test(restoredSave);
    restoredSave = null;
    return (backup ? recordBackup() : Promise.resolve()).then(function () {
      return alertBox('تم الحفظ ✓', (backup ? 'حُفظت النسخة الاحتياطية' : 'حُفظ الملف') + ' في المكان الذي اخترته.');
    });
  }

  $('btn-backup').addEventListener('click', function () { doBackup(); });

  // كل 24 ساعة: إن مرّ يوم على آخر نسخة (وعلى آخر سؤال) نسأل أين يحفظ نسخة جديدة
  function hoursSince(iso) { return iso ? (Date.now() - new Date(iso).getTime()) / 3600000 : Infinity; }

  function maybeAskBackup() {
    if (!S.started || !S.customers.length || dialogResolve || nav.length > 1 || S.backupBusy) return;
    if (hoursSince(S.lastBackupAt) < BACKUP_EVERY_HOURS) return;
    if (hoursSince(S.backupAskedAt) < BACKUP_EVERY_HOURS) return;
    S.backupAskedAt = new Date().toISOString();
    return DB.setSetting('backupAskedAt', S.backupAskedAt).then(function () {
      return doBackup({
        title: 'حان وقت النسخة الاحتياطية',
        msg: S.lastBackupAt
          ? 'مرّ يوم على آخر نسخة احتياطية. أين تريد أن تحتفظ بنسخة اليوم؟'
          : 'لم تحفظ نسخة احتياطية بعد. أين تريد أن تحتفظ بها؟',
        later: true
      });
    });
  }

  // ملف واحد لاختيار الملفات، ونمطان: «import» يضيف إلى الدفتر، «restore» يستبدله
  var fileMode = 'restore';
  function pickFile(mode) { fileMode = mode; $('restore-file').click(); }
  $('btn-restore').addEventListener('click', function () { pickFile('restore'); });
  $('btn-import').addEventListener('click', function () { pickFile('import'); });
  $('empty-import').addEventListener('click', function () { pickFile('import'); });

  // كم زبونًا جديدًا سيضيفه الاستيراد (الأسماء الموجودة تُدمج ولا تُحسب)
  function newCustomersIn(data) {
    var have = Object.create(null), n = 0;
    S.customers.forEach(function (c) { have[norm(c.name)] = true; });
    data.customers.forEach(function (c) { var k = norm(c.name); if (!have[k]) { have[k] = true; n++; } });
    return n;
  }
  // الاستيراد والاستعادة لا يتجاوزان حد النسخة المجانية (وإلا صارا طريقًا للالتفاف عليه)
  function mergeBlocked(data) { return false; }
  function restoreBlocked(data) { return false; }

  function importFile(data) {
    if (mergeBlocked(data)) return Promise.resolve();
    return ask({
      title: 'استيراد البيانات؟',
      msg: 'سيُضاف من الملف ' + data.customers.length + ' زبون و' + data.transactions.length +
           ' حركة إلى دفترك الحالي. لن يُمسح شيء، والزبائن والحركات الموجودة أصلًا لن تتكرر.',
      ok: 'استورد الآن'
    }).then(function (yes) {
      if (!yes) return;
      return mergeFile(data);
    });
  }

  function mergeFile(data) {
      if (mergeBlocked(data)) return Promise.resolve();
      return DB.mergeAll(data).then(function (r) {
        return loadData().then(function () {
          $('search').value = '';
          resetToHome();
          return alertBox('تم الاستيراد', 'أُضيف ' + r.newCustomers + ' زبون جديد و' + r.newTx + ' حركة.' +
            (r.skippedTx ? ' وتُركت ' + r.skippedTx + ' حركة لأنها موجودة أصلًا.' : '') +
            ' الدفتر الآن يحتوي على ' + S.customers.length + ' زبون.');
        });
      });
  }

  $('restore-file').addEventListener('change', function () {
    var input = $('restore-file');
    var f = input.files && input.files[0];
    input.value = '';
    if (!f) return;
    var reader = new FileReader();
    reader.onerror = function () {
      alertBox('تعذّرت القراءة', 'لم نستطع قراءة الملف. جرّب ملفًا آخر.');
    };
    reader.onload = function () { loadBackupText(String(reader.result || ''), fileMode); };
    reader.readAsText(f);
  });

  // mode: «import» يضيف، «restore» يستبدل، «choose» يسأل (ملف فُتح بـ «فتح بواسطة دفترة»)
  function loadBackupText(text, mode) {
    var res = DB.validateBackup(text);
    if (!res.ok) return alertBox('ملف غير صالح', res.error);
    // في شاشة الإعداد الأولى تبقى استعادة كاملة: تأتي معها اسم المحل والعملة
    if (!$('screen-setup').hidden) mode = 'restore';
    if (mode === 'import') return importFile(res.data);
    if (mode === 'restore') return restoreFile(res.data);
    return ask({
      title: 'فتح نسخة احتياطية',
      msg: 'في الملف ' + res.data.customers.length + ' زبون و' + res.data.transactions.length +
           ' حركة. «أضف إلى دفتري» لا يمسح شيئًا ولا يكرر الموجود.',
      ok: 'أضف إلى دفتري',
      alt: 'استبدل الدفتر كله'
    }).then(function (c) {
      if (c === true) return mergeFile(res.data);
      if (c === 'alt') return restoreFile(res.data);
    });
  }

  function restoreFile(data) {
      if (restoreBlocked(data)) return Promise.resolve();
      return ask({
        title: 'استعادة النسخة؟',
        msg: 'سيُمسح كل ما في الدفتر الآن (' + S.customers.length + ' زبون) ويُستبدل بالملف: ' +
             data.customers.length + ' زبون و' + data.transactions.length + ' حركة. لا يمكن التراجع.',
        ok: 'استعد الآن',
        danger: true
      }).then(function (yes) {
        if (!yes) return;
        // في شاشة الإعداد لا يوجد دفتر يُمسح، فلا حاجة للبصمة
        return (!$('screen-setup').hidden ? Promise.resolve(true) : confirmIdentity()).then(function (pass) {
          if (!pass) return alertBox('لم تتم الاستعادة', 'استبدال الدفتر يحتاج تأكيد البصمة أو رمز قفل الجوال.');
          return doRestore(data);
        });
      });
  }

  function doRestore(data) {
        return DB.importAll(data)
          .then(loadSettings)
          .then(loadData)
          .then(function () {
            $('search').value = '';
            // الاستعادة من شاشة الإعداد الأولى: الدفتر جاهز، ننتقل إليه مباشرة
            if (!$('screen-setup').hidden && S.shopName) {
              $('screen-setup').hidden = true;
              startApp();
            } else {
              resetToHome();
            }
            return alertBox('تمت الاستعادة', 'الدفتر الآن يحتوي على ' + S.customers.length + ' زبون.');
          });
  }

  // ملف .json فُتح من خارج التطبيق (مدير الملفات، واتساب)
  function handleOpenedFile() {
    if (!Native.takeOpenedFile) return Promise.resolve();
    return Native.takeOpenedFile().then(function (f) {
      if (f) return loadBackupText(f.text, 'choose');
    }, function () {
      return alertBox('تعذّرت القراءة', 'لم نستطع قراءة الملف. جرّب فتحه من التطبيق: الإعدادات ← استيراد بيانات.');
    });
  }

  // كلما صار التطبيق أمام صاحب المحل: بعد القفل إن وُجد، ثم الملف المفتوح، ثم سؤال النسخة
  var fg = Promise.resolve();
  function onForeground() {
    fg = fg.then(function () { return locking; })
      .then(showRestoredSave)
      .then(handleOpenedFile)
      .then(function () { if (pendingTap) handleNotifTap(pendingTap); })
      .then(maybeAskBackup)
      .then(maybeRemindSync)
      .then(function () {
        if (Native.requestNotif && !S.notifAsked && S.lateAlert !== 'off' && notificationPlan().length) {
          return ensureNotifPermission();
        }
        scheduleNotifSync();
      })
      .catch(function () {});
    return fg;
  }
  if (Native.onFileOpened) Native.onFileOpened(onForeground);
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) { S.showTotal = false; return; }
    if (!Native.isNative) { if (S.started) render(); onForeground(); }
  });

  /* ---------------- الحاسوب: شاشة عريضة ولوحة مفاتيح ---------------- */
  var wideMq = window.matchMedia ? window.matchMedia('(min-width: 1000px)') : null;
  function applyWide() {
    S.wide = !!(wideMq && wideMq.matches);
    document.documentElement.classList.toggle('wide', S.wide);
    render();
  }
  if (wideMq) {
    if (wideMq.addEventListener) wideMq.addEventListener('change', applyWide);
    else if (wideMq.addListener) wideMq.addListener(applyWide);
  }
  S.wide = !!(wideMq && wideMq.matches);
  document.documentElement.classList.toggle('wide', S.wide);
  document.documentElement.classList.toggle('desktop', !!Native.isDesktop);

  function topEntry() { return nav[nav.length - 1]; }
  function typing(el) {
    return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
  }
  document.addEventListener('keydown', function (ev) {
    if (!S.started || ev.altKey || ev.metaKey) return;
    var top = topEntry(), k = ev.key, ctrl = ev.ctrlKey;

    // شاشة المبلغ: الأرقام من لوحة المفاتيح، Enter للحفظ
    if (top.t === 'ov' && top.n === 'numpad') {
      var inField = typing(document.activeElement);
      if (k === 'Enter') { ev.preventDefault(); $('numpad-confirm').click(); return; }
      if (k === 'Escape') { ev.preventDefault(); goBack(); return; }
      if (inField || ctrl) return;
      if (/^[0-9]$/.test(k)) { ev.preventDefault(); pressKey(k); return; }
      if (/^[٠-٩]$/.test(k)) { ev.preventDefault(); pressKey(String(k.charCodeAt(0) - 0x660)); return; }
      if (k === 'Backspace') { ev.preventDefault(); pressKey('back'); return; }
      return;
    }
    if (k === 'Escape') {
      if (nav.length > 1) { ev.preventDefault(); goBack(); }
      return;
    }
    if (top.t === 'ov') return;   // شيت مفتوح: لا اختصارات
    if (ctrl && (k === 'f' || k === 'F' || k === 'ب')) { ev.preventDefault(); $('search').focus(); $('search').select(); return; }
    if (ctrl && (k === 'n' || k === 'N' || k === 'ى')) { ev.preventDefault(); $('fab-new').click(); return; }
    if (typing(document.activeElement) || ctrl) return;
    if (k === '/') { ev.preventDefault(); $('search').focus(); return; }
    if (currentView().n === 'customer') {
      if (k === '+' || k === '=') { ev.preventDefault(); $('btn-debt').click(); }
      else if (k === '-' || k === '_') { ev.preventDefault(); $('btn-pay').click(); }
    }
  });

  /* ---------------- المزامنة بين الأجهزة — sync.js ---------------- */
  function renderSyncSetting() {
    $('sync-box').hidden = !Sync.available;
    if (!Sync.available) return;
    var on = Sync.linked, left = Sync.daysLeft(), expired = on && !Sync.active();
    // نسخة Google Play: الشراء من خارج المتجر غير مسموح، فتبدأ المزامنة وتُجدَّد من نسخة الموقع
    $('sync-start').hidden = on || Native.isPlay;
    $('sync-join').hidden = on;
    $('sync-now').hidden = !on;
    $('sync-add').hidden = !on || expired;
    $('sync-stop').hidden = !on;
    $('sync-renew').hidden = !on || Native.isPlay || !(expired || (left !== null && left <= 60));
    $('sync-renew-sub').textContent = expired ? 'سنة كاملة بـ' + License.SYNC_PRICE_RENEW
      : 'تنتهي ' + fmtDay(Sync.until) + ' — سنة إضافية بـ' + License.SYNC_PRICE_RENEW;
    $('sync-status').textContent = expired ? 'انتهت سنة المزامنة — الدفتر يعمل كما هو على كل جهاز'
      : Sync.busy ? 'جارٍ المزامنة…'
      : Sync.lastError ? Sync.lastError
      : Sync.lastAt ? 'آخر مزامنة: ' + fmtDateTime(Sync.lastAt) : 'لم تتم بعد';
    $('sync-status').classList.toggle('danger', expired || (!Sync.busy && !!Sync.lastError));
    $('sync-note').textContent = !on
      ? 'دفتر واحد على جوالك وحاسوبك وجوال من يعمل معك. يحتاج إنترنت عند المزامنة فقط، والدفتر يبقى يعمل بدونه.'
      : expired
        ? (Native.isPlay ? 'لتجديدها افتح دفترة على جهازك الآخر (نسخة الموقع): الإعدادات ← جدّد المزامنة.'
          : 'جدّدها لتعود أجهزتك متزامنة. كل ما سجّلته أثناء التوقف يصل إلى الأجهزة الأخرى بعد التجديد.')
        : 'المزامنة فعّالة بلا حدود وتتم تلقائيًا كلما توفّر الإنترنت. كل شيء يُشفَّر على جهازك قبل أن يُرسل، فلا يستطيع أحد قراءته — ولا MakeFlow.';
  }

  /* شراء المزامنة أو تجديدها: نفس طريقة كود التفعيل (رقم الجهاز ← واتساب ← الصق الرد).
     kind: «new» (أول مرة، ثم تبدأ المزامنة) أو «renew» */
  var sbKind = 'new';
  function syncPrice() {
    return sbKind === 'renew' ? License.SYNC_PRICE_RENEW : S.licensed ? License.SYNC_PRICE_UPGRADE : License.SYNC_PRICE_NEW;
  }
  function openSyncBuy(kind, msg) {
    sbKind = kind;
    var renew = kind === 'renew';
    $('sb-name').textContent = renew ? 'جدّد المزامنة' : S.licensed ? 'المزامنة بين الأجهزة' : 'دفترة الكاملة + المزامنة';
    $('sb-price').textContent = syncPrice();
    $('sb-terms').innerHTML = renew ? '<span>سنة إضافية</span><span>التجديد اختياري</span>'
      : '<span>سنة مزامنة كاملة</span><span>التجديد اختياري: ' + esc(License.SYNC_PRICE_RENEW) + ' سنويًا</span>';
    var perks = ['دفتر واحد على <b>كل أجهزتك</b>: الجوال والحاسوب وجوال من يعمل معك', 'لو ضاع جوالك، دفترك محفوظ على جهازك الآخر',
      'مشفّر: لا يستطيع أحد قراءته غيرك'];
    if (!renew && !S.licensed) perks.unshift('<b>دفترة الكاملة مدى الحياة</b>: زبائن بلا حدود');
    if (!renew) perks.push('بعد السنة، إن لم تجدّد: يبقى دفترك كاملًا على كل جهاز، وتتوقف المزامنة فقط');
    $('sb-perks').innerHTML = perks.map(function (x) { return '<li><span>' + x + '</span></li>'; }).join('');
    $('sb-msg').textContent = msg || '';
    $('sb-msg').hidden = !msg;
    $('sb-device').textContent = S.deviceCode || '—';
    $('sb-copy').lastChild.textContent = 'نسخ';
    $('sb-paste').hidden = !(navigator.clipboard && navigator.clipboard.readText);
    $('sb-code').value = '';
    $('sb-err').hidden = true;
    pushOverlay('syncbuy');
  }
  function syncRequest() {
    var what = sbKind === 'renew' ? 'تجديد المزامنة سنة' : S.licensed ? 'المزامنة بين الأجهزة (سنة)' : 'دفترة الكاملة + المزامنة (سنة)';
    return 'السلام عليكم، أريد ' + what + ' — ' + syncPrice() + '.\nالمحل: ' + (S.shopName || '—') +
      '\nرقم الجهاز: ' + S.deviceCode + (Sync.until ? '\nالمزامنة حتى: ' + Sync.until : '');
  }
  $('syncbuy').querySelector('.sheet-backdrop').addEventListener('click', goBack);
  $('sb-cancel').addEventListener('click', goBack);
  $('sb-wa').addEventListener('click', function () { openWhatsApp(License.OWNER_PHONE, syncRequest()); });
  $('sb-copy').addEventListener('click', function () {
    var b = $('sb-copy');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(S.deviceCode || '').then(function () { b.lastChild.textContent = '✓ نُسخ'; }, function () {});
    }
  });
  $('sb-paste').addEventListener('click', function () {
    navigator.clipboard.readText().then(function (t) {
      if (t) { $('sb-code').value = t; $('sb-err').hidden = true; }
    }, function () { $('sb-code').focus(); });
  });
  $('sb-go').addEventListener('click', function () {
    var text = $('sb-code').value, err = $('sb-err');
    var code = License.extractSync(text);
    if (!code) { err.textContent = 'لم أجد كود المزامنة في النص. الصق الرسالة كاملة كما وصلتك.'; err.hidden = false; return; }
    if (!License.verifySync(code, S.deviceCode)) {
      err.textContent = 'هذا الكود لا يخص هذا الجهاز (' + S.deviceCode + '). تأكد أنك أرسلت رقم الجهاز الصحيح.';
      err.hidden = false;
      return;
    }
    // رسالة الباقة الكاملة فيها كود التفعيل الدائم أيضًا
    var lic = License.extract(text);
    var withLic = !!(lic && !S.codeOk && License.verify(lic, S.deviceCode));
    (withLic ? DB.setSetting('license', lic).then(function () {
      S.licenseCode = lic;
      return refreshLicense();
    }) : Promise.resolve()).then(function () {
      return Sync.addPass(code);
    }).then(function (until) {
      goBackThen(function () {
        renderSyncSetting();
        renderLicenseSetting();
        var done = (withLic ? 'دفترة مفعّلة مدى الحياة، و' : '') + 'المزامنة فعّالة حتى ' + fmtDay(until) + '.';
        if (sbKind === 'renew' || Sync.linked) { alertBox('🎉 شكرًا لك!', done); return; }
        alertBox('🎉 شكرًا لك!', done + ' الآن نشغّلها ونريك رمز الربط لأجهزتك الأخرى.').then(startSync);
      });
    });
  });

  // تذكير قبل انتهاء السنة بأسبوعين، ومرة بعد الانتهاء؛ لا يتكرر أكثر من مرة كل 3 أيام
  function maybeRemindSync() {
    if (!Sync.linked || Native.isPlay) return Promise.resolve();
    var left = Sync.daysLeft();
    if (left === null || left > License.SYNC_REMIND_DAYS) return Promise.resolve();
    return DB.getSettings().then(function (st) {
      if (st.syncRemindedAt && daysSince(st.syncRemindedAt) < 3) return;
      return DB.setSetting('syncRemindedAt', new Date().toISOString()).then(function () {
        return ask({
          title: left < 0 ? 'توقفت المزامنة' : 'تنتهي المزامنة بعد ' + (left === 0 ? 'اليوم' : left + ' يوم'),
          msg: (left < 0 ? 'انتهت سنة المزامنة، ودفترك يعمل كما هو على كل جهاز. ' : '') +
            'جدّدها سنة كاملة بـ' + License.SYNC_PRICE_RENEW + ' لتبقى أجهزتك متزامنة.',
          ok: 'جدّد الآن',
          cancel: 'لاحقًا'
        }).then(function (yes) { if (yes) openSyncBuy('renew'); });
      });
    });
  }
  Sync.onStatus = function () { if (!$('settings').hidden) renderSyncSetting(); };
  // وصلت تغييرات من جهاز آخر
  Sync.onChange = function (o) {
    (o.settings ? loadSettings() : Promise.resolve()).then(loadData).then(function () {
      if (S.started) render();
      if (!$('settings').hidden) {
        if (o.settings) $('set-shop').value = S.shopName;
        renderSyncSetting();
        renderLicenseSetting();
        renderLogoSetting();
      }
    });
  };

  $('sync-start').addEventListener('click', function () {
    if (!Sync.active()) { openSyncBuy('new'); return; }
    startSync();
  });
  function startSync() {
    return ask({
      title: 'تشغيل المزامنة',
      msg: 'سيُرفع دفترك مشفّرًا، ثم يظهر رمز QR تمسحه من أجهزتك الأخرى. تحتاج إنترنت الآن.',
      ok: 'شغّلها'
    }).then(function (yes) {
      if (!yes) return;
      return Sync.create().then(function (ok) {
        if (!ok) {
          var why = Sync.lastError;
          return Sync.unlink(false).then(function () {
            renderSyncSetting();
            return alertBox('لم تعمل المزامنة', why || 'تأكد من الإنترنت وحاول مرة أخرى.');
          });
        }
        renderSyncSetting();
        return shareSyncCode('✓ المزامنة تعمل');
      });
    });
  }

  $('sync-now').addEventListener('click', function () {
    if (Sync.linked && !Sync.active() && !Native.isPlay) { openSyncBuy('renew'); return; }
    Sync.now();
  });
  $('sync-renew').addEventListener('click', function () { openSyncBuy('renew'); });
  $('sync-add').addEventListener('click', function () { shareSyncCode('أضف جهازًا آخر'); });

  // يُحمَّل عند الحاجة فقط (رمز QR والكاميرا)
  function loadVendor(src, name) {
    if (window[name]) return Promise.resolve(window[name]);
    return new Promise(function (resolve, reject) {
      var el = document.createElement('script');
      el.src = src;
      el.onload = function () { window[name] ? resolve(window[name]) : reject(new Error(name)); };
      el.onerror = function () { reject(new Error(src)); };
      document.head.appendChild(el);
    });
  }

  function shareSyncCode(title) {
    var code = Sync.code();
    $('sc-title').textContent = title;
    $('sc-qr').innerHTML = '';
    pushOverlay('synccode');
    return loadVendor('vendor/qrcode.min.js', 'qrcode').then(function (qrcode) {
      var qr = qrcode(0, 'M');
      qr.addData(code);
      qr.make();
      $('sc-qr').innerHTML = qr.createSvgTag({ cellSize: 6, margin: 0, scalable: true });
    }).catch(function () {
      $('sc-qr').textContent = code;
      $('sc-qr').className = 'sync-qr sync-code';
    });
  }
  $('synccode').querySelector('.sheet-backdrop').addEventListener('click', goBack);
  $('sc-done').addEventListener('click', goBack);
  $('sc-wa').addEventListener('click', function () {
    openWhatsApp('', 'رمز ربط دفترة (لا ترسله لأحد غيرك — من يملكه يرى الدفتر كاملًا):\n' + Sync.code() +
      '\n\nعلى الجهاز الآخر: الإعدادات ← المزامنة بين الأجهزة ← «اربط بجهاز آخر»، والصق الرسالة.');
  });

  function openJoin() {
    $('sj-code').value = '';
    $('sj-err').hidden = true;
    $('sj-go').disabled = false;
    $('sj-go').textContent = 'اربط';
    $('sj-paste').hidden = !(navigator.clipboard && navigator.clipboard.readText);
    $('sj-scan').hidden = !canScan();
    $('sj-or').hidden = !canScan();
    $('sj-cam').hidden = true;
    pushOverlay('syncjoin');
  }
  $('sync-join').addEventListener('click', openJoin);
  $('setup-link').addEventListener('click', openJoin);

  /* مسح رمز QR بالكاميرا: صورة كل ربع ثانية تُقرأ بـ jsQR، ولا يخرج شيء من الجهاز */
  var scan = null;   // {stream, timer}
  function canScan() { return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia); }
  function stopScan() {
    if (!scan) return;
    clearInterval(scan.timer);
    scan.stream.getTracks().forEach(function (t) { t.stop(); });
    scan = null;
    $('sj-video').srcObject = null;
    $('sj-cam').hidden = true;
    $('sj-scan').hidden = !canScan();
  }
  $('sj-scan').addEventListener('click', function () {
    var err = $('sj-err');
    err.hidden = true;
    Promise.all([
      loadVendor('vendor/jsQR.min.js', 'jsQR'),
      navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false })
    ]).then(function (r) {
      var jsQR = r[0], stream = r[1];
      if ($('syncjoin').hidden) { stream.getTracks().forEach(function (t) { t.stop(); }); return; }
      var video = $('sj-video');
      video.srcObject = stream;
      video.play();
      $('sj-cam').hidden = false;
      $('sj-scan').hidden = true;
      var canvas = document.createElement('canvas');
      var ctx = canvas.getContext('2d', { willReadFrequently: true });
      scan = { stream: stream, timer: setInterval(function () {
        if (!video.videoWidth) return;
        // نقرأ مربع الوسط فقط (حيث الإطار): أسرع، ويكفي
        var side = Math.min(video.videoWidth, video.videoHeight);
        var size = Math.min(side, 640);
        canvas.width = canvas.height = size;
        ctx.drawImage(video, (video.videoWidth - side) / 2, (video.videoHeight - side) / 2, side, side, 0, 0, size, size);
        var hit = jsQR(ctx.getImageData(0, 0, size, size).data, size, size, { inversionAttempts: 'dontInvert' });
        var code = hit && Sync.extract(hit.data);
        if (!code) return;
        stopScan();
        if (navigator.vibrate) navigator.vibrate(60);
        $('sj-code').value = code;
        $('sj-go').click();
      }, 250) };
    }).catch(function (e) {
      err.textContent = (e && (e.name === 'NotAllowedError' || e.name === 'SecurityError'))
        ? 'لم يُسمح باستخدام الكاميرا. اسمح بها من إعدادات الجوال، أو الصق رمز الربط بالأسفل.'
        : 'تعذّر تشغيل الكاميرا. الصق رمز الربط بالأسفل بدلًا من ذلك.';
      err.hidden = false;
    });
  });
  $('syncjoin').querySelector('.sheet-backdrop').addEventListener('click', goBack);
  $('sj-cancel').addEventListener('click', goBack);
  $('sj-paste').addEventListener('click', function () {
    navigator.clipboard.readText().then(function (t) {
      if (t) { $('sj-code').value = t; $('sj-err').hidden = true; }
    }, function () { $('sj-code').focus(); });
  });
  $('sj-go').addEventListener('click', function () {
    var code = Sync.extract($('sj-code').value);
    var err = $('sj-err');
    if (!code) { err.textContent = 'لم أجد رمز الربط في النص. الصق الرسالة كاملة كما وصلتك.'; err.hidden = false; return; }
    err.hidden = true;
    var n = S.customers.length;
    (n ? ask({
      title: 'في هذا الجهاز دفتر أيضًا',
      msg: 'فيه ' + n + ' زبون. «ادمج» يضيفهم إلى دفتر الجهاز الآخر. «استبدل» يمسحهم من هذا الجهاز ويأخذ دفتر الجهاز الآخر كما هو.',
      ok: 'ادمج الدفترين',
      alt: 'استبدل بدفتر الجهاز الآخر'
    }) : Promise.resolve(true)).then(function (c) {
      if (!c) return;
      var replace = c === 'alt';
      return (replace ? confirmIdentity() : Promise.resolve(true)).then(function (pass) {
        if (!pass) return alertBox('لم يتم الربط', 'مسح دفتر هذا الجهاز يحتاج تأكيد البصمة أو رمز قفل الجوال.');
        var go = $('sj-go');
        go.disabled = true;
        go.textContent = 'جارٍ الربط…';
        return Sync.join(code, replace).then(function (ok) {
          return loadSettings().then(loadData).then(function () {
            goBackThen(function () {
              if (!$('screen-setup').hidden && S.shopName) {
                $('screen-setup').hidden = true;
                startApp();
              }
              render();
              renderSyncSetting();
              renderLicenseSetting();
              $('set-shop').value = S.shopName;
              alertBox('✓ تم الربط', ok
                ? 'هذا الجهاز يتزامن الآن مع دفتر الجهاز الآخر: ' + S.customers.length + ' زبون.'
                : 'تم الربط، وستكتمل المزامنة عند توفّر الإنترنت.');
            });
          });
        }, function (e) {
          go.disabled = false;
          go.textContent = 'اربط';
          err.textContent = (e && e.message && /[\u0600-\u06FF]/.test(e.message)) ? e.message : 'تعذّر الربط. تأكد من الإنترنت وحاول مرة أخرى.';
          err.hidden = false;
        });
      });
    });
  });

  $('sync-stop').addEventListener('click', function () {
    ask({
      title: 'إيقاف المزامنة؟',
      msg: 'يبقى دفترك كاملًا على هذا الجهاز، لكنه لن يتزامن مع أجهزتك الأخرى. «احذف من الخادم» يوقفها على كل الأجهزة ويمسح النسخة المشفّرة من الخادم.',
      ok: 'أوقفها على هذا الجهاز',
      alt: 'أوقفها واحذف من الخادم',
      danger: true
    }).then(function (c) {
      if (!c) return;
      return Sync.unlink(c === 'alt').then(refreshLicense).then(function () {
        renderSyncSetting();
        renderLicenseSetting();
      }, function () {
        alertBox('تعذّر الحذف من الخادم', 'تأكد من الإنترنت وحاول مرة أخرى. المزامنة ما زالت تعمل.');
      });
    });
  });

  /* ---------------- الإقلاع ---------------- */
  function startApp() {
    S.started = true;
    nav = [{ t: 'view', n: 'home' }];
    history.replaceState({ i: 0 }, '');
    render();
  }

  function fatal(msg) {
    document.body.innerHTML =
      '<div style="padding:32px;font-family:system-ui,sans-serif;text-align:center">' +
      '<h1 style="font-size:20px">تعذّر تشغيل التطبيق</h1><p style="color:#6b7280">' + esc(msg) + '</p>' +
      '<p style="color:#6b7280">جرّب إغلاق وضع التصفح الخفي، أو استخدام متصفح آخر.</p></div>';
  }

  function registerSW() {
    if (!('serviceWorker' in navigator)) return;
    if (location.protocol === 'file:' || Native.isNative) return;
    navigator.serviceWorker.register('sw.js').catch(function () {});
  }

  // تختفي شاشة الدخول بعد اكتمال حركتها (أو فورًا تقريبًا لمن طلب تقليل الحركة في جواله)
  function hideSplash() {
    var el = $('splash');
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var wait = Math.max(0, (reduce ? 300 : SPLASH_MIN_MS) - (Date.now() - bootAt));
    return new Promise(function (resolve) {
      setTimeout(function () {
        el.classList.add('out');
        setTimeout(function () { el.hidden = true; resolve(); }, reduce ? 0 : 450);
      }, wait);
    });
  }

  DB.open()
    .then(Sync.init)
    .then(loadSettings)
    .then(loadData)
    .then(function () {
      // الدفتر يُرسم خلف شاشة الدخول، وشاشة القفل تغطيه قبل أن تختفي
      var locked = S.lockEnabled && Native.isNative;
      if (S.shopName) startApp();
      if (locked) $('screen-lock').hidden = false;
      return hideSplash().then(function () { if (locked) return unlock(); });
    })
    .then(function () {
      if (!S.shopName) showSetup();
      registerSW();
      if (Native.start) Native.start();
      setTimeout(onForeground, 600);
      Sync.now();
    })
    .catch(function (err) {
      fatal((err && err.message) ? err.message : 'خطأ غير معروف');
    });

  // منع التكبير بالنقر المزدوج على الأزرار (يزعج المستخدم أثناء التسجيل السريع)
  document.addEventListener('dblclick', function (e) {
    if (e.target.closest('button')) e.preventDefault();
  });
})();
