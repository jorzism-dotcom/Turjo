# এন্টারপ্রাইজ মনিটরিং/রিলায়েবিলিটি ইমপ্লিমেন্টেশন প্ল্যান

এই ফাইল ~৫০০ দোকানের Firebase-ভিত্তিক Turjo/SBM সিস্টেমের ৪-স্তর রিলায়েবিলিটি
গ্যাপ বন্ধ করার জন্য ধাপে-ধাপে (প্রতি ধাপ এক-সেশন-সাইজ) প্ল্যান ট্র্যাক করে।

প্রতিটা ধাপের পাশে `[ ]`/`[x]` চেকবক্স থাকবে — সেশন শুরুতে এই ফাইল দেখেই
বোঝা যাবে কোথা থেকে শুরু করতে হবে। কোনো ধাপ সম্পূর্ণ হলে সেই সেশনেই এখানে
টিক দিয়ে `CLAUDE.md`-এর সেশন-হিস্টোরিতেও এন্ট্রি যোগ করতে হবে।

---

## বর্তমান অবস্থা (যাচাইকৃত — ২২ জুলাই ২০২৬, Build #417-এর real GitHub Actions CI রান দিয়ে নিশ্চিত করা)

| স্তর | বিবরণ | অবস্থা |
|---|---|---|
| ১ — কমিটের আগে (fuzz/mutation) | ✅ `npm run test:fuzz` CI-তে blocking (`continue-on-error` সরানো)। `npm run test:mutation` বেসলাইন ৭২.৫৩%, `thresholds.break: 65`, CI-তে informational step। Build #417-এ `build` জবের "🧬 Fuzz tests" ও "🧬 Mutation score report" ধাপ দুটোই real CI-তে green | **সম্পূর্ণ ও CI-প্রমাণিত (ফেজ A)** |
| ২ — মার্জ/বিল্ডের আগে | `firestore-rules` জব-এ `test:rules-sync` + `test:rules` emulator + `test:sync-emulator` (multi-device conflict, network-drop mid-sync, backup→restore round-trip — ৭টা কেস) — `build` জবের `needs:` গেট। Build #417-এ `firestore-rules` জব সম্পূর্ণ succeeded, "🔀🔥 Sync/Backup Emulator ইন্টিগ্রেশন টেস্ট" ধাপ 6s-এ pass | **সম্পূর্ণ ও CI-প্রমাণিত (ফেজ B)** |
| ৩ — রিলিজের আগে ক্যানারি | `.github/workflows/build-apk.yml`-এ `release-canary` জব (`needs: firestore-rules`; `build` জবের `needs: [firestore-rules, release-canary]`) — Firestore Emulator-এ real `test:canary` স্ক্রিপ্ট চালায়। Build #417-এ real CI-তে emulator স্টার্ট হয়ে [invoice]→[sync]→[backup]→[restore]→[void] প্রতিটা ধাপ আলাদাভাবে পাস দেখিয়েছে, "সম্পূর্ণ পাইপলাইন পাস করেছে (exit code 0)" | **সম্পূর্ণ ও CI-প্রমাণিত (ফেজ C)** |
| ৪ — প্রোডাকশন রানটাইম সেলফ-চেক | `src/App.jsx`-এ periodic `runInvariantChecks()` কল + central error logging (`app_errors/{autoId}`)। `admin.html`-এ Dashboard ট্যাবে ইনভ্যারিয়েন্ট-অ্যালার্ট কার্ড ও Errors ট্যাবে "শুধু ইনভ্যারিয়েন্ট আলাটে (D1)" কুইক-ফিল্টার — অ্যাডমিন প্যানেলে সরাসরি স্ক্রিনশট-কনফার্মড। কিল-সুইচ ("সব দোকানে সিঙ্ক বন্ধ করুন" টগল, Update ট্যাবে) UI-তে স্ক্রিনশট-কনফার্মড। রোলব্যাক-মোড টগল কোডে আছে (`admin_config/appVersion.rollbackMode`), তবে Update ফর্মের ওই অংশ এখনো visually confirm করা হয়নি | **কোড ও অধিকাংশ UI সম্পূর্ণ + প্রমাণিত; শুধু রোলব্যাক টগলের ভিজ্যুয়াল কনফার্মেশন বাকি** |

