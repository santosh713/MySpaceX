// ====== CONFIG ======
const cfg = window.APP_CONFIG || {};
const API = cfg.SHEETDB_API;
const SHEET = cfg.SHEET_NAME;

// ====== DOM HELPERS ======
const $ = id => document.getElementById(id);
const fmt = n => (Math.round(n * 100) / 100).toFixed(2);
const pad = n => String(n).padStart(2, "0");
const toDateInput = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const toTimeInput = d => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const fromDateInput = s => new Date(s + "T00:00:00");

// hh:mm -> hours (supports overnight end < start)
function parseHours(dateStr, startStr, endStr) {
  const [sh, sm] = startStr.split(":").map(Number);
  const [eh, em] = endStr.split(":").map(Number);
  const base = new Date(dateStr + "T00:00:00");
  const start = new Date(base); start.setHours(sh, sm, 0, 0);
  const end   = new Date(base); end.setHours(eh, em, 0, 0);
  let diff = end - start;
  if (diff < 0) diff += 24 * 3600 * 1000;
  return diff / 36e5;
}

// ---- Google Sheet serials -> normalized strings ----
const XL_BASE = new Date(Date.UTC(1899, 11, 30)); // 1899-12-30
function serialToDate(dnum) {
  const ms = dnum * 86400000; // days -> ms
  return new Date(XL_BASE.getTime() + ms);
}
function asISODate(v) {
  if (v == null || v === "") return "";
  if (typeof v === "number" || /^\d+(\.\d+)?$/.test(v)) {
    const d = serialToDate(Number(v));
    // format to local YYYY-MM-DD
    return toDateInput(new Date(d.getFullYear(), d.getMonth(), d.getDate()));
  }
  const d = new Date(v);
  if (!isNaN(d)) return toDateInput(d);
  return "";
}
function asHM(v) {
  if (v == null || v === "") return "";
  if (typeof v === "number" || /^\d+(\.\d+)?$/.test(v)) {
    const frac = Number(v) % 1;
    const totMin = Math.round(frac * 24 * 60);
    const hh = Math.floor(totMin / 60);
    const mm = totMin % 60;
    return `${pad(hh)}:${pad(mm)}`;
  }
  const m = String(v).match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (m) return `${pad(m[1])}:${m[2]}`;
  const d = new Date(`1970-01-01T${v}`);
  if (!isNaN(d)) return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return "";
}

// ====== ACTIVE SESSION ======
const ACTIVE_KEY  = "hours_active_v1";     // { ts:number }
const PAYDAY_KEY  = "hours_payday_friday_iso"; // "YYYY-MM-DD" (must be Friday)
const loadActive  = () => { try { return JSON.parse(localStorage.getItem(ACTIVE_KEY) || "null"); } catch { return null; } };
const saveActive  = obj => localStorage.setItem(ACTIVE_KEY, JSON.stringify(obj));
const clearActive = () => localStorage.removeItem(ACTIVE_KEY);

// ====== UI REFS ======
const nowEl = $("now");
const statusEl = $("status");
const sinceEl = $("since");
const inBtn = $("clockInBtn");
const outBtn = $("clockOutBtn");
const tbody = $("tableBody");
const sumShifts = $("sumShifts");
const sumHours = $("sumHours");
const manual = $("manualForm");
const toggleManual = $("toggleManual");
const weekBody = $("weekBody");
const paydayInput = $("paydayInput");
const savePaydayBtn = $("savePayday");
const clearPaydayBtn = $("clearPayday");
const nextPaydayInfo = $("nextPaydayInfo");
const payPeriodsEl = $("payPeriods");

// ====== STATE ======
let active = loadActive();            // { ts }
let rows = [];                        // [{id,date,start,end,hours}]
let knownPayday = localStorage.getItem(PAYDAY_KEY) || ""; // ISO string

// ====== CLOCK ======
setInterval(() => {
  const d = new Date();
  if (nowEl) nowEl.textContent = d.toLocaleString();
  if (active?.ts && sinceEl) {
    const hrs = (Date.now() - active.ts) / 36e5;
    sinceEl.textContent = `Clocked in for ${fmt(hrs)} hrs`;
  }
}, 1000);

