const DEFAULT_SETTINGS = {
  baseDayRate: 41.96,
  attendanceRate: 15.53,
  nightRate: 2.07,
  dpRate: 13.79,
  presenceRate: 11.37,
  holidayRate: 17.57,
  regularDietRate: 15,
  nationalDietRate: 19,
  monthlyExtraJuly: 106.91,
  monthlyExtraDecember: 106.91,
  irpfPct: 13,
  socialPct: 6.5,
  periodBaseHours: "",
  periodPaidHours: "",
  payrollPresenceHours: "",
  payrollNightHours: "",
  payrollDpHours: "",
  payrollDiets: "",
  payrollGross: "",
  payrollDeductions: "",
  payrollNet: "",
};

const APP_VERSION = 1;
const STORAGE_KEY = "nomina-al-dia-v2-clean";
const fmtNumber = new Intl.NumberFormat("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtMoney = new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" });
const monthNames = new Intl.DateTimeFormat("es-ES", { month: "long", year: "numeric" });

let pdfjsLib;
const pdfjsReady = loadPdfJs();
let state = loadState();
let activeTab = "actual";

async function loadPdfJs() {
  try {
    pdfjsLib = await import("./vendor/pdfjs/pdf.mjs");
    pdfjsLib.GlobalWorkerOptions.workerSrc = "./vendor/pdfjs/pdf.worker.mjs";
  } catch {
    pdfjsLib = await import("https://cdn.jsdelivr.net/npm/pdfjs-dist@5.6.205/build/pdf.mjs");
    pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdn.jsdelivr.net/npm/pdfjs-dist@5.6.205/build/pdf.worker.mjs";
  }
  return pdfjsLib;
}

function defaultState() {
  const period = createPeriod("2026-07");
  return {
    app: "Nómina al Día",
    version: APP_VERSION,
    createdBy: "Iván Simeoni",
    lastBackupAt: "",
    activePeriodId: period.id,
    periods: [period],
    settings: { ...DEFAULT_SETTINGS },
  };
}

function loadState() {
  const saved = safeJson(localStorage.getItem(STORAGE_KEY));
  if (!saved) return defaultState();
  const migrated = migrateState(saved);
  return {
    ...defaultState(),
    ...migrated,
    settings: { ...DEFAULT_SETTINGS, ...(migrated.settings || {}) },
    periods: (migrated.periods || []).map(normalizePeriod).sort((a, b) => a.period.payrollMonth.localeCompare(b.period.payrollMonth)),
  };
}

function migrateState(saved) {
  if (Array.isArray(saved.periods)) return saved;
  const period = normalizePeriod({
    id: saved.period?.payrollMonth || "2026-07",
    period: saved.period || periodFromPayrollMonth("2026-07"),
    days: saved.days || [],
    payroll: extractPayrollFromSettings(saved.settings || {}),
  });
  return {
    ...saved,
    activePeriodId: period.id,
    periods: [period],
  };
}

function extractPayrollFromSettings(settings) {
  const payroll = {};
  Object.keys(DEFAULT_SETTINGS)
    .filter((key) => key.startsWith("payroll"))
    .forEach((key) => {
      payroll[key] = settings[key] ?? "";
    });
  return payroll;
}

function normalizePeriod(periodRecord) {
  const period = periodRecord.period || periodFromPayrollMonth(periodRecord.id || "2026-07");
  return {
    id: periodRecord.id || period.payrollMonth,
    period,
    days: (periodRecord.days || []).map(normalizeDay).sort((a, b) => a.date.localeCompare(b.date)),
    payroll: { ...emptyPayroll(), ...(periodRecord.payroll || {}) },
  };
}

function emptyPayroll() {
  return {
    payrollPresenceHours: "",
    payrollNightHours: "",
    payrollDpHours: "",
    payrollDiets: "",
    payrollGross: "",
    payrollDeductions: "",
    payrollNet: "",
  };
}

function createPeriod(monthValue) {
  const period = periodFromPayrollMonth(monthValue);
  return {
    id: period.payrollMonth,
    period,
    days: [],
    payroll: emptyPayroll(),
  };
}

function activePeriod() {
  let period = state.periods.find((item) => item.id === state.activePeriodId);
  if (!period) {
    period = state.periods[state.periods.length - 1] || createPeriod("2026-07");
    state.activePeriodId = period.id;
  }
  return period;
}

