// ─── tests/sync-emulator-tests.mjs ─────────────────────────────────────────
// ফেজ B (ENTERPRISE_MONITORING_PLAN.md স্তর ২) — real Firestore Emulator-এ
// multi-device sync/backup integration টেস্ট। tests/sync-tests.mjs (pure,
// হাতে-বসানো timestamp/data) থেকে এটা আলাদা: এখানে src/sync.js-এর
// mergeCollection()/pickBackupFields()/diffBackupFields()/hashCollection()
// আসল Firestore ডকুমেন্টের বিপরীতে (real serverTimestamp resolution, real
// network round-trip, real JSON serialize/deserialize) চালিয়ে দেখা হয় —
// অর্থাৎ conflict-resolution নীতিটা শুধু কাগজে-কলমে সঠিক না, real Firestore
// latency/ordering-এর সাথেও সঠিকভাবে কাজ করে তা যাচাই।
//
// রান করার আগে emulator চালু থাকতে হবে:
//   npx firebase emulators:exec --only firestore "node tests/sync-emulator-tests.mjs"
// অথবা প্যাকেজ স্ক্রিপ্ট দিয়ে:
//   npm run test:sync-emulator
//
// কভারেজ (ENTERPRISE_MONITORING_PLAN.md ফেজ B):
//   B1. ৩+ ডিভাইস simultaneous conflict — একই রেকর্ড দুই "ডিভাইস" থেকে
//       একসাথে write, real serverTimestamp দিয়ে mergeCollection()/effectiveTs()
//       সঠিকভাবে জেতা রেকর্ড বাছাই করে কিনা।
//   B2. Network-drop mid-merge — outbox-এর মতো আংশিক পুশ (কিছু রেকর্ড
//       সফল, কিছু "resume" এর অপেক্ষায়) simulate করে, resume-এর পরেও কোনো
//       রেকর্ড হারায় না বা ডুপ্লিকেট/করাপ্ট হয় না তা যাচাই।
//   B3. Backup→restore byte-for-byte round-trip — real ডেটা write → fetch →
//       pickBackupFields → JSON serialize (ফাইলে-সেভ simulate) → নতুন
//       "ডিভাইসে" restore (write) → fetch → diffBackupFields/hashCollection
//       দিয়ে zero-drift নিশ্চিত করা, পুরনো backup format (extra unknown কী)
//       backward-compat সহ।

import { readFileSync } from "node:fs";
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import {
  doc, setDoc, getDoc, getDocs, collection, serverTimestamp, deleteDoc,
} from "firebase/firestore";
import {
  mergeCollection, pickBackupFields, diffBackupFields, hashCollection,
  effectiveTs, BACKUP_FIELDS,
} from "../src/sync.js";

let passed = 0;
let failed = 0;
const failures = [];