**যাচাই পদ্ধতি:** `package.json` scripts, `stryker.conf.json`, `.github/workflows/build-apk.yml`-এর জব-গ্রাফ, `src/App.jsx`/`admin.html`-এর সংশ্লিষ্ট কোড — এসব ফাইল থেকে সরাসরি পড়ে নিশ্চিত করা হয়েছে। এর উপরে, Build #415/#416 real CI-তে fail করেছিল (`src/logic.js` থেকে `runInvariantChecks` export মিসিং — GitHub আপলোডের সময় বাদ পড়ে গিয়েছিল, কোডের বাগ না), এবং Build #417-এ ফিক্সের পর `firestore-rules` → `release-canary` → `build` — তিনটা জবই real GitHub Actions runner-এ succeeded, স্ক্রিনশট-কনফার্মড। এটাই এখন পর্যন্ত সবচেয়ে শক্তিশালী প্রমাণ — শুধু ফাইল পড়ে অনুমান না, বাস্তব CI রান দিয়ে যাচাই।

---

## ফেজ A — স্তর ১ সম্পূর্ণ করা (৩ ধাপ) ✅ সম্পূর্ণ — ২২ জুলাই ২০২৬

- [x] **A1.** Fuzz test (`test:fuzz`) কয়েকবার সত্যিই green আসছে কিনা যাচাই করে, CI-তে `continue-on-error` সরিয়ে blocking করা — sandbox-এ ১০ বার চালিয়ে সবকটাতে green, `.github/workflows/build-apk.yml` আপডেট করা হয়েছে
- [x] **A2.** Stryker mutation score-এর baseline রান করে বাস্তবসম্মত threshold (`stryker.conf.json`-এর `thresholds.break`) বসানো, CI-তে অন্তত informational রিপোর্ট হিসেবে যোগ করা — বেসলাইন ৭২.৫৩%, `break: 65` বসানো হয়েছে, CI-তে নতুন informational step (`continue-on-error: true`) যোগ হয়েছে
- [x] **A3.** `BUGFIX_LOG.md`/`CLAUDE.md`-এ স্তর ১ "সম্পূর্ণ" হিসেবে মার্ক করা — উভয় ফাইলে এন্ট্রি যোগ হয়েছে

**নোট:** এই তিনটাই sandbox-এ সরাসরি রান করে যাচাই করা হয়েছে (`npm test`, `npm run test:fuzz` ×১০, `npm run test:mutation` ×২), কিন্তু আসল GitHub Actions runner-এ এই পরিবর্তিত workflow এখনো রান হয়নি — merge-এর পর প্রথম CI রান একবার চোখে দেখে নেওয়া উচিত।

## ফেজ B — স্তর ২: রিয়েল emulator-integration টেস্ট (৪ ধাপ) ✅ সম্পূর্ণ — ২২ জুলাই ২০২৬