function activeDays() {
  return activePeriod().days;
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function safeJson(text) {
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

function normalizeDay(day) {
  const normalized = {
    date: day.date,
    sourceFile: day.sourceFile || "",
    restDocument: Boolean(day.restDocument),
    dayType: day.dayType || (day.segments?.length ? "normal" : "descanso"),
    serviceType: day.serviceType || "regular",
    segments: day.segments || [],
    freeDisposition: day.freeDisposition || [],
    manualPresenceHours: day.manualPresenceHours ?? "",
    manualDpHours: day.manualDpHours ?? "",
    diets: {
      regularMeal: Boolean(day.diets?.regularMeal),
      regularDinner: Boolean(day.diets?.regularDinner),
      nationalMeal: Boolean(day.diets?.nationalMeal),
      nationalDinner: Boolean(day.diets?.nationalDinner),
    },
    dietOverrides: {
      regularMeal: day.dietOverrides?.regularMeal ?? "auto",
      regularDinner: day.dietOverrides?.regularDinner ?? "auto",
      nationalMeal: day.dietOverrides?.nationalMeal ?? "manual",
      nationalDinner: day.dietOverrides?.nationalDinner ?? "manual",
    },
    notes: day.notes || "",
    importedAt: day.importedAt || new Date().toISOString(),
  };
  applyAutoDiets(normalized);
  return normalized;
}

function periodFromPayrollMonth(monthValue) {
  const [year, month] = monthValue.split("-").map(Number);
  const start = new Date(year, month - 2, 24);
  const end = new Date(year, month - 1, 23);
  const label = capitalize(monthNames.format(new Date(year, month - 1, 1)));
  return {
    payrollMonth: monthValue,
    label,
    from: toDateInput(start),
    to: toDateInput(end),
  };
}

function toDateInput(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function capitalize(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function toMinutes(time) {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

function hoursBetween(start, end) {
  let a = toMinutes(start);
  let b = toMinutes(end);
  if (b < a) b += 1440;
  return (b - a) / 60;
}

function spanCrosses(segments, startWindow, endWindow) {
  if (!segments.length) return false;
  const first = segments[0][0];
  const last = segments[segments.length - 1][1];
  let start = toMinutes(first);
  let end = toMinutes(last);
  if (end < start) end += 1440;
  return start <= startWindow && end >= endWindow;
}

function overlapHours(start, end, winStart, winEnd) {
  let a = toMinutes(start);
  let b = toMinutes(end);
  if (b < a) b += 1440;
  return [[winStart, winEnd], [winStart + 1440, winEnd + 1440]].reduce(
    (total, [x, y]) => total + Math.max(0, Math.min(b, y) - Math.max(a, x)) / 60,
    0,
  );
}

function calcDay(day) {
  const total = day.segments.reduce((sum, [a, b]) => sum + hoursBetween(a, b), 0);
  const night = day.segments.reduce((sum, [a, b]) => sum + overlapHours(a, b, 22 * 60, 30 * 60), 0);
  const workDay = total > 0 ? 1 : 0;
  const isRestWorked = day.dayType === "descanso_trabajado";
  const isHolidayWorked = day.dayType === "festivo_trabajado";
  const dpAuto = isRestWorked && total > 0 ? Math.max(total, 8) : 0;
  const dpHours = day.manualDpHours === "" ? dpAuto : Number(day.manualDpHours);
  const holidayHours = isHolidayWorked && total > 0 ? Math.max(total, 8) : 0;
  const manualPresence = day.manualPresenceHours === "" ? 0 : Number(day.manualPresenceHours);
  const diets = calcDiets(day);
  const amount =
    workDay * Number(state.settings.baseDayRate) +
    workDay * Number(state.settings.attendanceRate) +
    night * Number(state.settings.nightRate) +
    dpHours * Number(state.settings.dpRate) +
    holidayHours * Number(state.settings.holidayRate) +
    manualPresence * Number(state.settings.presenceRate) +
    diets.total;
  const warnings = [];
  if (!day.restDocument && day.dayType !== "descanso" && total === 0) warnings.push("Sin horas");
  if (day.segments.length > 2) warnings.push("Más de dos tramos");
  if (total > 12) warnings.push("Jornada larga");
  return { total, night, workDay, dpHours, holidayHours, manualPresence, diets, amount, warnings };
}

function calcDiets(day) {
  const regularMeal = day.diets.regularMeal;
  const regularDinner = day.diets.regularDinner;
  const nationalMeal = day.diets.nationalMeal;
  const nationalDinner = day.diets.nationalDinner;
  const total =
    (regularMeal ? Number(state.settings.regularDietRate) : 0) +
    (regularDinner ? Number(state.settings.regularDietRate) : 0) +
    (nationalMeal ? Number(state.settings.nationalDietRate) : 0) +
    (nationalDinner ? Number(state.settings.nationalDietRate) : 0);
  return { regularMeal, regularDinner, nationalMeal, nationalDinner, total };
}

function applyAutoDiets(day) {
  const autoMeal = spanCrosses(day.segments || [], 12 * 60, 14 * 60);
  const autoDinner = spanCrosses(day.segments || [], 20 * 60, 22 * 60);
  if (day.dietOverrides.regularMeal === "auto") day.diets.regularMeal = autoMeal;
  if (day.dietOverrides.regularDinner === "auto") day.diets.regularDinner = autoDinner;
}

function calcTotals() {
  const totals = {
    workDays: 0,
    totalHours: 0,
    nightHours: 0,
    dpHours: 0,
    holidayHours: 0,
    manualPresence: 0,
    dietTotal: 0,
    gross: 0,
  };
  activeDays().forEach((day) => {
    const c = calcDay(day);
    totals.workDays += c.workDay;
    totals.totalHours += c.total;
    totals.nightHours += c.night;
    totals.dpHours += c.dpHours;
    totals.holidayHours += c.holidayHours;
    totals.manualPresence += c.manualPresence;
    totals.dietTotal += c.diets.total;
    totals.gross += c.amount;
  });
  const presence = resolvePresence(totals.manualPresence, totals.totalHours);
  totals.presenceHours = presence;
  totals.gross += presence * Number(state.settings.presenceRate);
  if (totals.workDays > 0) {
    totals.gross += Number(state.settings.monthlyExtraJuly) + Number(state.settings.monthlyExtraDecember);
  }
  totals.deductions = totals.gross * ((Number(state.settings.irpfPct) + Number(state.settings.socialPct)) / 100);
  totals.net = totals.gross - totals.deductions;
  return totals;
}

function resolvePresence(manualPresence, extractedHours) {
  if (manualPresence > 0) return manualPresence;
  const base = Number(state.settings.periodBaseHours);
  const paid = state.settings.periodPaidHours === "" ? extractedHours : Number(state.settings.periodPaidHours);
  if (!Number.isFinite(base) || !Number.isFinite(paid) || base <= 0) return 0;
  return Math.max(0, paid - base);
}

function dayName(date) {
  return new Date(`${date}T12:00:00`).toLocaleDateString("es-ES", { weekday: "short" }).replace(".", "");
}

function render() {
  writeSettings();
  const current = activePeriod();
  document.getElementById("periodLabel").textContent = current.period.label;
  document.getElementById("periodRange").textContent = `${formatDate(current.period.from)} - ${formatDate(current.period.to)}`;
  document.getElementById("periodMonth").value = current.period.payrollMonth;
  renderPeriodSelect();
  document.getElementById("backupStatus").textContent = state.lastBackupAt
    ? `Última copia: ${new Date(state.lastBackupAt).toLocaleString("es-ES")}`
    : "Sin copia descargada";

  const totals = calcTotals();
  document.getElementById("workDays").textContent = totals.workDays;
  document.getElementById("totalHours").textContent = fmtNumber.format(totals.totalHours);
  document.getElementById("nightHours").textContent = fmtNumber.format(totals.nightHours);
  document.getElementById("dpHours").textContent = fmtNumber.format(totals.dpHours);
  document.getElementById("grossTotal").textContent = fmtMoney.format(totals.gross);
  renderDiffs(totals);
  renderHistory();
  renderRows();
  renderTabs();
}

function renderPeriodSelect() {
  const select = document.getElementById("periodSelect");
  select.innerHTML = state.periods
    .map((period) => `<option value="${period.id}" ${period.id === state.activePeriodId ? "selected" : ""}>${period.period.label}</option>`)
    .join("");
}

function renderRows() {
  const tbody = document.getElementById("rows");
  tbody.innerHTML = "";
  activeDays()
    .sort((a, b) => a.date.localeCompare(b.date))
    .forEach((day) => {
      const c = calcDay(day);
      const tr = document.createElement("tr");
      tr.className = day.dayType === "descanso" ? "rest-day" : "";
      tr.innerHTML = `
        <td>${day.date}</td>
        <td>${dayName(day.date)}</td>
        <td><span class="file-name">${escapeHtml(day.sourceFile || "Manual")}</span></td>
        <td class="segments">${day.segments.length ? day.segments.map(([a, b]) => `${a}-${b}`).join("<br>") : "Descanso"}</td>
        <td class="num">${fmtNumber.format(c.total)}</td>
        <td class="num">${fmtNumber.format(c.night)}</td>
        <td>${dayTypeSelect(day)}</td>
        <td>${serviceTypeSelect(day)}</td>
        <td>${dietControls(day)}</td>
        <td><input class="small-input" data-date="${day.date}" data-field="manualDpHours" type="number" min="0" step="0.01" value="${day.manualDpHours}" placeholder="${fmtNumber.format(c.dpHours)}"></td>
        <td><input class="small-input" data-date="${day.date}" data-field="manualPresenceHours" type="number" min="0" step="0.01" value="${day.manualPresenceHours}"></td>
        <td class="num money">${fmtMoney.format(c.amount)}</td>
        <td><span class="status ${c.warnings.length ? "warn" : "ok"}">${c.warnings.length ? c.warnings.join(", ") : "OK"}</span></td>
        <td><textarea data-date="${day.date}" data-field="notes">${escapeHtml(day.notes)}</textarea></td>
        <td><button class="icon-btn" data-action="delete" data-date="${day.date}" title="Eliminar parte">×</button></td>
      `;
      tbody.appendChild(tr);
    });
}

function dayTypeSelect(day) {
  const options = [
    ["normal", "Normal"],
    ["descanso", "Descanso"],
    ["descanso_trabajado", "Descanso trabajado"],
    ["festivo_trabajado", "Festivo trabajado"],
  ];
  return `<select data-date="${day.date}" data-field="dayType">${options
    .map(([value, label]) => `<option value="${value}" ${day.dayType === value ? "selected" : ""}>${label}</option>`)
    .join("")}</select>`;
}

function serviceTypeSelect(day) {
  const options = [
    ["regular", "Regular"],
    ["discrecional_nacional", "Discrecional nacional"],
  ];
  return `<select data-date="${day.date}" data-field="serviceType">${options
    .map(([value, label]) => `<option value="${value}" ${day.serviceType === value ? "selected" : ""}>${label}</option>`)
    .join("")}</select>`;
}

function dietControls(day) {
  const entries = [
    ["regularMeal", "Comida"],
    ["regularDinner", "Cena"],
    ["nationalMeal", "Comida disc."],
    ["nationalDinner", "Cena disc."],
  ];
  return `<div class="diet-grid">${entries
    .map(
      ([key, label]) => `
        <label class="check-label">
          <input data-date="${day.date}" data-diet="${key}" type="checkbox" ${day.diets[key] ? "checked" : ""}>
          ${label}
        </label>`,
    )
    .join("")}</div>`;
}

function renderDiffs(totals) {
  const payroll = activePeriod().payroll;
  const rows = [
    ["Presencia", payroll.payrollPresenceHours, totals.presenceHours, "h"],
    ["Nocturnas", payroll.payrollNightHours, totals.nightHours, "h"],
    ["Disponibilidad", payroll.payrollDpHours, totals.dpHours, "h"],
    ["Dietas", payroll.payrollDiets, totals.dietTotal, "€"],
    ["Devengado", payroll.payrollGross, totals.gross, "€"],
    ["Deducciones", payroll.payrollDeductions, totals.deductions, "€"],
    ["Líquido", payroll.payrollNet, totals.net, "€"],
  ];
  document.getElementById("diffBox").innerHTML = rows
    .map(([label, payroll, estimated, unit]) => {
      const payrollNumber = payroll === "" ? null : Number(payroll);
      const main = unit === "€" ? fmtMoney.format(estimated) : `${fmtNumber.format(estimated)} ${unit}`;
      const diff = payrollNumber === null ? "Sin dato real" : `Diferencia: ${formatDiff(payrollNumber - estimated, unit)}`;
      return `<div><strong>${label}</strong><br><span>Estimado: ${main}</span><br><span>${diff}</span></div>`;
    })
    .join("");
}

function renderHistory() {
  const tbody = document.getElementById("historyRows");
  const records = state.periods.map((period) => {
    const totals = calcTotalsForPeriod(period);
    const payroll = period.payroll;
    return { period, totals, payroll };
  });
  tbody.innerHTML = records
    .map(({ period, totals, payroll }) => {
      return `
        <tr>
          <td>${period.period.label}</td>
          <td>${formatDate(period.period.from)} - ${formatDate(period.period.to)}</td>
          <td class="num">${totals.workDays}</td>
          <td class="num">${fmtNumber.format(totals.totalHours)}</td>
          <td class="num">${fmtNumber.format(totals.nightHours)}</td>
          <td class="num">${fmtNumber.format(totals.dpHours)}</td>
          <td class="num money">${fmtMoney.format(totals.gross)}</td>
          <td class="num">${payroll.payrollGross === "" ? "-" : fmtMoney.format(Number(payroll.payrollGross))}</td>
          <td class="num money">${fmtMoney.format(totals.net)}</td>
          <td class="num">${payroll.payrollNet === "" ? "-" : fmtMoney.format(Number(payroll.payrollNet))}</td>
        </tr>`;
    })
    .join("");
  renderHistoryChart(records);
}

function renderHistoryChart(records) {
  const chart = document.getElementById("historyChart");
  if (!records.length) {
    chart.innerHTML = "";
    return;
  }
  const maxValue = Math.max(
    1,
    ...records.map(({ totals, payroll }) => Math.max(totals.net, payroll.payrollNet === "" ? 0 : Number(payroll.payrollNet))),
  );
  chart.innerHTML = records
    .map(({ period, totals, payroll }) => {
      const realNet = payroll.payrollNet === "" ? null : Number(payroll.payrollNet);
      const estimatedWidth = Math.max(2, (totals.net / maxValue) * 100);
      const realWidth = realNet === null ? 0 : Math.max(2, (realNet / maxValue) * 100);
      return `
        <div class="chart-row">
          <strong>${period.period.label}</strong>
          <div class="chart-bars">
            <span class="chart-bar estimated" style="width: ${estimatedWidth}%"></span>
            ${realNet === null ? "" : `<span class="chart-bar real" style="width: ${realWidth}%"></span>`}
          </div>
          <span class="chart-value">${fmtMoney.format(totals.net)}${realNet === null ? "" : ` / ${fmtMoney.format(realNet)}`}</span>
        </div>`;
    })
    .join("");
}

function renderTabs() {
  document.querySelectorAll("[data-tab]").forEach((button) => {
    button.classList.toggle("active", button.dataset.tab === activeTab);
  });
  document.querySelectorAll("[data-tab-panel]").forEach((panel) => {
    panel.hidden = panel.dataset.tabPanel !== activeTab;
  });
}

function calcTotalsForPeriod(period) {
  const previousActive = state.activePeriodId;
  state.activePeriodId = period.id;
  const totals = calcTotals();
  state.activePeriodId = previousActive;
  return totals;
}

function formatDiff(value, unit) {
  return unit === "€" ? fmtMoney.format(value) : `${fmtNumber.format(value)} ${unit}`;
}

function writeSettings() {
  Object.keys(DEFAULT_SETTINGS).forEach((key) => {
    const input = document.getElementById(key);
    if (!input) return;
    if (key.startsWith("payroll")) {
      input.value = activePeriod().payroll[key] ?? "";
    } else {
      input.value = state.settings[key];
    }
  });
}

function readSettings() {
  Object.keys(DEFAULT_SETTINGS).forEach((key) => {
    const input = document.getElementById(key);
    if (!input) return;
    if (key.startsWith("payroll")) {
      activePeriod().payroll[key] = input.value;
    } else {
      state.settings[key] = input.value;
    }
  });
}

function formatDate(date) {
  const [y, m, d] = date.split("-");
  return `${d}/${m}/${y}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

async function extractPdfText(file) {
  await pdfjsReady;
  const data = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjsLib.getDocument({ data }).promise;
  let text = "";
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    text += `${content.items.map((item) => item.str).join(" ")}\n`;
  }
  return text;
}

function parseWorkPdf(fileName, text) {
  const dateMatch = text.match(/(\d{2})\/(\d{2})\/(\d{4})/) || fileName.match(/(\d{2})_(\d{2})_(\d{4})/);
  if (!dateMatch) throw new Error("No pude detectar la fecha");
  const date = `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}`;
  const restDocument = /DESCANSO DEL DIA/i.test(text) || /^Descanso/i.test(fileName);
  const start = matchTime(text, /PRESENTACION\s*PRE\s*([0-2]?\d[:.]\d{2})/i);
  const closeMatches = [...text.matchAll(/CIERRE\s*CIE\s*([0-2]?\d[:.]\d{2})/gi)].map((m) => normalizeTime(m[1]));
  const end = closeMatches[closeMatches.length - 1];
  const freeDisposition = [...text.matchAll(/Libre Disposici[oó]n De\s*([0-2]?\d[:.]\d{2})\s*a\s*([0-2]?\d[:.]\d{2})/gi)].map((m) => [
    normalizeTime(m[1]),
    normalizeTime(m[2]),
  ]);
  const segments = [];
  if (!restDocument && start && end) {
    let current = start;
    freeDisposition.forEach(([a, b]) => {
      segments.push([current, a]);
      current = b;
    });
    segments.push([current, end]);
  }
  return normalizeDay({
    date,
    sourceFile: fileName,
    restDocument,
    dayType: restDocument ? "descanso" : "normal",
    serviceType: "regular",
    segments,
    freeDisposition,
    importedAt: new Date().toISOString(),
  });
}

function parsePayrollPdf(text) {
  const parsed = {
    payrollPresenceHours: findPayrollNumber(text, /\*?HORAS DE PRESENCIA\s+(\d+,\d{2})/i),
    payrollNightHours: findPayrollNumber(text, /\*?PLUS NOCTURNIDAD\s+(\d+,\d{2})/i),
    payrollDpHours: findPayrollNumber(text, /\*?PLUS DISPONIBILIDAD\s+(\d+,\d{2})/i),
    payrollGross: null,
    payrollDeductions: null,
    payrollNet: null,
  };
  const diets = [
    ...text.matchAll(/-DIETA[^\n\r]*?\s+(\d+,\d{2})\s+(\d+,\d{2})\s+(\d+,\d{2})/gi),
  ].reduce((sum, match) => sum + parseSpanishNumber(match[2]), 0);
  parsed.payrollDiets = diets || null;

  const totalsMatch = text.match(/([\d.]+,\d{2})\s+([\d.]+,\d{2})\s+([\d.]+,\d{2})\s+HUESCA/i);
  if (totalsMatch) {
    parsed.payrollNet = parseSpanishNumber(totalsMatch[1]);
    parsed.payrollGross = parseSpanishNumber(totalsMatch[2]);
    parsed.payrollDeductions = parseSpanishNumber(totalsMatch[3]);
  }
  return parsed;
}

function findPayrollNumber(text, regex) {
  const match = text.match(regex);
  return match ? parseSpanishNumber(match[1]) : null;
}

function parseSpanishNumber(value) {
  if (!value) return 0;
  return Number(String(value).replaceAll(".", "").replace(",", "."));
}

async function handlePayrollPdf(file) {
  const status = document.getElementById("payrollLoadStatus");
  status.textContent = "Leyendo nómina...";
  try {
    const text = await extractPdfText(file);
    const payroll = parsePayrollPdf(text);
    let loaded = 0;
    Object.entries(payroll).forEach(([key, value]) => {
      if (value === null || Number.isNaN(value)) return;
      activePeriod().payroll[key] = Number(value.toFixed(2));
      loaded += 1;
    });
    saveState();
    render();
    status.textContent = loaded
      ? `Nómina cargada: ${loaded} campos rellenados.`
      : "No pude detectar conceptos automáticamente. Puedes cargarlos a mano.";
  } catch (error) {
    status.textContent = "No pude leer la nómina.";
    alert(`No pude leer la nómina: ${error.message}`);
  }
}

function matchTime(text, regex) {
  const match = text.match(regex);
  return match ? normalizeTime(match[1]) : "";
}

function normalizeTime(value) {
  const match = value.trim().match(/(\d{1,2})[:.](\d{2})/);
  return match ? `${String(Number(match[1])).padStart(2, "0")}:${match[2]}` : "";
}

async function handlePdfFiles(files) {
  const status = document.getElementById("loadStatus");
  if (!files.length) return;
  status.textContent = "Leyendo PDF...";
  const days = activeDays();
  let loaded = 0;
  for (const file of files) {
    try {
      const text = await extractPdfText(file);
      const parsed = parseWorkPdf(file.name, text);
      const existingIndex = days.findIndex((day) => day.date === parsed.date);
      if (existingIndex >= 0) {
        const replace = confirm(`Ya existe un parte para ${formatDate(parsed.date)}. ¿Quieres reemplazarlo?`);
        if (!replace) continue;
        days[existingIndex] = parsed;
      } else {
        days.push(parsed);
      }
      loaded += 1;
    } catch (error) {
      alert(`No pude leer ${file.name}: ${error.message}`);
    }
  }
  days.sort((a, b) => a.date.localeCompare(b.date));
  saveState();
  if (loaded > 0) activeTab = "partes";
  render();
  status.textContent = loaded === 1 ? "1 parte actualizado" : `${loaded} partes actualizados`;
}

function downloadJson() {
  state.lastBackupAt = new Date().toISOString();
  saveState();
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `nomina-al-dia_historial_${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
  render();
}

async function restoreJson(file) {
  const text = await file.text();
  const restored = safeJson(text);
  if ((!restored?.days && !restored?.periods) || !restored?.settings) {
    alert("El JSON no parece ser una copia válida de Nómina al Día.");
    return;
  }
  const proceed = confirm("Esto reemplazará los datos actuales de la app. ¿Continuar?");
  if (!proceed) return;
  state = {
    ...defaultState(),
    ...restored,
    settings: { ...DEFAULT_SETTINGS, ...restored.settings },
    periods: (migrateState(restored).periods || []).map(normalizePeriod),
  };
  if (!state.periods.length) state.periods = [createPeriod("2026-07")];
  if (!state.periods.some((period) => period.id === state.activePeriodId)) state.activePeriodId = state.periods[state.periods.length - 1].id;
  saveState();
  render();
}

document.addEventListener("input", (event) => {
  const target = event.target;
  if (target.matches(".settings-grid input, .comparison-grid input")) {
    readSettings();
    saveState();
    render();
    return;
  }
  if (target.dataset.field === "notes") {
    const day = activeDays().find((item) => item.date === target.dataset.date);
    if (!day) return;
    day.notes = target.value;
    saveState();
  }
});

document.addEventListener("change", (event) => {
  const target = event.target;
  if (target.id === "periodSelect") {
    state.activePeriodId = target.value;
    saveState();
    render();
    return;
  }
  if (target.id === "pdfInput") {
    handlePdfFiles([...target.files]);
    target.value = "";
    return;
  }
  if (target.id === "jsonInput") {
    if (target.files[0]) restoreJson(target.files[0]);
    target.value = "";
    return;
  }
  if (target.id === "payrollPdfInput") {
    if (target.files[0]) handlePayrollPdf(target.files[0]);
    target.value = "";
    return;
  }
  if (target.dataset.diet) {
    const day = activeDays().find((item) => item.date === target.dataset.date);
    if (!day) return;
    day.dietOverrides[target.dataset.diet] = "manual";
    day.diets[target.dataset.diet] = target.checked;
    saveState();
    render();
    return;
  }
  if (target.dataset.field) {
    const day = activeDays().find((item) => item.date === target.dataset.date);
    if (!day) return;
    day[target.dataset.field] = target.value;
    if (target.dataset.field === "serviceType" && target.value === "discrecional_nacional") {
      day.dietOverrides.nationalMeal = "manual";
    }
    saveState();
    render();
  }
});

document.addEventListener("click", (event) => {
  const tab = event.target.closest("[data-tab]");
  if (tab) {
    activeTab = tab.dataset.tab;
    renderTabs();
    return;
  }
  const button = event.target.closest("button");
  if (!button) return;
  if (button.id === "newPeriodBtn") {
    const month = document.getElementById("periodMonth").value;
    if (!month) return;
    let period = state.periods.find((item) => item.id === month);
    if (!period) {
      period = createPeriod(month);
      state.periods.push(period);
      state.periods.sort((a, b) => a.period.payrollMonth.localeCompare(b.period.payrollMonth));
    }
    state.activePeriodId = period.id;
    saveState();
    render();
  }
  if (button.id === "saveJsonBtn") downloadJson();
  if (button.dataset.action === "delete") {
    const proceed = confirm(`¿Eliminar el parte del ${formatDate(button.dataset.date)}?`);
    if (!proceed) return;
    activePeriod().days = activeDays().filter((day) => day.date !== button.dataset.date);
    saveState();
    render();
  }
});

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./service-worker.js").catch(() => {});
}

render();