async function check(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✅ ${name}`);
  } catch (e) {
    failed++;
    failures.push({ name, error: e.message });
    console.log(`  ❌ ${name} — ${e.message}`);
  }
}

// real Firestore-এ লেখা সব ডকুমেন্ট fetch করে sync.js-এর সাথে সামঞ্জস্যপূর্ণ
// প্লেইন array-তে রূপান্তর করে (Firestore Timestamp → millis, যেমন app real
// জীবনে .toMillis() করে করে থাকে)
async function fetchCollectionAsArray(db, colName) {
  const snap = await getDocs(collection(db, colName));
  const out = [];
  snap.forEach(d => {
    const data = d.data();
    out.push({
      ...data,
      id: d.id,
      _serverTs: data._serverTs?.toMillis ? data._serverTs.toMillis() : (data._serverTs || null),
    });
  });
  return out;
}

async function main() {
  console.log("\n🔥 Sync/Backup Emulator ইন্টিগ্রেশন টেস্ট সুইট (ফেজ B)\n");

  const testEnv = await initializeTestEnvironment({
    projectId: "demo-sbm-test",
    firestore: {
      rules: readFileSync("firestore.rules", "utf8"),
      host: "127.0.0.1",
      port: 8080,
    },
  });

  // এই অ্যাপে Auth নেই — সব ডিভাইস unauthenticated context থেকেই লেখে,
  // production behavior-এর সাথে মেলে (rules-tests.mjs-এর মতোই)।
  const deviceA = testEnv.unauthenticatedContext().firestore();
  const deviceB = testEnv.unauthenticatedContext().firestore();

  await testEnv.clearFirestore();

  // ══════════════════════════════════════════════════════════════════════
  // B1. মাল্টি-ডিভাইস কনফ্লিক্ট — real serverTimestamp() দিয়ে
  // ══════════════════════════════════════════════════════════════════════

  await check("B1: দুই ডিভাইস একই কাস্টমার আলাদা সময়ে লিখলে, real সার্ভার-টাইম অনুযায়ী পরেরটা জেতে", async () => {
    // ডিভাইস A প্রথমে লেখে
    await setDoc(doc(deviceA, "customers/cust-conflict-1"), {
      name: "ডিভাইস-A-এর-এডিট", balance: 100, _serverTs: serverTimestamp(),
    });
    const afterA = await getDoc(doc(deviceA, "customers/cust-conflict-1"));
    const recA = { ...afterA.data(), id: "cust-conflict-1", _serverTs: afterA.data()._serverTs.toMillis() };

    // কিছুক্ষণ পর ডিভাইস B (অন্য ডিভাইস, একই রেকর্ড) লেখে — real ঘড়ির ব্যবধান
    await new Promise(r => setTimeout(r, 50));
    await setDoc(doc(deviceB, "customers/cust-conflict-1"), {
      name: "ডিভাইস-B-এর-এডিট", balance: 200, _serverTs: serverTimestamp(),
    });
    const afterB = await getDoc(doc(deviceB, "customers/cust-conflict-1"));
    const recB = { ...afterB.data(), id: "cust-conflict-1", _serverTs: afterB.data()._serverTs.toMillis() };

    // ডিভাইস A এখনো নিজের পুরনো local কপি নিয়ে অফলাইন ছিল বলে ধরা হচ্ছে —
    // Master Sync চললে local=[পুরনো recA], remote=[নতুন recB (server-এ যা আছে)]
    const { merged, changed } = mergeCollection([recA], [recB], new Set());
    const winner = merged.find(r => r.id === "cust-conflict-1");

    if (!changed) throw new Error("changed=false হওয়ার কথা না, নতুন serverTs জিতেছে");
    if (winner.name !== "ডিভাইস-B-এর-এডিট") {
      throw new Error(`প্রত্যাশিত "ডিভাইস-B-এর-এডিট", পাওয়া গেছে "${winner.name}" — real serverTs অর্ডারিং মিলছে না`);
    }
    if (!(recB._serverTs > recA._serverTs)) {
      throw new Error("emulator-এর real serverTimestamp ক্রমানুসারে বাড়েনি — পরিবেশ সমস্যা");
    }
  });

  await check("B1: ৩ ডিভাইসের simultaneous write — সবচেয়ে পরের real serverTs-ই টেকে (৩-উপায় কনফ্লিক্ট)", async () => {
    const deviceC = testEnv.unauthenticatedContext().firestore();
    await setDoc(doc(deviceA, "customers/cust-3way"), { name: "A", balance: 1, _serverTs: serverTimestamp() });
    const a1 = await getDoc(doc(deviceA, "customers/cust-3way"));
    await new Promise(r => setTimeout(r, 30));
    await setDoc(doc(deviceB, "customers/cust-3way"), { name: "B", balance: 2, _serverTs: serverTimestamp() });
    const b1 = await getDoc(doc(deviceB, "customers/cust-3way"));
    await new Promise(r => setTimeout(r, 30));
    await setDoc(doc(deviceC, "customers/cust-3way"), { name: "C", balance: 3, _serverTs: serverTimestamp() });
    const c1 = await getDoc(doc(deviceC, "customers/cust-3way"));

    const toRec = (snap) => ({ ...snap.data(), id: "cust-3way", _serverTs: snap.data()._serverTs.toMillis() });
    const recA = toRec(a1), recB = toRec(b1), recC = toRec(c1);

    // pairwise merge (App.jsx-এর performMasterSync একই কালেকশনের সব রেকর্ড
    // নিয়ে একবারে merge করে, এখানে ৩টা ভার্সন সিমুলেট করতে ধাপে-ধাপে merge)
    const step1 = mergeCollection([recA], [recB], new Set());
    const step2 = mergeCollection(step1.merged, [recC], new Set());
    const winner = step2.merged.find(r => r.id === "cust-3way");
    if (winner.name !== "C") throw new Error(`সবচেয়ে পরের রিয়েল serverTs-ওয়ালা ("C") জেতার কথা, পাওয়া গেছে "${winner.name}"`);
  });

  // ══════════════════════════════════════════════════════════════════════
  // B2. Network-drop mid-merge — আংশিক পুশ + resume simulate
  // ══════════════════════════════════════════════════════════════════════

  await check("B2: batch পুশের মাঝপথে সংযোগ বিচ্ছিন্ন হলে — যা পাঠানো হয়েছে তা-ই টেকে, বাকিটা resume-এ ঠিকমতো যোগ হয়, কিছু হারায়/ডুপ্লিকেট হয় না", async () => {
    const localBatch = [
      { id: "p1", name: "পণ্য-১", stock: 5, _updatedAt: 1000 },
      { id: "p2", name: "পণ্য-২", stock: 10, _updatedAt: 1000 },
      { id: "p3", name: "পণ্য-৩", stock: 15, _updatedAt: 1000 },
    ];

    // ── ধাপ ১: sync মাঝপথে "নেটওয়ার্ক বিচ্ছিন্ন" — শুধু p1, p2 আসল Firestore-এ
    //    পৌঁছেছে (outbox pattern-এ p3 এখনো local queue-তে আটকে) ──
    await setDoc(doc(deviceA, "products/p1"), pickOne(localBatch, "p1"));
    await setDoc(doc(deviceA, "products/p2"), pickOne(localBatch, "p2"));
    // p3 ইচ্ছাকৃতভাবে পাঠানো হয়নি — এটাই "network-drop"

    let remoteNow = await fetchCollectionAsArray(deviceA, "products");
    if (remoteNow.length !== 2) throw new Error(`network-drop-এর পরে remote-এ ২টা থাকার কথা, আছে ${remoteNow.length}টা`);

    // outbox resume: বাকি থাকা p3 আবার পাঠানোর চেষ্টা (real app heartbeat/online listener যেমন করে)
    await setDoc(doc(deviceA, "products/p3"), pickOne(localBatch, "p3"));

    remoteNow = await fetchCollectionAsArray(deviceA, "products");
    if (remoteNow.length !== 3) throw new Error(`resume-এর পরে remote-এ ৩টাই থাকার কথা, আছে ${remoteNow.length}টা`);

    // এখন অন্য ডিভাইস (B) sync করলে merge — কোনো ডুপ্লিকেট/করাপ্ট রেকর্ড আসা উচিত না
    const { merged } = mergeCollection([], remoteNow, new Set());
    if (merged.length !== 3) throw new Error(`merge-এর পর ৩টা distinct রেকর্ড থাকার কথা, আছে ${merged.length}টা`);
    const ids = merged.map(r => r.id).sort();
    if (JSON.stringify(ids) !== JSON.stringify(["p1", "p2", "p3"])) {
      throw new Error(`ID সেট মিলছে না: ${JSON.stringify(ids)}`);
    }
  });

  await check("B2: resume করার সময় একই রেকর্ড দুইবার পাঠালেও (retry duplicate-send) merge-এর পর একটাই কপি থাকে, ডেটা করাপ্ট হয় না", async () => {
    await setDoc(doc(deviceA, "products/p-retry"), { id: "p-retry", name: "রিট্রাই-পণ্য", stock: 7, _updatedAt: 500 });
    // network glitch-এর পর app নিশ্চিত না হতে পেরে আবার সেই এন্ট্রি পাঠায় (idempotent write)
    await setDoc(doc(deviceA, "products/p-retry"), { id: "p-retry", name: "রিট্রাই-পণ্য", stock: 7, _updatedAt: 500 });

    const remoteNow = await fetchCollectionAsArray(deviceA, "products");
    const copies = remoteNow.filter(r => r.id === "p-retry");
    if (copies.length !== 1) throw new Error(`duplicate-send-এর পরেও ঠিক ১টা কপি থাকার কথা, আছে ${copies.length}টা`);
    if (copies[0].stock !== 7) throw new Error(`ডেটা করাপ্ট হয়েছে — stock প্রত্যাশিত 7, পাওয়া গেছে ${copies[0].stock}`);
  });

  // ══════════════════════════════════════════════════════════════════════
  // B3. Backup → Restore byte-for-byte round-trip (real ডেটা দিয়ে)
  // ══════════════════════════════════════════════════════════════════════

  await check("B3: real Firestore ডেটা → backup পেলোড → নতুন ডিভাইসে restore → zero drift (added/removed/changed সব ০)", async () => {
    // ── "পুরনো ডিভাইস": আসল ডেটা লেখা ──
    // নোট: firestore.rules-এর validCustomer() balance/loyaltyPoints ঋণাত্মক
    // হলে write reject করে (দেখুন tests/rules-tests.mjs) — তাই এখানে সব
    // fixture বৈধ (non-negative) রাখা হয়েছে, নাহলে এই টেস্টই rules-এর কাছে
    // ব্যর্থ হতো (merge/backup লজিকের বাগ না, fixture ভুল হতো)।
    const sourceCustomers = [
      { id: "c1", name: "রহিম", balance: 500, loyaltyPoints: 10 },
      { id: "c2", name: "করিম", balance: 0, loyaltyPoints: 0 },
      { id: "c3", name: "জামাল উদ্দিন সরকার", balance: 12345.5, loyaltyPoints: 999 },
    ];
    for (const c of sourceCustomers) await setDoc(doc(deviceA, `customers/${c.id}`), c);

    // ── ব্যাকআপ নেওয়া (real fetch → pickBackupFields → ফাইলে সেভ simulate) ──
    const liveData = { customers: await fetchCollectionAsArray(deviceA, "customers") };
    // fetch-করা রেকর্ডে _serverTs=null (কারণ এই ডকুমেন্টে সেট করা হয়নি) — সেটা বাদ দিয়ে তুলনা করা হবে
    const backupPayload = pickBackupFields(liveData);
    const savedFile = JSON.parse(JSON.stringify(backupPayload)); // downloadBackupFile→পরে আবার আপলোড simulate

    // পুরনো ব্যাকআপ ফরম্যাট backward-compat: একটা অজানা/legacy কী থাকলেও সমস্যা না
    savedFile.legacyUnknownField = "পুরনো-ভার্সনের-ডেটা";

    // ── "নতুন ডিভাইস": খালি অবস্থা থেকে restore ──
    // এই অ্যাপে Firestore backend সব ডিভাইসের জন্য একটাই (শেয়ার্ড), তাই আসল
    // "নতুন খালি ডিভাইস" প্রমাণ করতে আলাদা কালেকশনে লেখা হচ্ছে — নাহলে source
    // collection-এই আগের ডেটা থাকায় "খালি থেকে restore" সত্যিই হলো কিনা যাচাই
    // করা যেত না। customers_pharmacy আসল, rules-ভ্যালিডেটেড path (business-type
    // variant) — একটা মনগড়া নাম ব্যবহার করলে firestore.rules-এর ডিফল্ট-ডিনাই
    // নীতির কারণে (কোনো match ব্লকে না মিললে সম্পূর্ণ deny) write-ই ব্যর্থ হতো।
    const freshDb = testEnv.unauthenticatedContext().firestore();
    const RESTORE_NS = "customers_pharmacy";
    const preRestoreSnap = await getDocs(collection(freshDb, RESTORE_NS));
    if (!preRestoreSnap.empty) throw new Error("restore-টার্গেট কালেকশন শুরুতে খালি থাকার কথা ছিল");
    for (const c of savedFile.customers) {
      const { _serverTs, ...clean } = c; // real restore path _serverTs বাদ দিয়ে plain ডেটা লেখে (নতুন push নিজেই serverTs বসাবে)
      await setDoc(doc(freshDb, `${RESTORE_NS}/${clean.id}`), clean);
    }

    // fetchCollectionAsArray সবসময় _serverTs কী বসায় (না থাকলে null) — কিন্তু
    // savedFile-এর রেকর্ডে ওই কী-ই ছিল না (কখনো serverTimestamp() লেখা হয়নি),
    // তাই দুই পাশ থেকেই _serverTs বাদ দিয়ে তুলনা করা হচ্ছে, নাহলে "null" কী-এর
    // উপস্থিতি/অনুপস্থিতিই false-positive drift দেখাবে (আসল ডেটাতে কোনো
    // পার্থক্য নেই, শুধু fetch-helper-এর placeholder ফিল্ড)।
    const stripTs = (arr) => arr.map(({ _serverTs, ...c }) => c);
    const savedClean = stripTs(savedFile.customers);
    const restoredClean = stripTs(await fetchCollectionAsArray(freshDb, RESTORE_NS));

    const diff = diffBackupFields({ customers: savedClean }, { customers: restoredClean });
    if (diff.totalAdded !== 0 || diff.totalRemoved !== 0 || diff.totalChanged !== 0) {
      throw new Error(`zero-drift প্রত্যাশিত, পাওয়া গেছে added=${diff.totalAdded} removed=${diff.totalRemoved} changed=${diff.totalChanged}`);
    }

    // content-hash দিয়েও ক্রস-চেক (order-independent, byte-for-byte সমতা)
    const beforeHash = hashCollection(savedClean);
    const afterHash = hashCollection(restoredClean);
    if (beforeHash !== afterHash) throw new Error(`content-hash মিলছে না: আগে ${beforeHash}, পরে ${afterHash}`);
  });

  await check("B3: backup পেলোডে না-থাকা field (অজানা কী) restore-এ crash করে না, শুধু BACKUP_FIELDS-এর ভেতরেরটাই লেখা হয়", async () => {
    const weirdBackup = { customers: [{ id: "cw1", name: "টেস্ট" }], _internalDebugJunk: { huge: "blob" }, randomOldKey: 42 };
    const picked = pickBackupFields(weirdBackup);
    if ("_internalDebugJunk" in picked || "randomOldKey" in picked) {
      throw new Error("অজানা কী BACKUP_FIELDS-এর বাইরে থেকে গিয়ে থাকা উচিত ছিল না");
    }
    // real restore path — শুধু picked.customers-ই লেখা হবে
    for (const c of picked.customers) await setDoc(doc(deviceA, `customers/${c.id}`), c);
    const check1 = await getDoc(doc(deviceA, "customers/cw1"));
    if (!check1.exists() || check1.data().name !== "টেস্ট") throw new Error("বৈধ field-ই ঠিকভাবে restore হয়নি");
  });

  await testEnv.cleanup();

  console.log(`\n${failed === 0 ? "✅" : "❌"} মোট ${passed + failed}টা কেসের মধ্যে ${passed}টা পাস, ${failed}টা ফেইল\n`);
  if (failed > 0) {
    console.log("ব্যর্থ কেসসমূহ:");
    for (const f of failures) console.log(`  - ${f.name}: ${f.error}`);
    process.exit(1);
  }
}

function pickOne(arr, id) {
  return arr.find(r => r.id === id);
}

main().catch((e) => {
  console.error("Sync emulator টেস্ট রানার ব্যর্থ:", e);
  process.exit(1);
});