**যাচাই-ইতিহাস (সংক্ষেপে):** কোড sandbox-এ লেখা হয়েছিল, কিন্তু sandbox-এর network
egress allowlist-এ `storage.googleapis.com` না থাকায় সেখানে Firestore Emulator
চালানো যায়নি (jar ডাউনলোড ৪০৩ error)। প্রথম দুইবার আসল GitHub push-এও
(Build #405, #406) `npm error Missing script: "test:sync-emulator"` দিয়ে ফেল
করেছিল — কারণ কোড না, `package.json`-এর নতুন script লাইনটা GitHub-এ আপলোডের
সময় বাদ পড়ে গিয়েছিল। সঠিক `package.json` re-upload করার পর **Build #408-এ
"🔀🔥 Sync/Backup Emulator ইন্টিগ্রেশন টেস্ট" step ৬ সেকেন্ডে সবুজ টিক দিয়ে
pass করেছে** (real GitHub Actions runner-এ, স্ক্রিনশট-কনফার্মড) — এটাই এই
ফেজের চূড়ান্ত প্রমাণ।

✅ **যাচাই-অবস্থা (২২ জুলাই ২০২৬, আপডেট):** আগে sandbox-এ emulator jar ডাউনলোড ব্লক
ছিল বলে রান-ভেরিফাই সম্ভব হয়নি। এরপর দুইবার (Build #405, #406) আসল CI-তেও
`npm error Missing script: "test:sync-emulator"` দিয়ে ফেল করেছিল — কারণ
`package.json`-এ নতুন script লাইনটা GitHub-এ ঠিকভাবে বসেনি (আপলোড-সংক্রান্ত
সমস্যা, কোডের বাগ না)। `package.json` re-upload করার পর **Build #408-এ
"🔀🔥 Sync/Backup Emulator ইন্টিগ্রেশন টেস্ট" step সবুজ টিক দিয়ে pass করেছে
(6s, real GitHub Actions runner-এ, sandbox-এ না)** — এটাই ফেজ A-এর মতোই আসল
নিশ্চিতকরণ। তাই এখন B1–B4 টিক দেওয়া হলো।

- [x] **B1.** ৩+ ডিভাইস simultaneous conflict সিনারিও — emulator-এ real integration টেস্ট (একই রেকর্ড দুই ডিভাইস থেকে একসাথে write, `mergeCollection`/`effectiveTs` লজিক যাচাই) — `tests/sync-emulator-tests.mjs`-এ ২টা কেস (২-ডিভাইস + ৩-ডিভাইস কনফ্লিক্ট, real `serverTimestamp()` দিয়ে), Build #408-এ real CI-তে pass
- [x] **B2.** Network-drop mid-merge সিনারিও — sync মাঝপথে বিচ্ছিন্ন হলে data corrupt হয় না তা যাচাই — আংশিক পুশ + resume, এবং duplicate-retry কেস, Build #408-এ real CI-তে pass। নোট: `pushDurable`/outbox নিজেই `App.jsx`-এর ভেতরে React/IndexedDB-কাপলড কোড, তাই সরাসরি সেটা না চালিয়ে একই আচরণ (partial-write→resume, idempotent retry) real Firestore ডকুমেন্টের বিপরীতে সিমুলেট করা হয়েছে
- [x] **B3.** Backup→restore বাইট-বাই-বাইট round-trip টেস্ট (real backup বানিয়ে restore করে ডেটা compare — পুরনো backup format-এর backward-compat সহ) — real ডেটা → `pickBackupFields` → JSON round-trip → আলাদা কালেকশনে restore → `diffBackupFields`/`hashCollection` দিয়ে zero-drift চেক, + অজানা legacy কী থাকলেও crash না করা, Build #408-এ real CI-তে pass
- [x] **B4.** নতুন টেস্টগুলো CI workflow-এ (`firestore-rules` জব বা নতুন জব) যোগ করে build-gate করা — `firestore-rules` জবেই নতুন blocking step (`npm run test:sync-emulator`) যোগ করা হয়েছে, Build #408-এ real CI-তে ৬ সেকেন্ডে pass করে জব সবুজ হয়েছে

**নোট:** এই সেশনে (`package.json` re-upload-এর পর) actual GitHub Actions
runner-এ emulator চালিয়ে সত্যিই green পাওয়া গেছে (স্ক্রিনশট-কনফার্মড) —
sandbox-এ চালানো হয়নি (নেটওয়ার্ক ব্লক), শুধু আসল CI-তেই। এটাই এই ফেজের
একমাত্র বাস্তব প্রমাণ, এবং যথেষ্ট।

## ফেজ C — স্তর ৩: রিলিজ-ক্যানারি (৩ ধাপ) ✅ সম্পূর্ণ ও real CI-প্রমাণিত — ২২ জুলাই ২০২৬ (Build #417)

- [x] **C1.** End-to-end canary স্ক্রিপ্ট লেখা: emulator-এ ইনভয়েস তৈরি → সিঙ্ক → ব্যাকআপ → রিস্টোর → ভয়েড — প্রতি ধাপ automatic ভ্যালিডেশনসহ — `tests/canary-tests.mjs`, প্রতিটা ধাপ real `calcInvoiceTotal()`/`calcVoidNetChange()`/`pickBackupFields()`/`diffBackupFields()`/`hashCollection()` ব্যবহার করে, sequential gate (আগের ধাপ ব্যর্থ হলে পরেরটা স্কিপ)
- [x] **C2.** এটাকে release workflow-এ গেট হিসেবে যোগ করা (fail হলে release/APK build আটকাবে) — `.github/workflows/build-apk.yml`-এ নতুন `release-canary` জব, `build` জবের `needs: [firestore-rules, release-canary]`
- [x] **C3.** ক্যানারি ফেইলের ক্ষেত্রে স্পষ্ট রিপোর্ট (কোন ধাপে fail করলো) তৈরি করা — `STEPS`/`stepResult`/`firstFailedStep` ট্র্যাকিং, শেষে প্রতিটা ধাপের pass/skip/fail আলাদাভাবে প্রিন্ট হয়

**যাচাই-অবস্থা (২২ জুলাই ২০২৬, Build #417 দিয়ে চূড়ান্ত নিশ্চিতকরণ):** sandbox-এ আগে যে সীমাবদ্ধতা ছিল (network egress allowlist-এ `storage.googleapis.com` না থাকায় Firestore Emulator চালানো যায়নি), সেটা এখন আর সমস্যা না — **real GitHub Actions runner-এ** `release-canary` জব Firestore Emulator ডাউনলোড করে স্টার্ট করেছে, `node tests/canary-tests.mjs` রান করেছে, এবং লগে স্পষ্ট দেখা গেছে:
- ✅ [invoice] পাস
- ✅ [sync] পাস
- ✅ [backup] পাস
- ✅ [restore] পাস
- ✅ [void] পাস
- "সম্পূর্ণ পাইপলাইন (ইনভয়েস→সিঙ্ক→ব্যাকআপ→রিস্টোর→ভয়েড) পাস করেছে", script exited with code 0, জব 1m 55s-এ succeeded (স্ক্রিনশট-কনফার্মড)।

এর আগে Build #415/#416 real CI-তে fail করেছিল — কারণ কোড নয়, `src/logic.js` GitHub-এ আপলোডের সময় `runInvariantChecks` export ছাড়া একটা পুরনো ভার্সন আপলোড হয়ে গিয়েছিল। ঠিক ভার্সন re-upload করার পর Build #417-এ `firestore-rules` → `release-canary` → `build` — তিনটা জবই succeeded।

## ফেজ D — স্তর ৪: প্রোডাকশন সেলফ-চেক আপগ্রেড (৩ ধাপ) — কোড সম্পূর্ণ, বেশিরভাগ UI স্ক্রিনশট-কনফার্মড

- [x] **D1.** Periodic invariant-check (নেগেটিভ স্টক, ইনভয়েস-টোটাল vs cash-drawer mismatch ইত্যাদি) — ডিভাইসে চলবে, `app_errors`-এ লগ হবে ✅ সম্পূর্ণ ও sandbox-ভেরিফাইড।
  - `src/logic.js`-এ pure `runInvariantChecks()` (negative stock + cash-drawer mismatch), `tests/logic-tests.mjs`-এ ৭টা নতুন কেস — sandbox-এ `node tests/logic-tests.mjs` চালিয়ে ৫০/৫০ পাস কনফার্ম করা হয়েছে
  - App.jsx-এ প্রতি ২০ মিনিটে (+ ready হওয়ার সাথে সাথে একবার) `buildDailySummaryData()` থেকে aggregate নিয়ে `runInvariantChecks()` কল, violation পেলে `logErrorToCentral("invariant_check:<type>", ...)` — `npm run lint`/`npm run typecheck`/`npx esbuild` দিয়ে syntax/lint যাচাই করা হয়েছে (sandbox-এ actual Firestore/App রান করে দেখা যায়নি, শুধু static check)
- [x] **D2.** `admin.html`-এ invariant-check ফলাফলের ড্যাশবোর্ড/অ্যালার্ট প্যানেল — ✅ সম্পূর্ণ (আপডেট, ২২ জুলাই ২০২৬ দ্বিতীয় সেশন):
  - `ERROR_KB`-এ ৪টা এন্ট্রি (আগে থেকেই), Errors ট্যাবে কুইক-ফিল্টার বাটন (আগে থেকেই)
  - **নতুন:** Dashboard ট্যাবে সরাসরি "⚠️ N ইনভ্যারিয়েন্ট অ্যালার্ট" কার্ড — `_errorsCache` থেকে (আলাদা কোনো নতুন Firestore কোয়েরি ছাড়াই) unresolved + `invariant_check`-প্রিফিক্স গুনে দেখায়, ০ থাকলে লুকানো, ১+ হলে লাল হয়ে দেখা যায়, ট্যাপ করলে সরাসরি ফিল্টার-করা Errors ট্যাবে যায়
  - **UI-কনফার্মড (২২ জুলাই ২০২৬):** Errors ট্যাবে "শুধু ইনভ্যারিয়েন্ট আলাটে (D1)" ফিল্টার বাটন সরাসরি admin.html-এ চোখে দেখা গেছে, স্ক্রিনশট-কনফার্মড
- [x] **D3.** "রিলিজ খারাপ গেলে" কিল-সুইচ/রোলব্যাক মেকানিজম — ✅ সম্পূর্ণ (আপডেট, ২২ জুলাই ২০২৬ দ্বিতীয় সেশন):
  - "নতুন sync থামানো" — আগে থেকেই সম্পূর্ণ (`FSS._syncHalted` ইত্যাদি)। **UI-কনফার্মড (২২ জুলাই ২০২৬):** Update ট্যাবে "কিল-সুইচ — জরুরি সিঙ্ক-বন্ধ" প্যানেল ("সব দোকানে সিঙ্ক বন্ধ করুন" টগল + ঐচ্ছিক কারণ-নোট ফিল্ড) সরাসরি admin.html-এ চোখে দেখা গেছে, স্ক্রিনশট-কনফার্মড
  - **নতুন — "পুরনো ভার্সনে ফিরতে বলা" (downgrade rollback):** `admin_config/appVersion.rollbackMode:true` — App.jsx-এর `AppVersionCard`-এ `compareVersions()` গেট বাইপাস করে (ভার্সন-তুলনা উপেক্ষা করে কার্ড দেখায়, higher-version-এই সীমাবদ্ধ থাকে না); কার্ডে "⏪ রোলব্যাক" ব্যাজ ও আলাদা কপি ("আগের ভার্সনে ফিরে যাওয়ার পরামর্শ")। এখনো সম্পূর্ণ নীরব/optional কার্ড — কোনো জোরপূর্বক লক তৈরি হয় না (বিদ্যমান ডিজাইন-দর্শন অপরিবর্তিত)। `admin.html`-এর Update ফর্মে নতুন "⏪ রোলব্যাক মোড" টগল, `publishUpdate()`/`unpublishUpdate()`/`prefillUpdateForm()`/`loadCurrentUpdate()` সবগুলো আপডেট হয়েছে — কোডে আছে ও এই সেশনে গ্রেপ করে কনফার্ম করা হয়েছে, তবে Update ফর্মের এই নির্দিষ্ট টগলটা এখনো সরাসরি UI-তে (স্ক্রিনশটে) দেখা যায়নি — পরের সেশনে Update ফর্মের নিচের অংশ স্ক্রল করে একবার চোখে দেখে নেওয়া উচিত

---

## পরের সেশনের জন্য নোট

- প্রতিটা ফেজ স্বাধীনভাবে সেশন-বাউন্ডারিতে থামা যায় এমনভাবে সাজানো — একটা
  ধাপ শেষ না করে মাঝপথে থামলে সেটা "আংশিক" হিসেবে এখানে নোট করে রাখুন,
  চেকবক্স টিক দেবেন না।
- এই ফেজ B ও C-এর কাজে Firebase emulator লাগবে — এই ওয়েব sandbox-এ
  emulator চালানো সম্ভব না-ও হতে পারে (network নির্ভরতা)। সেক্ষেত্রে কোড
  লিখে দেওয়া যাবে, কিন্তু "চালিয়ে দেখা হয়েছে" দাবি করা যাবে না — CI-এর
  `firestore-rules` জবের উপর ভরসা করে যাচাই করতে হবে, এবং ব্যবহারকারীকে
  স্পষ্টভাবে জানাতে হবে কোনটা sandbox-এ রান করা হয়েছে বনাম কোনটা শুধু
  কোড-রিভিউ করে ধরে নেওয়া হয়েছে (CLAUDE.md-এর Post-flight নিয়ম #৫-৬)।
- ফেজ শুরু করার আগে `PHASE0_NOTES.md`/`ENTERPRISE_ROADMAP.md`/`BUGFIX_LOG.md`
  স্ক্যান করে দেখে নিন সেই এলাকায় ইতিমধ্যে কোনো ডকুমেন্টেড সিদ্ধান্ত আছে কিনা।
