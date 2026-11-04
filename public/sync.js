/* ================= دفترة — المزامنة بين الأجهزة (ميزة مدفوعة) =================
   الخادم (Supabase، انظر supabase/sync.sql) صندوق بريد لا يقرأ ما فيه:
   كل ما يُرفع «ظرف» مشفّر هنا على الجهاز بـ nacl.secretbox بمفتاح الدفتر.

   مفتاح الدفتر: 32 بايت عشوائية تُولَّد عند تشغيل المزامنة أول مرة، وتنتقل للأجهزة
   الأخرى بـ «رمز الربط» (DFS-...). من المفتاح نفسه نشتق:
     ledger : اسم الدفتر على الخادم
     token  : إثبات أن الجهاز يملك الدفتر (الخادم يحفظ بصمته فقط)
   فمن لا يملك الرمز لا يقرأ الظروف ولا يكتب فيها، والخادم نفسه لا يفتحها.

   كل ظرف: {c: زبائن, t: حركات, s: إعدادات المحل, lic: إثبات التفعيل, pass: اشتراك المزامنة}.

   الاشتراك سنوي ويخص الدفتر لا الجهاز: يشتريه جهاز واحد (كود DSY في license.js)،
   فيصل إلى كل الأجهزة المربوطة ضمن الظروف. بعد انتهائه تتوقف المزامنة فقط، ويبقى كل
   جهاز بدفتره كاملًا؛ والجهاز المتوقف يظل يبحث في الظروف عن تجديد وصل من جهاز آخر.
   عند التعارض تفوز النسخة الأحدث (updatedAt)، والحذف علامة تنتقل كأي تعديل.

   الإعدادات المحلية (لا تخرج في النسخ الاحتياطية):
     syncKey      مفتاح الدفتر (base64url)       syncDevice  رقم هذا الجهاز
     syncSeq      آخر ظرف قُرئ من الخادم         syncAt      آخر مزامنة ناجحة
     syncLic      إثبات تفعيل وصل من جهاز آخر    syncOrphans حركات تنتظر زبونها
     syncSharedPushed  آخر sharedAt رُفع  syncLicPushed آخر إثبات تفعيل رُفع
     syncPass     أحدث اشتراك صالح {code, device}   syncPassPushed آخر اشتراك رُفع
========================================================================== */
(function (global) {
  'use strict';

  // خادم Supabase الخاص بـ MakeFlow. مفتاح anon عام بطبيعته (يُنشر داخل التطبيق)؛
  // الجداول مقفلة أمامه، ولا يستطيع إلا استدعاء دوال المزامنة.
  var SYNC_URL = 'https://daftara-daftara.areflh.easypanel.host';
  var SYNC_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InN1cGFiYXNlIiwiaWF0IjoxNzkzMzMyNTk3LCJleHAiOjIxMDg5NTE3OTd9.EOxYWi3P8LAZkEhwzyX8BSLKKE2IM3p7aERVV_4kD6w';

  var PREFIX = 'DFS-';
  var BOX_RECORDS = 300;     // سجلات في الظرف الواحد
  var PULL_LIMIT = 200;
  var DEBOUNCE_MS = 3000;    // بعد آخر تعديل
  var EVERY_MS = 60000;      // كل دقيقة والتطبيق مفتوح

  var nacl = global.nacl;
  function utf8(s) { return new TextEncoder().encode(s); }
  function fromUtf8(b) { return new TextDecoder().decode(b); }
  function hex(b) {
    var s = '';
    for (var i = 0; i < b.length; i++) s += (b[i] < 16 ? '0' : '') + b[i].toString(16);
    return s;
  }
  function b64(b) {
    var s = '';
    for (var i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
    return btoa(s);
  }
  function unb64(s) {
    var bin = atob(s), out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function b64url(b) { return b64(b).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
  function unb64url(s) {
    s = s.replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    return unb64(s);
  }
  function concat(a, b) { var o = new Uint8Array(a.length + b.length); o.set(a); o.set(b, a.length); return o; }
  function derive(label, key) { return hex(nacl.hash(concat(utf8('daftara-sync-' + label + '|'), key)).subarray(0, 32)); }

  function seal(obj, key) {
    var nonce = nacl.randomBytes(24);
    return b64(concat(nonce, nacl.secretbox(utf8(JSON.stringify(obj)), nonce, key)));
  }
  function open(box, key) {
    var raw = unb64(box);
    var plain = nacl.secretbox.open(raw.subarray(24), raw.subarray(0, 24), key);
    if (!plain) throw new Error('bad box');
    return JSON.parse(fromUtf8(plain));
  }

  function rpc(fn, body) {
    return fetch(SYNC_URL.replace(/\/+$/, '') + '/rest/v1/rpc/' + fn, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: SYNC_ANON_KEY, Authorization: 'Bearer ' + SYNC_ANON_KEY },
      body: JSON.stringify(body)
    }).then(function (res) {
      return res.text().then(function (t) {
        var data = t ? JSON.parse(t) : null;
        if (!res.ok) {
          var e = new Error((data && data.message) || ('HTTP ' + res.status));
          e.auth = /bad token|bad ledger|no ledger/.test(e.message);
          throw e;
        }
        return data;
      });
    });
  }

  var st = null;   // {key, ledger, token, device, seq}
  function load() {
    return DB.getSettings().then(function (s) {
      if (!s.syncKey) { st = null; return null; }
      var key = unb64url(s.syncKey);
      st = { key: key, ledger: derive('id', key), token: derive('auth', key), device: s.syncDevice, seq: s.syncSeq || 0 };
      return st;
    });
  }

  var UNLIMITED = '2999-12-31';

  var Sync = {
    available: !!(SYNC_URL && SYNC_ANON_KEY),
    linked: false,
    busy: false,
    lastAt: null,           // آخر مزامنة ناجحة (ISO)
    lastError: null,        // نص الخطأ الأخير، أو null
    until: null,            // انتهاء اشتراك المزامنة (YYYY-MM-DD)، أو null إن لم يوجد
    onChange: null,         // يُستدعى بعد وصول تغييرات من جهاز آخر: fn({settings:bool})
    onStatus: null,         // يُستدعى كلما تغيّرت الحالة (للإعدادات)

    // رمز الربط الذي يُعطى للجهاز الآخر
    code: function () { return st ? PREFIX + b64url(st.key) : ''; },

    // يستخرج رمز الربط من نص ملصوق (رسالة واتساب مثلًا)
    extract: function (text) {
      var m = /DFS-([A-Za-z0-9_-]{43})/.exec(String(text || '').replace(/\s+/g, ''));
      return m ? PREFIX + m[1] : null;
    },

    init: function () {
      return load().then(function () {
        return DB.getSettings();
      }).then(function (s) {
        Sync.linked = !!st;
        Sync.lastAt = s.syncAt || null;
        pass = s.syncPass || null;
      });
    },

    // يُستدعى بعد معرفة رقم الجهاز (license.js)
    setDeviceCode: function (dc) {
      Sync.deviceCode = dc;
      Sync.until = UNLIMITED;   // مزامنة بلا حدود وبلا انتهاء
    },

    // هل الاشتراك ساري اليوم؟
    active: function () { return !!Sync.until && Sync.until >= today(); },
    // أيام متبقية (سالبة بعد الانتهاء)، أو null بلا اشتراك
    daysLeft: function () {
      if (!Sync.until || Sync.until === UNLIMITED) return null;
      var p = Sync.until.split('-');
      var end = new Date(+p[0], +p[1] - 1, +p[2]), now = new Date();
      now.setHours(0, 0, 0, 0);
      return Math.round((end - now) / 86400000);
    },

    // كود اشتراك لُصق في هذا الجهاز (من رسالة MakeFlow). يعيد تاريخ الانتهاء أو null.
    addPass: function (code) {
      var p = { code: code, device: Sync.deviceCode || '' };
      var until = passUntil(p);
      if (!until) return Promise.resolve(null);
      return keepPass(p).then(function () {
        if (st) Sync.now();
        return until;
      });
    },

    // يبدأ دفترًا جديدًا على الخادم انطلاقًا من هذا الجهاز
    create: function () {
      var key = nacl.randomBytes(32);
      return begin(key).then(function () {
        st.fresh = true;   // أول مزامنة ترفع أولًا: الرفع هو ما ينشئ الدفتر على الخادم
        return Sync.now();
      });
    },

    // ينضم إلى دفتر جهاز آخر. replace=true يمسح زبائن هذا الجهاز وحركاته أولًا.
    join: function (code, replace) {
      var m = Sync.extract(code);
      if (!m) return Promise.reject(new Error('رمز الربط غير صحيح.'));
      var key = unb64url(m.slice(PREFIX.length));
      var ledger = derive('id', key), token = derive('auth', key);
      // الرمز صحيح فقط إن كان الدفتر موجودًا على الخادم
      return rpc('sync_pull', { p_ledger: ledger, p_token: token, p_after: 0, p_limit: 1 }).catch(function (e) {
        throw e.auth ? new Error('لم نجد هذا الدفتر على الخادم. تأكد من الرمز، وأن الجهاز الآخر متصل بالإنترنت.') : e;
      }).then(function () {
        return replace ? DB.clearLedger() : null;
      }).then(function () {
        // إعدادات المحل تأتي من الدفتر الموجود، لا من هذا الجهاز
        return DB.setSetting('sharedAt', '');
      }).then(function () {
        return begin(key);
      }).then(function () { return Sync.now(); });
    },

    // يوقف المزامنة على هذا الجهاز. forget=true يحذف الدفتر من الخادم لكل الأجهزة.
    unlink: function (forget) {
      var p = (forget && st) ? rpc('sync_forget', { p_ledger: st.ledger, p_token: st.token }) : Promise.resolve();
      return p.then(function () {
        return Promise.all(['syncKey', 'syncDevice', 'syncSeq', 'syncAt', 'syncOrphans', 'syncSharedPushed', 'syncLicPushed', 'syncLic', 'syncPassPushed']
          .map(function (k) { return DB.setSetting(k, null); }));
      }).then(function () {
        // اشتراك اشتراه هذا الجهاز يبقى له (لدفتر جديد)؛ ما وصله من جهاز آخر يذهب مع الدفتر
        if (pass && pass.device !== Sync.deviceCode) {
          pass = null;
          Sync.until = null;
          return DB.setSetting('syncPass', null);
        }
      }).then(function () {
        // كل السجلات تُرفع من جديد إن رُبط الجهاز بدفتر آخر لاحقًا
        return DB.resetPushed();
      }).then(function () {
        st = null;
        Sync.linked = false;
        Sync.lastAt = null;
        Sync.lastError = null;
        status();
      });
    },

    // مزامنة الآن: قراءة ما وصل ثم رفع ما تغيّر. لا يرمي أبدًا.
    now: function () {
      if (!Sync.available || !st) return Promise.resolve(false);
      if (running) { again = true; return running; }
      Sync.busy = true;
      status();
      var fresh = st.fresh;
      // انتهى الاشتراك: لا مزامنة، لكن نبحث عن تجديد اشتراه جهاز آخر
      running = (Sync.active() ? Promise.resolve() : peekPass()).then(function () {
        if (!Sync.active()) { var e = new Error('expired'); e.expired = true; throw e; }
        return fresh ? push(true).then(pull) : pull().then(push);
      }).then(function () {
        if (st) st.fresh = false;
        Sync.lastAt = new Date().toISOString();
        Sync.lastError = null;
        return DB.setSetting('syncAt', Sync.lastAt);
      }).then(function () { return true; }, function (e) {
        if (e && e.expired) { Sync.lastError = null; return false; }
        Sync.lastError = (e && e.auth) ? 'رمز المزامنة لم يعد صالحًا (رُبّما حُذف الدفتر من الخادم).'
          : (navigator.onLine === false ? 'لا يوجد إنترنت — ستتم المزامنة عند عودته.' : 'تعذّرت المزامنة، سنحاول مرة أخرى.');
        console.error('daftara sync: ' + (e && e.message));
        return false;
      }).then(function (ok) {
        running = null;
        Sync.busy = false;
        status();
        if (again) { again = false; schedule(); }
        return ok;
      });
      return running;
    }
  };

  var running = null, again = false;
  var pass = null;   // أحدث اشتراك صالح نعرفه {code, device}
  function status() { if (Sync.onStatus) Sync.onStatus(); }

  function today() {
    var d = new Date();
    return d.getFullYear() + '-' + (d.getMonth() < 9 ? '0' : '') + (d.getMonth() + 1) + '-' + (d.getDate() < 10 ? '0' : '') + d.getDate();
  }
  function passUntil(p) {
    return (p && typeof p.code === 'string' && typeof p.device === 'string') ? License.verifySync(p.code, p.device) : null;
  }
  // يحتفظ بالاشتراك إن كان أبعد انتهاءً مما عندنا؛ يعيد true إن تغيّر
  function keepPass(p) {
    var until = passUntil(p);
    if (!until || (Sync.until && Sync.until >= until)) return Promise.resolve(false);
    pass = { code: p.code, device: p.device };
    Sync.until = until;
    return DB.setSetting('syncPass', pass).then(function () { status(); return true; });
  }

  // بعد الانتهاء: نقرأ الظروف الجديدة بحثًا عن اشتراك فقط، دون تطبيق شيء ودون التقدم في القراءة،
  // فإن وُجد تجديد تكمل المزامنة من حيث توقفت ولا يضيع شيء.
  function peekPass() {
    function page(after) {
      return rpc('sync_pull', { p_ledger: st.ledger, p_token: st.token, p_after: after, p_limit: PULL_LIMIT }).then(function (rows) {
        rows = rows || [];
        var last = after;
        return rows.reduce(function (p, row) {
          return p.then(function () {
            last = row.seq;
            if (row.device === st.device) return;
            var msg;
            try { msg = open(row.box, st.key); } catch (e) { return; }
            if (msg.pass) return keepPass(msg.pass);
          });
        }, Promise.resolve()).then(function () {
          if (rows.length === PULL_LIMIT && !Sync.active()) return page(last);
        });
      });
    }
    return page(st.seq);
  }

  function begin(key) {
    var device = b64url(nacl.randomBytes(9));
    return Promise.all([
      DB.setSetting('syncKey', b64url(key)),
      DB.setSetting('syncDevice', device),
      DB.setSetting('syncSeq', 0),
      DB.setSetting('syncOrphans', []),
      DB.setSetting('syncSharedPushed', ''),
      DB.setSetting('syncLicPushed', ''),
      DB.setSetting('syncPassPushed', '')
    ]).then(function () { return DB.resetPushed(); }).then(load).then(function () {
      Sync.linked = true;
      status();
    });
  }

  // إثبات تفعيل هذا الجهاز، أو ما وصلنا من جهاز آخر.
  // كود MakeFlow توقيع على رقم الجهاز، فيتحقق منه أي جهاز آخر بلا خادم.
  function licProof(s) {
    if (s.license && Sync.deviceCode && License.verify(s.license, Sync.deviceCode)) {
      return { code: s.license, device: Sync.deviceCode };
    }
    if (s.playOwned) return { play: true };
    return Sync.licValid(s.syncLic) ? s.syncLic : null;
  }
  Sync.licValid = function (lic) {
    return !!(lic && (lic.play === true || (typeof lic.code === 'string' && typeof lic.device === 'string' &&
      License.verify(lic.code, lic.device))));
  };

  function pull() {
    var changed = false, settings = false;
    function page() {
      return rpc('sync_pull', { p_ledger: st.ledger, p_token: st.token, p_after: st.seq, p_limit: PULL_LIMIT }).then(function (rows) {
        rows = rows || [];
        return rows.reduce(function (p, row) {
          return p.then(function () {
            if (row.device === st.device) return;
            var msg;
            try { msg = open(row.box, st.key); } catch (e) { console.error('daftara sync: skipped a box'); return; }
            return applyMsg(msg).then(function (r) {
              if (r.changed) changed = true;
              if (r.settings) settings = true;
            });
          }).then(function () {
            st.seq = row.seq;
          });
        }, Promise.resolve()).then(function () {
          return DB.setSetting('syncSeq', st.seq);
        }).then(function () {
          if (rows.length === PULL_LIMIT) return page();
        });
      });
    }
    return page().then(function () {
      if ((changed || settings) && Sync.onChange) Sync.onChange({ settings: settings });
    });
  }

  function applyMsg(msg) {
    var out = { changed: false, settings: false };
    return DB.getSettings().then(function (s) {
      var orphans = s.syncOrphans || [];
      var t = orphans.concat(msg.t || []);
      return DB.applyRemote({ c: msg.c || [], t: t }).then(function (r) {
        out.changed = r.changed > 0;
        return DB.setSetting('syncOrphans', r.orphans);
      }).then(function () {
        if (Sync.licValid(msg.lic) && !Sync.licValid(s.syncLic)) {
          return DB.setSetting('syncLic', msg.lic).then(function () { out.settings = true; });
        }
      }).then(function () {
        return msg.pass ? keepPass(msg.pass) : false;
      }).then(function (ch) {
        if (ch) out.settings = true;
      }).then(function () {
        return msg.s ? DB.applySharedSettings(msg.s) : false;
      }).then(function (ch) {
        if (ch) out.settings = true;
        return out;
      });
    });
  }

  function push(always) {
    return Promise.all([DB.syncChanges(), DB.sharedSettings(), DB.getSettings()]).then(function (r) {
      var ch = r[0], shared = r[1], s = r[2];
      var boxes = [], i;
      // الزبائن قبل حركاتهم، حتى يجدهم الجهاز الآخر عند وصول الحركات
      for (i = 0; i < ch.c.length; i += BOX_RECORDS) boxes.push({ c: ch.c.slice(i, i + BOX_RECORDS) });
      for (i = 0; i < ch.t.length; i += BOX_RECORDS) boxes.push({ t: ch.t.slice(i, i + BOX_RECORDS) });
      var sendShared = !!shared.at && shared.at !== s.syncSharedPushed;
      var lic = licProof(s), licStr = lic ? JSON.stringify(lic) : '';
      var sendLic = !!lic && licStr !== s.syncLicPushed;
      var passStr = pass ? JSON.stringify(pass) : '';
      var sendPass = !!pass && passStr !== s.syncPassPushed;
      // الإعدادات والتفعيل والاشتراك أولًا: الجهاز المنضم يجدها قبل كل شيء
      if (sendShared || sendLic || sendPass) boxes.unshift({ s: sendShared ? shared : null, lic: lic, pass: pass });
      if (!boxes.length && !always) return;
      var sealed = boxes.map(function (b) { return seal(b, st.key); });
      var chain = always && !sealed.length
        ? rpc('sync_push', { p_ledger: st.ledger, p_token: st.token, p_device: st.device, p_boxes: [] })
        : Promise.resolve();
      for (i = 0; i < sealed.length; i += 20) {
        (function (part) {
          chain = chain.then(function () {
            return rpc('sync_push', { p_ledger: st.ledger, p_token: st.token, p_device: st.device, p_boxes: part });
          });
        })(sealed.slice(i, i + 20));
      }
      return chain.then(function () {
        return DB.markPushed(ch);
      }).then(function () {
        return Promise.all([
          sendShared ? DB.setSetting('syncSharedPushed', shared.at) : null,
          sendLic ? DB.setSetting('syncLicPushed', licStr) : null,
          sendPass ? DB.setSetting('syncPassPushed', passStr) : null
        ]);
      });
    });
  }

  /* ---------- متى نزامن ---------- */
  var timer = null;
  function schedule() {
    if (!st) return;
    clearTimeout(timer);
    timer = setTimeout(Sync.now, DEBOUNCE_MS);
  }
  // كل تعديل على البيانات يجدول مزامنة
  ['addCustomer', 'updateCustomer', 'setReminder', 'deleteCustomer',
   'addTransaction', 'updateTransaction', 'deleteTransaction', 'importAll', 'mergeAll'].forEach(function (k) {
    var fn = DB[k];
    DB[k] = function () {
      return fn.apply(DB, arguments).then(function (v) {
        // الاستعادة الكاملة: نقرأ الدفتر كله من الخادم من جديد، فتفوز التعديلات الأحدث
        if (k === 'importAll' && st) { st.seq = 0; return DB.setSetting('syncSeq', 0).then(function () { schedule(); return v; }); }
        schedule();
        return v;
      });
    };
  });
  var setSetting = DB.setSetting;
  DB.setSetting = function (key, value) {
    return setSetting(key, value).then(function (v) {
      if (key === 'shopName' || key === 'currency' || key === 'logo' || key === 'license' || key === 'playOwned') schedule();
      return v;
    });
  };
  global.addEventListener('online', function () { if (st) Sync.now(); });
  document.addEventListener('visibilitychange', function () { if (!document.hidden && st) Sync.now(); });
  setInterval(function () { if (st && !document.hidden) Sync.now(); }, EVERY_MS);

  // للاختبار فقط
  Sync._seal = seal;
  Sync._open = open;

  global.Sync = Sync;
})(window);
