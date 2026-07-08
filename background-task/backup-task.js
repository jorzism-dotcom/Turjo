// ═══════════════════════════════════════════════════════════════════════════
// SBM Background Backup Task — Capacitor Background Runner
// ═══════════════════════════════════════════════════════════════════════════
//
// ⚠️⚠️⚠️ গুরুত্বপূর্ণ সততার নোট (দয়া করে পড়ুন) ⚠️⚠️⚠️
// এই ফাইলটা একটা সম্পূর্ণ আলাদা, sandboxed native JS context-এ চলে — এটা
// আপনার React app-এর কোনো state, Firebase SDK, বা DOM access করতে পারে না।
// শুধু নির্দিষ্ট কিছু global API পাওয়া যায়: CapacitorKV (key-value store),
// fetch(), CapacitorNotifications।
//
// এই কোড আমার (Claude) training data-এর ভিত্তিতে লেখা, কিন্তু:
//   ১. আমার কাছে কোনো real Android device বা emulator নেই টেস্ট করার জন্য
//   ২. @capacitor/background-runner প্লাগিনের সঠিক API surface/folder convention
//      ভার্সনে ভার্সনে বদলাতে পারে — আমি লেখার সময় ১০০% নিশ্চিত হতে পারিনি যে
//      নিচের registration path/event pattern বর্তমান v2.3.1-এর সাথে হুবহু মেলে
//   ৩. এটা প্রোডাকশনে দেওয়ার আগে অবশ্যই official docs
//      (https://github.com/capacitor-community/background-runner) দিয়ে
//      cross-check করা এবং একটা টেস্ট ডিভাইসে (৫০০ দোকানের কোনোটায় না) চালিয়ে
//      দেখা উচিত।
//
// কাজ: প্রতি ~৬০ মিনিটে (OS battery-optimization অনুযায়ী কম-বেশি হতে পারে)
// Firestore REST API দিয়ে সরাসরি (Firebase JS SDK ছাড়াই, কারণ SDK এখানে
// available না) customers + invoices collection টেনে একটা কমপ্যাক্ট snapshot
// CapacitorKV-তে জমা রাখে — যাতে অ্যাপ সম্পূর্ণ বন্ধ থাকা অবস্থাতেও একটা সাম্প্রতিক
// backup snapshot ডিভাইসে (native storage, IndexedDB-নির্ভর না) থেকে যায়।
// মূল app চালু হলে এই snapshot পড়ে existing backup file-এর সাথে তুলনা করে
// প্রয়োজনে ব্যবহার করতে পারে (এই সেশনে main app-side সেই read-back যোগ করা হয়েছে)।

addEventListener('shopBackupCheck', async (resolve, reject, args) => {
  try {
    // ── Config resolution: main app যখন খোলা থাকে, dispatchEvent দিয়ে args-এ
    // apiKey/projectId পাঠায় (এই সেশনে App.jsx-এ যোগ করা হয়েছে) — সেটা পেলে
    // KV-তে cache করে রাখি, যাতে OS নিজে থেকে (app বন্ধ থাকা অবস্থায়) এই টাস্ক
    // চালালেও শেষবার জানা config দিয়ে কাজ করতে পারে।
    let cfg = null;
    if (args && args.apiKey && args.projectId) {
      cfg = { apiKey: args.apiKey, projectId: args.projectId };
      try { await CapacitorKV.set('sbm_bg_firebase_cfg', JSON.stringify(cfg)); } catch {}
    } else {
      try {
        const cached = await CapacitorKV.get('sbm_bg_firebase_cfg');
        if (cached && cached.value) cfg = JSON.parse(cached.value);
      } catch {}
    }
    if (!cfg || !cfg.projectId || !cfg.apiKey) { resolve(); return; } // কনফিগ কোথাও পাওয়া যায়নি — কিছু করার নেই

    const base = `https://firestore.googleapis.com/v1/projects/${cfg.projectId}/databases/(default)/documents`;

    // Firestore REST-এর nested {stringValue:...}/{integerValue:...} ফরম্যাট
    // থেকে সাধারণ JS object-এ রূপান্তর
    function unwrapValue(v) {
      if (v == null) return null;
      if ("stringValue" in v) return v.stringValue;
      if ("integerValue" in v) return Number(v.integerValue);
      if ("doubleValue" in v) return v.doubleValue;
      if ("booleanValue" in v) return v.booleanValue;
      if ("nullValue" in v) return null;
      if ("timestampValue" in v) return v.timestampValue;
      if ("mapValue" in v) return unwrapFields(v.mapValue.fields || {});
      if ("arrayValue" in v) return (v.arrayValue.values || []).map(unwrapValue);
      return null;
    }
    function unwrapFields(fields) {
      const out = {};
      for (const k in fields) out[k] = unwrapValue(fields[k]);
      return out;
    }

    async function fetchCollection(name) {
      try {
        const res = await fetch(`${base}/${name}?key=${cfg.apiKey}&pageSize=1000`);
        if (!res.ok) return [];
        const data = await res.json();
        if (!data.documents) return [];
        return data.documents.map(d => ({
          id: d.name.split("/").pop(),
          ...unwrapFields(d.fields || {}),
        }));
      } catch { return []; }
    }

    // স্কোপ সীমিত রাখা হয়েছে — শুধু সবচেয়ে টাকা-সংক্রান্ত collection দুটো
    // (পুরো ১৪টা collection টানলে ডিভাইস ডেটা/ব্যাটারি খরচ বেড়ে যেত)
    const [customers, invoices] = await Promise.all([
      fetchCollection("customers"),
      fetchCollection("invoices"),
    ]);

    await CapacitorKV.set('sbm_bg_backup_snapshot', JSON.stringify({
      customers, invoices,
      snapshotAt: new Date().toISOString(),
    }));
    await CapacitorKV.set('sbm_bg_last_run', new Date().toISOString());

    resolve();
  } catch (e) {
    // ব্যর্থ হলেও silently resolve করা হয় — background task ব্যর্থ হলে যেন
    // OS retry-loop/crash-loop-এ না ঢোকে
    resolve();
  }
});
