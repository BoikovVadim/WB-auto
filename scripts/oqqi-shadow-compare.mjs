#!/usr/bin/env node
// Shadow-сверка двух экземпляров WB-автоматизации (старый прод ↔ новый на Oqqi).
// Тянет одинаковые дневные агрегаты с обоих, суммирует числовые поля и печатает
// расхождения. Числа считает бэкенд — скрипт лишь суммирует уже готовый read-model.
//
// Запуск:
//   node scripts/oqqi-shadow-compare.mjs [BASE_OLD] [BASE_NEW]
//   BASE_OLD по умолчанию https://legendgames.space/wb/api
//   BASE_NEW по умолчанию https://sales.oqqi.io/api  (переопредели под реальный путь)
//   Допуск (%) — env TOLERANCE_PCT (по умолчанию 1.00).

const BASE_OLD = (process.argv[2] || process.env.BASE_OLD || "https://legendgames.space/wb/api").replace(/\/$/, "");
const BASE_NEW = (process.argv[3] || process.env.BASE_NEW || "https://sales.oqqi.io/api").replace(/\/$/, "");
const TOLERANCE_PCT = Number(process.env.TOLERANCE_PCT ?? "1.00");
const TIMEOUT_MS = Number(process.env.TIMEOUT_MS ?? "30000");

// Дневные скалярные агрегаты: путь → человекочитаемое имя. Все отдают { items: [{ nmId, ...числа }] }.
const ENDPOINTS = [
  ["wb-clusters/products/orders-today", "Заказы сегодня"],
  ["wb-clusters/products/orders-sum-today", "Сумма заказов сегодня"],
  ["wb-clusters/products/revenue-today", "Выручка сегодня"],
  ["wb-clusters/products/cost-sum-today", "С/с продаж сегодня"],
  ["wb-clusters/products/ad-spend-today", "Расход рекламы сегодня"],
  ["wb-clusters/products/spp-today", "СПП сегодня"],
];

async function getJson(base, path) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${base}/${path}`, { signal: ctrl.signal });
    if (!res.ok) return { error: `HTTP ${res.status}` };
    return { data: await res.json() };
  } catch (e) {
    return { error: e.name === "AbortError" ? "timeout" : e.message };
  } finally {
    clearTimeout(t);
  }
}

// Суммирует каждое числовое поле по всем items + число товаров. → { count, <field>: sum, ... }
function aggregate(payload) {
  const items = Array.isArray(payload?.items) ? payload.items : [];
  const out = { count: items.length };
  for (const it of items) {
    for (const [k, v] of Object.entries(it)) {
      if (k === "nmId" || typeof v !== "number" || !Number.isFinite(v)) continue;
      out[k] = (out[k] ?? 0) + v;
    }
  }
  return out;
}

function fmt(n) {
  return typeof n === "number" ? n.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : String(n);
}

function devPct(oldV, newV) {
  if (oldV === 0) return newV === 0 ? 0 : 100;
  return Math.abs((newV - oldV) / oldV) * 100;
}

async function checkHealth() {
  const [o, n] = await Promise.all([getJson(BASE_OLD, "health"), getJson(BASE_NEW, "health")]);
  console.log("== HEALTH ==");
  for (const [label, r] of [["OLD", o], ["NEW", n]]) {
    if (r.error) { console.log(`  ${label}: ❌ ${r.error}`); continue; }
    const c = r.data?.checks ?? {};
    console.log(`  ${label}: ${r.data?.status} | pg=${c.postgresConfigured} wbApi=${c.wbApiConfigured} readOnly=${c.automationReadOnly} | uptime=${r.data?.uptimeSeconds}s`);
  }
  if (n.data && n.data.checks?.automationReadOnly !== true) {
    console.log("  ⚠️  NEW: automationReadOnly != true — observe НЕ активен! В shadow это опасно (второй писатель).");
  }
  console.log("");
}

async function compareEndpoint(path, label) {
  const [o, n] = await Promise.all([getJson(BASE_OLD, path), getJson(BASE_NEW, path)]);
  if (o.error || n.error) {
    console.log(`\n## ${label}\n  OLD: ${o.error ? "❌ " + o.error : "ok"} | NEW: ${n.error ? "❌ " + n.error : "ok"}`);
    return { label, ok: false };
  }
  const ao = aggregate(o.data), an = aggregate(n.data);
  const fields = [...new Set([...Object.keys(ao), ...Object.keys(an)])];
  console.log(`\n## ${label}`);
  let worst = 0;
  for (const f of fields) {
    const ov = ao[f] ?? 0, nv = an[f] ?? 0;
    const d = devPct(ov, nv);
    worst = Math.max(worst, d);
    const flag = d <= TOLERANCE_PCT ? "✓" : "⚠️";
    console.log(`  ${flag} ${f.padEnd(16)} OLD=${fmt(ov).padStart(16)}  NEW=${fmt(nv).padStart(16)}  Δ=${d.toFixed(2)}%`);
  }
  return { label, ok: worst <= TOLERANCE_PCT, worst };
}

(async () => {
  console.log(`Shadow-сверка  OLD=${BASE_OLD}  NEW=${BASE_NEW}  допуск=${TOLERANCE_PCT.toFixed(2)}%\n`);
  await checkHealth();
  const results = [];
  for (const [path, label] of ENDPOINTS) results.push(await compareEndpoint(path, label));
  const bad = results.filter((r) => !r.ok);
  console.log(`\n== ИТОГ ==`);
  if (bad.length === 0) {
    console.log(`  ✅ все метрики в пределах ${TOLERANCE_PCT.toFixed(2)}% — можно двигаться к cutover.`);
  } else {
    console.log(`  ⚠️  расхождения по: ${bad.map((b) => b.label).join(", ")} — разобраться перед cutover.`);
    process.exitCode = 1;
  }
})();