// ====== SHEETDB I/O ======
async function fetchRows() {
  if (!API) return;
  const url = new URL(API);
  if (SHEET) url.searchParams.set('sheet', SHEET);
  const data = await fetch(url).then(r => r.json());
  rows = (Array.isArray(data) ? data : []).map(r => ({
    id: r.id,
    date: asISODate(r.date),   // normalize numbers/strings to YYYY-MM-DD
    start: asHM(r.start),      // normalize to HH:mm
    end: asHM(r.end),          // normalize to HH:mm
    hours: Number(r.hours || 0)
  }));
  // newest first by date + start
  rows.sort((a,b) => (b.date + ' ' + b.start).localeCompare(a.date + ' ' + a.start));
}

async function addRow({date, start, end, hours}) {
  if (!API) throw new Error('Missing SheetDB API endpoint in config.js');
  const payload = { data: [ {
    id: "INCREMENT",
    date: String(date),
    start: String(start),
    end: String(end),
    hours: String(hours)
  } ]};
  const url = new URL(API);
  if (SHEET) url.searchParams.set('sheet', SHEET);
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!res.ok) throw new Error('Failed to add row');
  await fetchRows();
}

async function deleteRowById(id) {
  if (!API) throw new Error('Missing SheetDB API endpoint in config.js');
  if (!id) return;
  const url = new URL(`${API}/id/${encodeURIComponent(id)}`);
  if (SHEET) url.searchParams.set('sheet', SHEET);
  const res = await fetch(url, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to delete');
  await fetchRows();
}

// ====== WEEK GROUPING (Mon–Sun) ======
function weekStartMonday(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  if (isNaN(d)) return null;
  const day = d.getDay(); // 0=Sun, 1=Mon, ... 6=Sat
  const diff = (day === 0 ? -6 : 1 - day); // move back to Monday
  const start = new Date(d);
  start.setDate(d.getDate() + diff);
  start.setHours(0,0,0,0);
  return start;
}
function weekEndSundayFromMonday(monday) {
  const end = new Date(monday);
  end.setDate(monday.getDate() + 6);
  end.setHours(23,59,59,999);
  return end;
}
function formatRange(start, end) {
  const fmtOpt = { month: 'short', day: 'numeric' };
  const yOpt = { year: 'numeric' };
  const sameYear = start.getFullYear() === end.getFullYear();
  const s = start.toLocaleDateString(undefined, sameYear ? fmtOpt : {...fmtOpt, ...yOpt});
  const e = end.toLocaleDateString(undefined, {...fmtOpt, ...yOpt});
  return `${s} – ${e}`;
}
function groupByWeekMonSun(rows) {
  const map = {};
  rows.forEach(r => {
    if (!r.date) return;
    const mon = weekStartMonday(r.date);
    if (!mon) return;
    const key = toDateInput(mon);
    if (!map[key]) map[key] = { start: mon, total: 0, count: 0 };
    map[key].total += Number(r.hours || 0);
    map[key].count += 1;
  });
  return Object.entries(map)
    .map(([key, v]) => ({ key, ...v }))
    .sort((a,b) => b.start - a.start);
}

// ====== PAYDAY / PAY PERIODS (bi-weekly, Mon–Sun×2, payday Friday) ======
function isFriday(d) { return d.getDay() === 5; }
function periodStartForPayday(payday) {
  const end = new Date(payday); end.setDate(end.getDate() - 5); // Sunday before payday
  const start = new Date(end); start.setDate(end.getDate() - 13); // Monday 2 weeks earlier
  start.setHours(0,0,0,0);
  return start;
}
function paydayForPeriodStart(start) {
  const end = new Date(start); end.setDate(start.getDate() + 13); // second Sunday
  const payday = new Date(end); payday.setDate(end.getDate() + 5); // Friday after
  payday.setHours(0,0,0,0);
  return payday;
}
function idxForDate(date, baseStart) {
  const days = Math.floor((date - baseStart) / 86400000);
  return Math.floor(days / 14);
}
function monthKey(d) { return d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }); }
function buildPayPeriods(rows, paydayISO) {
  if (!paydayISO) return [];
  const payday = fromDateInput(paydayISO);
  if (isNaN(payday) || !isFriday(payday)) return [];

  const baseStart = periodStartForPayday(payday);
  const buckets = new Map();
  rows.forEach(r => {
    if (!r.date) return;
    const d = fromDateInput(r.date);
    if (isNaN(d)) return;
    const idx = idxForDate(d, baseStart);
    const start = new Date(baseStart); start.setDate(baseStart.getDate() + idx*14);
    const pay = paydayForPeriodStart(start);
    const k = String(idx);
    if (!buckets.has(k)) buckets.set(k, { start, payday: pay, total: 0, count: 0 });
    const b = buckets.get(k);
    b.total += Number(r.hours || 0);
    b.count += 1;
  });
  const list = Array.from(buckets.values()).sort((a,b) => b.start - a.start);
  return list.map(b => {
    const end = new Date(b.start); end.setDate(b.start.getDate() + 13);
    return { start: b.start, end, payday: b.payday, total: b.total, count: b.count };
  });
}

