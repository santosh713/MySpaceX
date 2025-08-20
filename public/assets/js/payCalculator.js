// ====== CONFIG FROM config.js ======
const API   = (window.APP_CONFIG && window.APP_CONFIG.SHEETDB_API) || "";
const SHEET = (window.APP_CONFIG && window.APP_CONFIG.SHEET_NAME) || "";

// === PAY SETTINGS (from your paystub) ===
// You can override any of these via window.PAYCFG in config.js
const PAYCFG = Object.assign(
  {
    HOURLY_RATE: 17.50, // base hourly rate
    FED_TAX:    0.022,  // 2.20% federal tax
    CPP:        0.0356, // 3.56% CPP
    EI:         0.0117, // 1.17% EI
    VAC_PAY:    0.04,   // 4% vacation accrual
    // IMPORTANT: treat vacation as a DEDUCTION from payout (accrued / not paid out)
    VAC_AS_DEDUCTION: true
  },
  window.PAYCFG || {}
);

// ====== PERIOD ANCHOR (Fri Aug 15, 2025) ======
const FIRST_PAYDAY_ISO = "2025-08-15"; // fixed
const FIRST_PAYDAY = new Date(`${FIRST_PAYDAY_ISO}T00:00:00`);

// BASE_START = Monday two weeks BEFORE that Friday payday (P - 18 days)
const BASE_START = (() => {
  const s = new Date(FIRST_PAYDAY);
  s.setDate(s.getDate() - 18); // Monday
  s.setHours(0,0,0,0);
  return s;
})();

// ====== HELPERS (match Hours normalizers) ======
const pad = n => String(n).padStart(2,"0");
const toISO = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;

// Excel serials -> date
const XL_BASE = new Date(Date.UTC(1899, 11, 30));
function serialToDate(dnum){ return new Date(XL_BASE.getTime() + dnum*86400000); }
function asISODate(v){
  if (v==null || v==="") return "";
  if (typeof v === "number" || /^\d+(\.\d+)?$/.test(v)){
    const d = serialToDate(Number(v));
    return toISO(new Date(d.getFullYear(), d.getMonth(), d.getDate()));
  }
  const d = new Date(v);
  return isNaN(d) ? "" : toISO(d);
}

function labelRange(start, end, payday){
  const fmt  = dt => dt.toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'});
  const pfmt = dt => dt.toLocaleDateString(undefined,{weekday:'short',month:'short',day:'numeric',year:'numeric'});
  return `${fmt(start)} – ${fmt(end)} (Payday: ${pfmt(payday)})`;
}

// ====== PERIOD MATH (Mon–Sun ×2, payday Fri) ======
function periodByIndex(idx){
  const start = new Date(BASE_START);
  start.setDate(BASE_START.getDate() + idx*14);
  const end = new Date(start);
  end.setDate(start.getDate() + 13);     // Sunday
  const payday = new Date(end);
  payday.setDate(end.getDate() + 5);     // Friday
  return { start, end, payday, idx };
}
function indexForDate(d){
  const days = Math.floor((d - BASE_START)/86400000);
  return Math.floor(days/14);
}
function currentPeriod(){
  const today = new Date(); today.setHours(0,0,0,0);
  return periodByIndex(indexForDate(today));
}
function generatePeriods(nPast=16, nFuture=16){
  const curIdx = indexForDate(new Date());
  const list = [];
  for(let i=curIdx-nPast;i<=curIdx+nFuture;i++) list.push(periodByIndex(i));
  return list;
}

// ====== DATA LOADING (SAME SOURCE AS HOURS) ======
async function fetchShifts(){
  if (!API) return [];
  const url = new URL(API);
  if (SHEET) url.searchParams.set("sheet", SHEET);
  const res = await fetch(url.toString(), { cache: "no-store" });
  const data = await res.json();
  if (!Array.isArray(data)) return [];
  // normalize to {date:"YYYY-MM-DD", hours:Number}
  return data.map(r => ({
    date: asISODate(r.date),
    hours: Number(r.hours || 0)
  })).filter(r => r.date);
}

