// ─── eslint.config.js ───────────────────────────────────────────────────────
// এই কনফিগ ইচ্ছাকৃতভাবে সংকীর্ণ (narrow) — পুরো "code style" পুলিশিং করার
// বদলে ঠিক সেই বাগ-প্যাটার্নটাই ধরার চেষ্টা করে যেটা সবচেয়ে বেশি ভুগিয়েছে:
// "এক জায়গা ঠিক করতে গিয়ে অজান্তে আরেক জায়গা ভাঙা" — যার একটা বড় উৎস হলো
// React hooks-এ ভুল/মিসিং dependency (useEffect/useMemo/useCallback)।
//
// react-hooks/exhaustive-deps rule এই প্রজেক্টে ডিফল্টভাবে "warn" রাখা হয়েছে,
// error না — কারণ App.jsx-এ ইতিমধ্যে অনেক জায়গায় ইচ্ছাকৃতভাবে
// `// eslint-disable-next-line react-hooks/exhaustive-deps` ব্যবহার করে deps
// বাদ দেওয়া আছে (নিচে দেখুন কতগুলো)। সেগুলো সবগুলো এখনই "error" বানিয়ে CI
// আটকে দিলে অপ্রয়োজনীয় ঘর্ষণ তৈরি হবে। নতুন কোড লেখার সময় IDE-তে হলুদ
// আন্ডারলাইন হিসেবে দেখা যাবে, যেটাই আসল লক্ষ্য — "লেখার সময়েই ভুল ধরা"।
import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import globals from "globals";

export default [
  {
    // node_modules, dist, বিল্ড আউটপুট, রিপোর্ট — এগুলো কখনোই লিন্ট করার দরকার নেই
    ignores: [
      "node_modules/**",
      "dist/**",
      "android/**",
      "reports/**",
      "netlify-site/**", // আলাদা vanilla-JS static admin panel, App.jsx-এর অংশ না
      "*.config.js",
    ],
  },
  js.configs.recommended,
  {
    files: ["src/**/*.{js,jsx}"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: { ...globals.browser, ...globals.node },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      // ── সবচেয়ে গুরুত্বপূর্ণ rule এই প্রজেক্টের জন্য ──────────────────────
      "react-hooks/rules-of-hooks": "error", // hooks ভুল জায়গায় (condition/loop-এ) কল হলে সবসময় error
      "react-hooks/exhaustive-deps": "warn", // মিসিং dependency — warn (উপরের কমেন্ট দেখুন কেন error না)

      // ── legacy 33k-লাইন ফাইলে false-positive এড়াতে শিথিল করা rules ─────
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "no-empty": ["warn", { allowEmptyCatch: true }], // এই কোডবেসে ইচ্ছাকৃত empty catch অনেক জায়গায় আছে (silent fallback প্যাটার্ন)
      "no-constant-condition": ["warn", { checkLoops: false }],
      "no-prototype-builtins": "off",
      "no-fallthrough": "warn",
      "no-cond-assign": ["error", "except-parens"],

      // ── এইগুলো সবসময় error রাখা হলো — আসল bug-প্রবণ প্যাটার্ন ───────────
      "no-undef": "error", // টাইপো করা ভ্যারিয়েবল/ফাংশন নাম — রানটাইমে ভাঙার আগেই ধরে
      "no-dupe-keys": "error",
      "no-unreachable": "error",
      "no-import-assign": "error",
      "react-refresh/only-export-components": "off", // এই প্রজেক্ট single-file structure, এই rule প্রাসঙ্গিক না
    },
  },
];
