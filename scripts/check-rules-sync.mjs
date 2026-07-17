// scripts/check-rules-sync.mjs
//
// সমস্যা: firestore.rules / firestore.indexes.json / database.rules.json
// এখন repo-তে standalone ফাইল হিসেবে আছে (Phase 0 থেকে — emulator/CI টেস্টের
// জন্য দরকার), কিন্তু netlify-site/admin.html-এর ভেতরেও এদের একটা কপি
// (FB_DEFAULT_RULES / FB_DEFAULT_INDEXES / FB_DEFAULT_RTDB) embedded আছে,
// যেটা shopkeeper-দের প্রজেক্টে আসলে deploy হয়। দুটো আলাদা জায়গায় থাকায়
// কেউ একটা আপডেট করে অন্যটা ভুলে গেলে, emulator-এ টেস্ট পাস করলেও আসল
// দোকানে ভিন্ন (অপরীক্ষিত) rules deploy হয়ে যেতে পারে — এই স্ক্রিপ্ট সেই
// drift ধরে CI-তে fail করায়।
//
// রান: node scripts/check-rules-sync.mjs

import { readFileSync } from "node:fs";

function extractTemplateLiteral(src, varName) {
  const marker = `const ${varName} = \``;
  const start = src.indexOf(marker);
  if (start === -1) throw new Error(`${varName} admin.html-এ পাওয়া যায়নি`);
  const bodyStart = start + marker.length;
  let i = bodyStart;
  while (true) {
    i = src.indexOf("`", i);
    if (i === -1) throw new Error(`${varName}-এর ক্লোজিং backtick পাওয়া যায়নি`);
    if (src[i - 1] !== "\\") break;
    i += 1;
  }
  return src.slice(bodyStart, i).replace(/\\`/g, "`");
}

function normalize(s) {
  return s.replace(/\r\n/g, "\n").trim();
}

const adminHtml = readFileSync("netlify-site/admin.html", "utf8");

const checks = [
  { file: "firestore.rules", varName: "FB_DEFAULT_RULES" },
  { file: "firestore.indexes.json", varName: "FB_DEFAULT_INDEXES" },
  { file: "database.rules.json", varName: "FB_DEFAULT_RTDB" },
];

let ok = true;
for (const { file, varName } of checks) {
  const fromFile = normalize(readFileSync(file, "utf8"));
  const fromHtml = normalize(extractTemplateLiteral(adminHtml, varName));
  if (fromFile === fromHtml) {
    console.log(`✅ ${file} ↔ admin.html::${varName} — sync-এ আছে`);
  } else {
    ok = false;
    console.log(`❌ ${file} ↔ admin.html::${varName} — DRIFT ধরা পড়েছে!`);
    console.log(`   দুটোর যেকোনো একটা বদলেছে, অন্যটা আপডেট হয়নি। দুটো ম্যানুয়ালি`);
    console.log(`   মিলিয়ে দেখুন এবং একই কন্টেন্ট রাখুন।`);
  }
}

if (!ok) {
  console.log("\nfailed: rules/indexes/rtdb ফাইল এবং admin.html-এর embedded কপি এক নয়।");
  process.exit(1);
} else {
  console.log("\n✅ সব rules/indexes/rtdb ফাইল admin.html-এর সাথে sync-এ আছে।");
}