// ====== PAY CALC ======
// If VAC_AS_DEDUCTION == true (default):
//   baseGross = hours * rate
//   taxes on baseGross
//   net = baseGross - taxes - vacation (vacation accrued; not paid out)
// If VAC_AS_DEDUCTION == false (paid out):
//   totalGross = baseGross + vacation
//   taxes on totalGross
//   net = totalGross - taxes
function computePay(rows, start, end){
  const inRange = rows.filter(r => {
    const d = new Date(`${r.date}T00:00:00`);
    return d >= start && d <= end;
  });

  const totalHours = inRange.reduce((s, r) => s + (Number.isFinite(r.hours)?r.hours:0), 0);
  const baseGross  = totalHours * PAYCFG.HOURLY_RATE;
  const vacation   = baseGross * PAYCFG.VAC_PAY;

  let taxableBase, federal, cpp, ei, deductions, net, grossShown;

  if (PAYCFG.VAC_AS_DEDUCTION) {
    // Vacation is accrued (not paid): tax only the baseGross, then subtract vacation from payout
    taxableBase = baseGross;
    federal = taxableBase * PAYCFG.FED_TAX;
    cpp     = taxableBase * PAYCFG.CPP;
    ei      = taxableBase * PAYCFG.EI;
    deductions = federal + cpp + ei;
    net = baseGross - deductions - vacation;
    grossShown = baseGross; // show base gross as "Gross Pay"
  } else {
    // Vacation paid out: tax on (base + vacation), do not subtract vacation afterwards
    const grossTotal = baseGross + vacation;
    taxableBase = grossTotal;
    federal = taxableBase * PAYCFG.FED_TAX;
    cpp     = taxableBase * PAYCFG.CPP;
    ei      = taxableBase * PAYCFG.EI;
    deductions = federal + cpp + ei;
    net = grossTotal - deductions;
    grossShown = grossTotal; // show total gross as "Gross Pay"
  }

  return { totalHours, baseGross, vacation, taxableBase, federal, cpp, ei, deductions, net, grossShown };
}

// ====== UI ======
let chartInstance = null;

function updateChart({ net, federal, cpp, ei, vacation }){
  const ctx = document.getElementById("payChart").getContext("2d");
  if (chartInstance) chartInstance.destroy();
  chartInstance = new Chart(ctx, {
    type: "doughnut",
    data: {
      // Vacation shown as a deduction slice
      labels: ["Net Pay", "Federal", "CPP", "EI", "Vacation"],
      datasets: [{
        data: [net, federal, cpp, ei, vacation],
        backgroundColor: ["#16a34a", "#ef4444", "#3b82f6", "#f59e0b", "#14b8a6"]
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { position: "bottom" } }
    }
  });
}

function renderSummary(pay, label){
  document.getElementById("periodLabel").textContent = label;
  document.getElementById("totalHours").textContent  = pay.totalHours.toFixed(2);
  document.getElementById("grossPay").textContent    = pay.grossShown.toFixed(2);

  const vacEl = document.getElementById("vacationPay");
  if (vacEl) {
    vacEl.closest("p")?.classList.remove("hidden");
    vacEl.textContent = pay.vacation.toFixed(2);
  }

  document.getElementById("fedAmount").textContent   = pay.federal.toFixed(2);
  document.getElementById("cppAmount").textContent   = pay.cpp.toFixed(2);
  document.getElementById("eiAmount").textContent    = pay.ei.toFixed(2);
  document.getElementById("deductions").textContent  = pay.deductions.toFixed(2);
  document.getElementById("netPay").textContent      = pay.net.toFixed(2);
}

function populateDropdown(periods, selectedIdx){
  const sel = document.getElementById("periodSelect");
  sel.innerHTML = "";
  periods.forEach((p, i) => {
    const opt = document.createElement("option");
    opt.value = i;
    opt.textContent = labelRange(p.start, p.end, p.payday);
    sel.appendChild(opt);
  });
  sel.value = String(selectedIdx);
}

// ====== LIVE WIRING ======
let periods = [];
let rowsCache = [];
let selectedIdx = 0;

async function refreshAndRender(){
  try { rowsCache = await fetchShifts(); } catch { rowsCache = []; }

  const p = periods[selectedIdx];
  const label = document.getElementById("periodSelect").options[selectedIdx].textContent;
  const pay = computePay(rowsCache, p.start, p.end);
  renderSummary(pay, label);
  updateChart(pay);
}

document.addEventListener("DOMContentLoaded", async () => {
  // Build periods and default to current running
  periods = generatePeriods(16, 16);
  const cur = currentPeriod();
  selectedIdx = periods.findIndex(pp => pp.idx === cur.idx);
  if (selectedIdx < 0) selectedIdx = Math.floor(periods.length/2);

  populateDropdown(periods, selectedIdx);
  document.getElementById("periodSelect").addEventListener("change", (e) => {
    selectedIdx = Number(e.target.value);
    refreshAndRender();
  });

  // Initial load + live refresh (poll and on focus)
  await refreshAndRender();
  setInterval(refreshAndRender, 20000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) refreshAndRender(); });
});