// ====== RENDERING ======
function renderWeekly() {
  if (!weekBody) return;
  const grouped = groupByWeekMonSun(rows);
  weekBody.innerHTML = "";
  grouped.forEach(g => {
    const end = weekEndSundayFromMonday(g.start);
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="px-4 py-3 text-sm text-gray-800">${formatRange(g.start, end)}</td>
      <td class="px-4 py-3 text-sm text-right text-gray-800">${fmt(g.total)}</td>
      <td class="px-4 py-3 text-sm text-right text-gray-800">${g.count}</td>
    `;
    weekBody.appendChild(tr);
  });
}

function renderPayPeriods() {
  if (!payPeriodsEl) return;
  payPeriodsEl.innerHTML = "";

  const periods = buildPayPeriods(rows, knownPayday);
  if (!periods.length) {
    payPeriodsEl.innerHTML = `<div class="px-4 py-4 text-sm text-gray-500">
      Set a known Friday payday above to see bi-weekly periods.
    </div>`;
    return;
  }

  // Group by payday month (like the reference screenshot)
  const byMonth = new Map();
  periods.forEach(p => {
    const k = monthKey(p.payday);
    if (!byMonth.has(k)) byMonth.set(k, []);
    byMonth.get(k).push(p);
  });

  Array.from(byMonth.entries()).forEach(([month, items]) => {
    const details = document.createElement("details");
    details.className = "border-b border-gray-200";
    details.open = true;

    const summary = document.createElement("summary");
    summary.className = "cursor-pointer select-none px-4 py-3 bg-gray-50 text-gray-800 font-medium";
    summary.textContent = month;

    const container = document.createElement("div");
    items.forEach(p => {
      const row = document.createElement("div");
      row.className = "px-4 py-3 border-t border-gray-100 flex items-center justify-between";
      const range = formatRange(p.start, p.end);
      const paydayStr = p.payday.toLocaleDateString(undefined, { year:'numeric', month:'short', day:'numeric', weekday:'short' });
      row.innerHTML = `
        <div class="flex items-center gap-3">
          <span class="inline-flex w-3 h-3 rounded-full bg-indigo-500"></span>
          <div class="text-sm text-gray-800 font-medium">
            ${range}
            <span class="text-gray-500 font-normal">• Payday: ${paydayStr}</span>
          </div>
        </div>
        <div class="text-sm text-gray-700">
          <span class="font-semibold">${fmt(p.total)}</span> hrs
          <span class="text-gray-400">(${p.count} shifts)</span>
        </div>
      `;
      container.appendChild(row);
    });

    details.appendChild(summary);
    details.appendChild(container);
    payPeriodsEl.appendChild(details);
  });
}

function renderStatusAndTable() {
  // status
  if (active?.ts) {
    statusEl.textContent = "Clocked In";
    inBtn.disabled = true; outBtn.disabled = false;
  } else {
    statusEl.textContent = "Not clocked in";
    if (sinceEl) sinceEl.textContent = "";
    inBtn.disabled = false; outBtn.disabled = true;
  }

  // table
  tbody.innerHTML = "";
  let totalH = 0;
  rows.forEach((r) => {
    totalH += Number(r.hours || 0);
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="px-4 py-3 text-sm text-gray-800">${r.date || "-"}</td>
      <td class="px-4 py-3 text-sm text-gray-800">${r.start || "-"}</td>
      <td class="px-4 py-3 text-sm text-gray-800">${r.end || "-"}</td>
      <td class="px-4 py-3 text-sm text-right text-gray-800">${fmt(r.hours)}</td>
      <td class="px-4 py-3 text-sm text-right">
        <button data-id="${r.id}" class="text-red-600 hover:text-red-800 del">Delete</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
  sumShifts.textContent = rows.length;
  sumHours.textContent = fmt(totalH);

  // delete binds
  document.querySelectorAll(".del").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      const id = e.currentTarget.dataset.id;
      if (!confirm("Delete this row?")) return;
      try { await deleteRowById(id); await fetchRows(); renderAll(); } catch (err) { alert(err.message); }
    });
  });
}

function renderNextPaydayInfo() {
  if (!nextPaydayInfo) return;
  if (!knownPayday) { nextPaydayInfo.textContent = ""; return; }

  const base = fromDateInput(knownPayday);
  if (isNaN(base) || !isFriday(base)) {
    nextPaydayInfo.innerHTML = `<span class="text-red-600">Selected date is not a Friday.</span>`;
    return;
  }
  // Next payday after today
  const today = new Date(); today.setHours(0,0,0,0);
  let pd = new Date(base);
  while (pd < today) pd.setDate(pd.getDate() + 14);
  const nextStr = pd.toLocaleDateString(undefined, { year:'numeric', month:'short', day:'numeric', weekday:'short' });
  nextPaydayInfo.innerHTML = `<span class="font-medium">Next Payday:</span> ${nextStr}`;
}

function renderAll() {
  renderStatusAndTable();
  renderWeekly();       // Mon–Sun
  renderPayPeriods();   // bi-weekly
  renderNextPaydayInfo();

  // Show controls until a payday is set. After that, you can choose to hide them.
  const paydaySection = document.getElementById("paydayControls") || paydayInput?.closest("section");
  if (paydaySection) {
    const hasPayday = Boolean(knownPayday);
    // Hide only if a payday is already set (and optionally if there are rows).
    paydaySection.classList.toggle("hidden", hasPayday /* && rows.length > 0 */);
  }
}


// ====== UI EVENTS ======
inBtn.addEventListener("click", () => {
  if (active?.ts) return;
  active = { ts: Date.now() };
  saveActive(active);
  renderAll();
});

outBtn.addEventListener("click", async () => {
  if (!active?.ts) return;
  const startD = new Date(active.ts);
  const endD = new Date();

  const dateStr  = toDateInput(startD);
  const startStr = toTimeInput(startD);
  const endStr   = toTimeInput(endD);
  const hours    = parseHours(dateStr, startStr, endStr);

  try {
    await addRow({ date: dateStr, start: startStr, end: endStr, hours });
  } catch (e) {
    alert("Save failed. Please check your SheetDB settings in public/assets/js/config.js");
  }
  clearActive(); active = null;
  await fetchRows(); renderAll();
});

toggleManual.addEventListener("click", () => manual.classList.toggle("hidden"));
manual.addEventListener("submit", async (e) => {
  e.preventDefault();
  const date = document.getElementById("mDate").value;
  const start = document.getElementById("mStart").value;
  const end = document.getElementById("mEnd").value;
  if (!date || !start || !end) return;
  const hours = parseHours(date, start, end);
  try {
    await addRow({ date, start, end, hours });
    manual.reset();
  } catch (e) {
    alert("Save failed. Please check your SheetDB settings in public/assets/js/config.js");
  }
  await fetchRows(); renderAll();
});

// export CSV (raw rows)
document.getElementById("exportCsv").addEventListener("click", () => {
  if (!rows.length) return;
  const header = ["Date","Start","End","Hours"];
  const lines = [header.join(",")];
  rows.forEach(r => lines.push([r.date, r.start, r.end, fmt(r.hours)].join(",")));
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = "hours.csv"; a.click();
  URL.revokeObjectURL(url);
});

// Payday controls
if (paydayInput && knownPayday) paydayInput.value = knownPayday;

savePaydayBtn?.addEventListener("click", () => {
  if (!paydayInput.value) { alert("Pick a payday (Friday)."); return; }
  const d = fromDateInput(paydayInput.value);
  if (isNaN(d) || !isFriday(d)) { alert("Selected date is not a Friday."); return; }
  knownPayday = paydayInput.value;
  localStorage.setItem(PAYDAY_KEY, knownPayday);
  renderAll();
});
clearPaydayBtn?.addEventListener("click", () => {
  localStorage.removeItem(PAYDAY_KEY);
  knownPayday = "";
  if (paydayInput) paydayInput.value = "";
  renderAll();
});

// ====== INIT ======
(function seedManualDefaults() {
  const d = new Date();
  const mDate = document.getElementById("mDate");
  const mStart = document.getElementById("mStart");
  const mEnd = document.getElementById("mEnd");
  if (mDate) mDate.value = toDateInput(d);
  if (mStart) mStart.value = toTimeInput(d);
  if (mEnd) mEnd.value = toTimeInput(d);
})();

(async function init() {
  try { await fetchRows(); } catch {}
  renderAll();
})();
