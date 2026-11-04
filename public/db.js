/* ================= دفترة — طبقة البيانات =================
   IndexedDB عبر Dexie. لا يوجد خادم ولا حساب: كل شيء على الجهاز.
   الجداول:
     customers    : id (auto), uid, name, phone, createdAt, updatedAt, deleted
     transactions : id (auto), uid, customerId, customerUid, type ("debt"|"payment"),
                    amount, note, date, updatedAt, deleted
     settings     : key, value
   الرصيد لا يُخزَّن أبدًا — يُحسب دائمًا من الحركات.

   تجهيزًا للمزامنة بين الأجهزة:
     id        رقم محلي على هذا الجهاز فقط (قد يتكرر نفس الرقم على جوال آخر لزبون آخر).
     uid       معرّف عالمي فريد لا يتكرر على أي جهاز — به تتعرّف الأجهزة على السجل نفسه.
     updatedAt آخر تعديل؛ عند التعارض تفوز النسخة الأحدث.
     deleted   الحذف علامة لا مسح فعلي، حتى لا يعيد جهاز آخر ما حُذف هنا.
               السجلات المحذوفة لا تظهر في التطبيق ولا في النسخ الاحتياطية.
================================================================ */
(function (global) {
  'use strict';

  // المكتبة من نسخة محلية فقط، لا من خادم خارجي: لو اختُرق الخادم لقرأ الكود المزيّف الدفتر كله
  var DEXIE_LOCAL = 'vendor/dexie.min.js';

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src;
      s.async = false;
      s.onload = resolve;
      s.onerror = function () { reject(new Error('failed: ' + src)); };
      document.head.appendChild(s);
    });
  }

  function ensureDexie() {
    if (global.Dexie) return Promise.resolve();
    return loadScript(DEXIE_LOCAL)
      .then(function () {
        if (!global.Dexie) throw new Error('Dexie unavailable');
      });
  }

  var db = null;

  function newUid() {
    var c = global.crypto;
    if (c && c.randomUUID) return c.randomUUID();
    var b = new Uint8Array(16);
    c.getRandomValues(b);
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    var h = Array.prototype.map.call(b, function (x) { return (x + 256).toString(16).slice(1); }).join('');
    return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
  }
  function now() { return new Date().toISOString(); }
  function alive(r) { return !r.deleted; }

  var DB = {
    open: function () {
      if (db) return Promise.resolve(db);
      return ensureDexie().then(function () {
        db = new global.Dexie('daftara');
        db.version(1).stores({
          customers: '++id, name, createdAt',
          transactions: '++id, customerId, date',
          settings: 'key'
        });
        // v2: معرّف عالمي وتاريخ تعديل لكل سجل، تمهيدًا للمزامنة
        db.version(2).stores({
          customers: '++id, name, createdAt, &uid, updatedAt',
          transactions: '++id, customerId, date, &uid, customerUid, updatedAt',
          settings: 'key'
        }).upgrade(function (tx) {
          var uidOf = Object.create(null);   // id الزبون -> uid
          return tx.table('customers').toCollection().modify(function (c) {
            c.uid = c.uid || newUid();
            c.updatedAt = c.updatedAt || c.createdAt || now();
            c.deleted = c.deleted ? 1 : 0;
            uidOf[c.id] = c.uid;
          }).then(function () {
            return tx.table('transactions').toCollection().modify(function (t) {
              t.uid = t.uid || newUid();
              t.customerUid = uidOf[t.customerId] || '';
              t.updatedAt = t.updatedAt || t.date || now();
              t.deleted = t.deleted ? 1 : 0;
            });
          });
        });
        return db.open().then(function () { return db; });
      });
    },

    newUid: newUid,

    /* ---------- الإعدادات ---------- */
    getSettings: function () {
      return db.settings.toArray().then(function (rows) {
        var out = {};
        rows.forEach(function (r) { out[r.key] = r.value; });
        return out;
      });
    },
    setSetting: function (key, value) {
      return db.settings.put({ key: key, value: value });
    },

    /* ---------- الزبائن ---------- */
    allCustomers: function () { return db.customers.filter(alive).toArray(); },

    // حقول اختيارية للزبون: note (ملاحظة)، remindAt (ISO) و remindText (تذكير لصاحب المحل)
    addCustomer: function (name, phone, note) {
      var t = now();
      return db.customers.add({
        uid: newUid(),
        name: name,
        phone: phone || '',
        note: note || '',
        createdAt: t,
        updatedAt: t,
        deleted: 0
      });
    },
    updateCustomer: function (id, name, phone, note) {
      return db.customers.update(id, { name: name, phone: phone || '', note: note || '', updatedAt: now() });
    },
    setReminder: function (id, at, text) {
      return db.customers.update(id, { remindAt: at || '', remindText: text || '', updatedAt: now() });
    },
    // حذف الزبون يحذف حركاته معه (علامة حذف، انظر أعلى الملف)
    deleteCustomer: function (id) {
      var t = now();
      return db.transaction('rw', db.customers, db.transactions, function () {
        db.transactions.where('customerId').equals(id).modify({ deleted: 1, updatedAt: t });
        db.customers.update(id, { deleted: 1, updatedAt: t });
      });
    },

    /* ---------- الحركات ---------- */
    allTransactions: function () { return db.transactions.filter(alive).toArray(); },

    // date اختياري (ISO): لتسجيل دين قديم بتاريخه؛ بدونه تاريخ الآن
    addTransaction: function (customerId, type, amount, note, date) {
      return db.customers.get(customerId).then(function (c) {
        var t = now();
        return db.transactions.add({
          uid: newUid(),
          customerId: customerId,
          customerUid: c ? c.uid : '',
          type: type,
          amount: amount,
          note: note || '',
          date: date || t,
          updatedAt: t,
          deleted: 0
        });
      });
    },
    // تعديل المبلغ والملاحظة، والتاريخ إن تغيّر
    updateTransaction: function (id, amount, note, date) {
      var ch = { amount: amount, note: note || '', updatedAt: now() };
      if (date) ch.date = date;
      return db.transactions.update(id, ch);
    },
    deleteTransaction: function (id) {
      return db.transactions.update(id, { deleted: 1, updatedAt: now() });
    },

    /* ---------- النسخ الاحتياطي ---------- */
    exportAll: function () {
      return Promise.all([
        DB.allCustomers(),
        DB.allTransactions(),
        // مفتاح المزامنة لا يخرج في ملف النسخة (قد يُرسل الملف عبر واتساب)
        db.settings.filter(function (r) { return !isSyncKey(r.key); }).toArray()
      ]).then(function (r) {
        return {
          app: 'daftara',
          version: 2,
          exportedAt: new Date().toISOString(),
          customers: r[0],
          transactions: r[1],
          settings: r[2]
        };
      });
    },

    // يضيف محتوى الملف إلى الدفتر الحالي دون مسح شيء.
    // الزبون الموجود بنفس uid أو بنفس الاسم لا يتكرر، والحركة الموجودة بنفس uid أو بنفس
    // النوع والمبلغ والتاريخ لا تتكرر — فاستيراد الملف نفسه مرتين لا يضاعف شيئًا.
    // الإعدادات (اسم المحل والعملة) تبقى كما هي.
    mergeAll: function (data) {
      var res = { newCustomers: 0, newTx: 0, skippedTx: 0 };
      // الاسم وحده يميّز الزبون (لا يتكرر اسم في الدفتر)، بتطبيع الهمزات والتاء المربوطة والمسافات
      function key(c) {
        return String(c.name).toLowerCase().trim()
          .replace(/[\u064B-\u0652\u0670]/g, '').replace(/[آأإٱ]/g, 'ا')
          .replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/\s+/g, ' ');
      }
      function txKey(t) { return t.type + '|' + t.amount + '|' + t.date; }
      return db.transaction('rw', db.customers, db.transactions, function () {
        return Promise.all([db.customers.toArray(), db.transactions.toArray()]).then(function (cur) {
          // uid مأخوذ (حتى لسجل محذوف) -> يُعطى السجل القادم uid جديدًا ولا يُحيا المحذوف
          var taken = Object.create(null);
          var byKey = Object.create(null), byUid = Object.create(null);
          cur[0].forEach(function (c) {
            taken[c.uid] = true;
            if (c.deleted) return;
            byKey[key(c)] = c;
            byUid[c.uid] = c;
          });
          var seen = Object.create(null);   // customerId -> {txKey:true}
          var seenUid = Object.create(null);
          cur[1].forEach(function (t) {
            taken[t.uid] = true;
            if (t.deleted) return;
            seenUid[t.uid] = true;
            (seen[t.customerId] = seen[t.customerId] || Object.create(null))[txKey(t)] = true;
          });
          function freshUid(u) {
            if (!u || taken[u]) u = newUid();
            taken[u] = true;
            return u;
          }

          var idMap = Object.create(null);  // id في الملف -> الزبون في الدفتر
          return data.customers.reduce(function (p, c) {
            return p.then(function () {
              var k = key(c);
              var hit = (c.uid && byUid[c.uid]) || byKey[k];
              if (hit) { idMap[c.id] = hit; return; }
              var t = now();
              var rec = {
                uid: freshUid(c.uid),
                name: c.name, phone: c.phone || '', note: c.note || '',
                remindAt: c.remindAt || '', remindText: c.remindText || '',
                createdAt: c.createdAt || t, updatedAt: c.updatedAt || t, deleted: 0
              };
              return db.customers.add(rec).then(function (id) {
                rec.id = id;
                byKey[k] = byUid[rec.uid] = idMap[c.id] = rec;
                res.newCustomers++;
              });
            });
          }, Promise.resolve()).then(function () {
            var add = [];
            data.transactions.forEach(function (t) {
              var cust = idMap[t.customerId];
              var cid = cust.id;
              var s = (seen[cid] = seen[cid] || Object.create(null));
              if ((t.uid && seenUid[t.uid]) || s[txKey(t)]) { res.skippedTx++; return; }
              s[txKey(t)] = true;
              var u = freshUid(t.uid);
              seenUid[u] = true;
              add.push({
                uid: u, customerId: cid, customerUid: cust.uid,
                type: t.type, amount: t.amount, note: t.note || '', date: t.date,
                updatedAt: t.updatedAt || now(), deleted: 0
              });
            });
            res.newTx = add.length;
            return db.transactions.bulkAdd(add);
          });
        });
      }).then(function () { return res; });
    },

    // يستبدل كل البيانات الحالية بمحتوى الملف (بعد تأكيد المستخدم).
    // إعدادات المزامنة (sync*) تخص هذا الجهاز: تبقى كما هي ولا تُؤخذ من الملف.
    importAll: function (data) {
      return db.transaction('rw', db.customers, db.transactions, db.settings, function () {
        return db.settings.toArray().then(function (cur) {
          var keep = cur.filter(function (r) { return isSyncKey(r.key); });
          var from = (data.settings || []).filter(function (r) { return !isSyncKey(r.key); });
          db.customers.clear();
          db.transactions.clear();
          db.settings.clear();
          db.customers.bulkAdd(data.customers);
          db.transactions.bulkAdd(data.transactions);
          db.settings.bulkAdd(from.concat(keep));
        });
      });
    },

    /* ---------- المزامنة (sync.js) ----------
       pushed = قيمة updatedAt التي رُفعت آخر مرة؛ السجل الذي تغيّر بعدها ينتظر الرفع. */

    // ما تغيّر هنا ولم يُرفع بعد، بالصيغة المشتركة بين الأجهزة (بلا الأرقام المحلية)
    syncChanges: function () {
      return Promise.all([
        db.customers.filter(function (c) { return c.pushed !== c.updatedAt; }).toArray(),
        db.transactions.filter(function (t) { return t.pushed !== t.updatedAt; }).toArray()
      ]).then(function (r) {
        return { c: r[0].map(shareable), t: r[1].map(shareable) };
      });
    },

    // بعد رفع ناجح: يُعلَّم ما رُفع، إلا ما تغيّر مرة أخرى أثناء الرفع
    markPushed: function (ch) {
      function mark(table, list) {
        return Promise.all(list.map(function (r) {
          return table.where('uid').equals(r.uid).modify(function (x) {
            if (x.updatedAt === r.updatedAt) x.pushed = r.updatedAt;
          });
        }));
      }
      return db.transaction('rw', db.customers, db.transactions, function () {
        return Promise.all([mark(db.customers, ch.c), mark(db.transactions, ch.t)]);
      });
    },

    // يطبّق ما وصل من جهاز آخر: السجل الجديد يُضاف، والموجود يُستبدل فقط إن كان القادم أحدث.
    // يعيد {changed, orphans}: orphans حركات لم نجد زبونها بعد (تنتظر وصوله).
    applyRemote: function (ch) {
      var res = { changed: 0, orphans: [] };
      return db.transaction('rw', db.customers, db.transactions, function () {
        return (ch.c || []).reduce(function (p, rc) {
          return p.then(function () {
            return db.customers.where('uid').equals(rc.uid).first().then(function (l) {
              var rec = pickCustomer(rc);
              rec.pushed = rec.updatedAt;
              if (!l) { res.changed++; return db.customers.add(rec); }
              if (rec.updatedAt > l.updatedAt) { res.changed++; return db.customers.update(l.id, rec); }
            });
          });
        }, Promise.resolve()).then(function () {
          return (ch.t || []).reduce(function (p, rt) {
            return p.then(function () {
              return Promise.all([
                db.customers.where('uid').equals(rt.customerUid).first(),
                db.transactions.where('uid').equals(rt.uid).first()
              ]).then(function (r) {
                var c = r[0], l = r[1];
                if (!c) { res.orphans.push(rt); return; }
                var rec = pickTx(rt);
                rec.customerId = c.id;
                rec.pushed = rec.updatedAt;
                if (!l) { res.changed++; return db.transactions.add(rec); }
                if (rec.updatedAt > l.updatedAt) { res.changed++; return db.transactions.update(l.id, rec); }
              });
            });
          }, Promise.resolve());
        });
      }).then(function () { return res; });
    },

    // إعدادات المحل المشتركة بين الأجهزة، مع وقت آخر تعديل لها
    sharedSettings: function () {
      return DB.getSettings().then(function (s) {
        var out = { at: s.sharedAt || '' };
        SHARED_KEYS.forEach(function (k) { out[k] = s[k] == null ? '' : s[k]; });
        return out;
      });
    },
    // تُستبدل فقط إن كانت القادمة أحدث؛ يعيد true إن تغيّر شيء
    applySharedSettings: function (r) {
      return db.transaction('rw', db.settings, function () {
        return db.settings.get('sharedAt').then(function (cur) {
          if (!r || !r.at || (cur && cur.value >= r.at)) return false;
          var rows = SHARED_KEYS.filter(function (k) { return typeof r[k] === 'string'; })
            .map(function (k) { return { key: k, value: r[k] }; });
          rows.push({ key: 'sharedAt', value: r.at }, { key: 'syncSharedPushed', value: r.at });
          return db.settings.bulkPut(rows).then(function () { return true; });
        });
      });
    },

    // بعد الربط بدفتر جديد (أو فكّه): كل السجلات تُعتبر غير مرفوعة
    resetPushed: function () {
      function reset(x) { delete x.pushed; }
      return db.transaction('rw', db.customers, db.transactions, function () {
        db.customers.toCollection().modify(reset);
        db.transactions.toCollection().modify(reset);
      });
    },

    // يمسح الزبائن والحركات فقط (الانضمام إلى دفتر جهاز آخر بدل الدمج معه)
    clearLedger: function () {
      return db.transaction('rw', db.customers, db.transactions, function () {
        db.customers.clear();
        db.transactions.clear();
      });
    }
  };

  // إعدادات المحل التي تنتقل بين الأجهزة؛ تعديلها يحدّث sharedAt
  var SHARED_KEYS = ['shopName', 'currency', 'logo'];
  function isSyncKey(k) { return /^sync[A-Z]/.test(k); }

  var CUSTOMER_FIELDS = ['uid', 'name', 'phone', 'note', 'remindAt', 'remindText', 'createdAt', 'updatedAt', 'deleted'];
  var TX_FIELDS = ['uid', 'customerUid', 'type', 'amount', 'note', 'date', 'updatedAt', 'deleted'];
  function pick(r, fields) {
    var o = {};
    fields.forEach(function (f) { if (r[f] !== undefined) o[f] = r[f]; });
    return o;
  }
  function shareable(r) { return pick(r, r.customerUid !== undefined ? TX_FIELDS : CUSTOMER_FIELDS); }
  function pickCustomer(r) {
    var o = pick(r, CUSTOMER_FIELDS);
    o.deleted = o.deleted ? 1 : 0;
    return o;
  }
  function pickTx(r) {
    var o = pick(r, TX_FIELDS);
    o.deleted = o.deleted ? 1 : 0;
    return o;
  }

  // تعديل إعدادات المحل المشتركة يسجّل وقته، لتصل الأجهزة الأخرى
  var setSetting = DB.setSetting;
  DB.setSetting = function (key, value) {
    if (SHARED_KEYS.indexOf(key) < 0) return setSetting(key, value);
    return db.settings.bulkPut([{ key: key, value: value }, { key: 'sharedAt', value: now() }]);
  };

  /* التحقق من صحة ملف النسخة الاحتياطية قبل الاستعادة.
     يعيد {ok:true, data} أو {ok:false, error:"رسالة بالعربية"} */
  DB.validateBackup = function (raw) {
    var data;
    try {
      data = JSON.parse(raw);
    } catch (e) {
      return { ok: false, error: 'الملف غير صالح — تأكد أنه ملف النسخة الاحتياطية.' };
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return { ok: false, error: 'الملف غير صالح — تأكد أنه ملف النسخة الاحتياطية.' };
    }
    if (data.app && data.app !== 'daftara') {
      return { ok: false, error: 'هذا الملف من تطبيق آخر.' };
    }
    if (!Array.isArray(data.customers) || !Array.isArray(data.transactions)) {
      return { ok: false, error: 'الملف ناقص — لا يحتوي على الزبائن والحركات.' };
    }
    if (data.settings != null && !Array.isArray(data.settings)) {
      return { ok: false, error: 'الملف ناقص أو تالف.' };
    }

    var ids = Object.create(null);
    var i, c, t;
    for (i = 0; i < data.customers.length; i++) {
      c = data.customers[i];
      if (!c || typeof c !== 'object') return { ok: false, error: 'بيانات الزبائن تالفة في الملف.' };
      if (typeof c.id !== 'number' || typeof c.name !== 'string' || !c.name) {
        return { ok: false, error: 'بيانات الزبائن تالفة في الملف.' };
      }
      ids[c.id] = true;
    }
    for (i = 0; i < data.transactions.length; i++) {
      t = data.transactions[i];
      if (!t || typeof t !== 'object') return { ok: false, error: 'بيانات الحركات تالفة في الملف.' };
      if (typeof t.customerId !== 'number' ||
          (t.type !== 'debt' && t.type !== 'payment') ||
          typeof t.amount !== 'number' || !isFinite(t.amount) ||
          typeof t.date !== 'string' || !t.date) {
        return { ok: false, error: 'بيانات الحركات تالفة في الملف.' };
      }
    }

    // تنظيف: نحتفظ بالحقول المعرَّفة فقط، ونحذف الحركات بلا زبون.
    // النسخ القديمة (قبل v2) بلا uid: يُولَّد لها؛ و uid المكرر في الملف يُستبدل.
    var used = Object.create(null);
    function uidOr(u) {
      if (typeof u !== 'string' || !u || used[u]) u = newUid();
      used[u] = true;
      return u;
    }
    var uidOfId = Object.create(null);
    var customers = data.customers.map(function (x) {
      var created = typeof x.createdAt === 'string' ? x.createdAt : now();
      var o = {
        id: x.id,
        uid: uidOr(x.uid),
        name: String(x.name),
        phone: typeof x.phone === 'string' ? x.phone : '',
        note: typeof x.note === 'string' ? x.note : '',
        remindAt: typeof x.remindAt === 'string' ? x.remindAt : '',
        remindText: typeof x.remindText === 'string' ? x.remindText : '',
        createdAt: created,
        updatedAt: typeof x.updatedAt === 'string' ? x.updatedAt : created,
        deleted: 0
      };
      uidOfId[o.id] = o.uid;
      return o;
    });
    var transactions = data.transactions
      .filter(function (x) { return ids[x.customerId]; })
      .map(function (x) {
        var o = {
          uid: uidOr(x.uid),
          customerId: x.customerId,
          customerUid: uidOfId[x.customerId],
          type: x.type,
          amount: x.amount,
          note: typeof x.note === 'string' ? x.note : '',
          date: x.date,
          updatedAt: typeof x.updatedAt === 'string' ? x.updatedAt : x.date,
          deleted: 0
        };
        if (typeof x.id === 'number') o.id = x.id;
        return o;
      });
    var settings = (data.settings || []).filter(function (x) {
      return x && typeof x.key === 'string';
    }).map(function (x) { return { key: x.key, value: x.value }; });

    return {
      ok: true,
      data: { customers: customers, transactions: transactions, settings: settings }
    };
  };

  global.DB = DB;
})(window);
