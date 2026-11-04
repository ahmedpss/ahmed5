/* ================= دفترة — التفعيل الدائم بدون إنترنت =================
   النسخة المجانية تتسع لـ FREE_LIMIT زبونًا. بعدها يرسل صاحب المحل «رقم جهازه»
   إلى MakeFlow، فيصله كود تفعيل يلصقه في التطبيق.

   الكود توقيع Ed25519 على رقم الجهاز. المفتاح الخاص عند MakeFlow وحدها
   (أداة tools/license-generator.html)، والتطبيق يحمل المفتاح العام فقط:
   يتحقق من الكود على الجهاز بلا إنترنت، ولا يستطيع أحد صنع كود ولو فكّك التطبيق.

   رقم الجهاز: على أندرويد من ANDROID_ID (ثابت مع إعادة التثبيت، خاص بالتطبيق
   والجهاز)؛ في المتصفح من رقم عشوائي يُحفظ في إعدادات الدفتر.
========================================================================= */
(function (global) {
  'use strict';

  var PUBLIC_KEY = 'HMMGz4JpCMXiMFuTm3ikWsTX6TYKucGN43AaGDMMF0c=';
  var PREFIX = 'DFT-';
  var ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';   // بلا 0/O و1/I/L المتشابهة

  function utf8(s) { return new TextEncoder().encode(s); }
  function b64ToBytes(s) {
    var bin = atob(s), out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function b64urlToBytes(s) {
    s = s.replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    return b64ToBytes(s);
  }

  // XXXXX-XXXXX من بصمة المعرّف الخام (50 بت)
  function codeFrom(raw) {
    var h = global.nacl.hash(utf8('daftara-device:' + raw));
    var bits = 0, val = 0, out = '';
    for (var i = 0; out.length < 10; i++) {
      val = (val << 8) | h[i]; bits += 8;
      while (bits >= 5 && out.length < 10) { out += ALPHABET[(val >> (bits - 5)) & 31]; bits -= 5; }
      val &= (1 << bits) - 1;
    }
    return out.slice(0, 5) + '-' + out.slice(5);
  }

  function rawId() {
    var N = global.Native;
    if (N && N.deviceId) return N.deviceId().then(function (id) { if (id) return (N.idPrefix || 'android:') + id; return webSeed(); });
    return webSeed();
  }
  function webSeed() {
    return DB.getSettings().then(function (s) {
      if (s.deviceSeed) return 'web:' + s.deviceSeed;
      var r = global.nacl.randomBytes(16), hex = '';
      for (var i = 0; i < r.length; i++) hex += (r[i] < 16 ? '0' : '') + r[i].toString(16);
      return DB.setSetting('deviceSeed', hex).then(function () { return 'web:' + hex; });
    });
  }

  var License = {
    FREE_LIMIT: Number.MAX_SAFE_INTEGER,
    OWNER_PHONE: '970597750343',      // واتساب طلبات التفعيل (MakeFlow)
    PRICE: '20 شيكل',                 // سعر الكود في النسخة المباشرة (غزة)؛ نسخة Play سعرها من المتجر

    // لا يرمي أبدًا: أي خطأ في معرّف الجهاز ينزل إلى رقم المتصفح، فلا يمنع فتح الدفتر
    deviceCode: function () {
      return Promise.resolve().then(rawId).catch(webSeed).then(codeFrom);
    },

    // يأخذ نص الرسالة كما لُصق (من واتساب مثلًا) ويستخرج الكود منه
    extract: function (text) {
      var m = /DFT-([A-Za-z0-9_-]{80,90})/.exec(String(text || '').replace(/\s+/g, ''));
      return m ? PREFIX + m[1] : null;
    },

    verify: function (code, deviceCode) {
      try {
        if (!code || code.indexOf(PREFIX) !== 0 || !deviceCode) return false;
        var sig = b64urlToBytes(code.slice(PREFIX.length));
        if (sig.length !== 64) return false;
        return global.nacl.sign.detached.verify(utf8('daftara-license-v1|' + deviceCode), sig, b64ToBytes(PUBLIC_KEY));
      } catch (e) { return false; }
    },

    /* ---------- المزامنة بين الأجهزة: اشتراك سنوي ----------
       كود المزامنة DSY-YYYYMMDD-<توقيع>: توقيع Ed25519 على رقم الجهاز وتاريخ انتهاء السنة،
       فلا يُغيَّر التاريخ ولا يُنقل الكود إلى جهاز آخر. يصنعه مولّد الأكواد نفسه.
       السنة الأولى مع الشراء، والتجديد اختياري: بدونه تتوقف المزامنة فقط، والدفتر كامل كما هو. */
    SYNC_PRICE_NEW: '50 شيكل',        // دفترة الكاملة + سنة مزامنة (لمن لم يفعّل بعد)
    SYNC_PRICE_UPGRADE: '30 شيكل',    // سنة مزامنة لمن فعّل دفترة من قبل
    SYNC_PRICE_RENEW: '15 شيكل',      // تجديد سنة
    SYNC_REMIND_DAYS: 14,             // التنبيه قبل الانتهاء

    // يأخذ نص الرسالة كما لُصق ويستخرج كود المزامنة منه
    extractSync: function (text) {
      var m = /DSY-(\d{8})-([A-Za-z0-9_-]{80,90})/.exec(String(text || '').replace(/\s+/g, ''));
      return m ? 'DSY-' + m[1] + '-' + m[2] : null;
    },

    // تاريخ الانتهاء (YYYY-MM-DD) إن كان الكود صحيحًا لهذا الجهاز، وإلا null
    verifySync: function (code, deviceCode) {
      try {
        var m = /^DSY-(\d{4})(\d{2})(\d{2})-([A-Za-z0-9_-]+)$/.exec(code || '');
        if (!m || !deviceCode) return null;
        var until = m[1] + '-' + m[2] + '-' + m[3];
        var sig = b64urlToBytes(m[4]);
        if (sig.length !== 64) return null;
        var ok = global.nacl.sign.detached.verify(utf8('daftara-sync-v1|' + deviceCode + '|' + until), sig, b64ToBytes(PUBLIC_KEY));
        return ok ? until : null;
      } catch (e) { return null; }
    }
  };

  global.License = License;
})(window);
