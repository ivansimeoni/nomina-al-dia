import * as pdfjsLib from "https://cdn.jsdelivr.net/npm/pdfjs-dist@5.6.205/build/pdf.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdn.jsdelivr.net/npm/pdfjs-dist@5.6.205/build/pdf.worker.mjs";

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
  periodBaseHours: 199.5,
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

let state = loadState();

function defaultState() {
  return {
    app: "Nómina al Día",
    version: APP_VERSION,
    createdBy: "Iván Simeoni",
    lastBackupAt: "",
    period: periodFromPayrollMonth("2026-07"),
    settings: { ...DEFAULT_SETTINGS },
    days: [],
  };
}

function loadState() {
  const saved = safeJson(localStorage.getItem(STORAGE_KEY));
  if (!saved) return defaultState();
  return {
    ...defaultState(),
    ...saved,
    settings: { ...DEFAULT_SETTINGS, ...(saved.settings || {}) },
    days: (saved.days || []).map(normalizeDay).sort((a, b) => a.date.localeCompare(b.date)),
  };
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
  state.days.forEach((day) => {
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
  totals.gross += Number(state.settings.monthlyExtraJuly) + Number(state.settings.monthlyExtraDecember);
  totals.deductions = totals.gross * ((Number(state.settings.irpfPct) + Number(state.settings.socialPct)) / 100);
  totals.net = totals.gross - totals.deductions;
  return totals;
}

function resolvePresence(manualPresence, extractedHours) {
  if (manualPresence > 0) return manualPresence;
  const base = Number(state.settings.periodBaseHours);
  const paid = state.settings.periodPaidHours === "" ? extractedHours : Number(state.settings.periodPaidHours);
  if (!Number.isFinite(base) || !Number.isFinite(paid)) return 0;
  return Math.max(0, paid - base);
}

function dayName(date) {
  return new Date(`${date}T12:00:00`).toLocaleDateString("es-ES", { weekday: "short" }).replace(".", "");
}

function render() {
  writeSettings();
  document.getElementById("periodLabel").textContent = state.period.label;
  document.getElementById("periodRange").textContent = `${formatDate(state.period.from)} - ${formatDate(state.period.to)}`;
  document.getElementById("periodMonth").value = state.period.payrollMonth;
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
  renderRows();
}

function renderRows() {
  const tbody = document.getElementById("rows");
  tbody.innerHTML = "";
  state.days
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
  const rows = [
    ["Presencia", state.settings.payrollPresenceHours, totals.presenceHours, "h"],
    ["Nocturnas", state.settings.payrollNightHours, totals.nightHours, "h"],
    ["Disponibilidad", state.settings.payrollDpHours, totals.dpHours, "h"],
    ["Dietas", state.settings.payrollDiets, totals.dietTotal, "€"],
    ["Devengado", state.settings.payrollGross, totals.gross, "€"],
    ["Deducciones", state.settings.payrollDeductions, totals.deductions, "€"],
    ["Líquido", state.settings.payrollNet, totals.net, "€"],
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

function formatDiff(value, unit) {
  return unit === "€" ? fmtMoney.format(value) : `${fmtNumber.format(value)} ${unit}`;
}

function writeSettings() {
  Object.keys(DEFAULT_SETTINGS).forEach((key) => {
    const input = document.getElementById(key);
    if (input) input.value = state.settings[key];
  });
}

function readSettings() {
  Object.keys(DEFAULT_SETTINGS).forEach((key) => {
    const input = document.getElementById(key);
    if (input) state.settings[key] = input.value;
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
  const end = closeMatches.at(-1);
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
  status.textContent = "Leyendo PDF...";
  for (const file of files) {
    try {
      const text = await extractPdfText(file);
      const parsed = parseWorkPdf(file.name, text);
      const existingIndex = state.days.findIndex((day) => day.date === parsed.date);
      if (existingIndex >= 0) {
        const replace = confirm(`Ya existe un parte para ${formatDate(parsed.date)}. ¿Quieres reemplazarlo?`);
        if (!replace) continue;
        state.days[existingIndex] = parsed;
      } else {
        state.days.push(parsed);
      }
    } catch (error) {
      alert(`No pude leer ${file.name}: ${error.message}`);
    }
  }
  state.days.sort((a, b) => a.date.localeCompare(b.date));
  saveState();
  status.textContent = "Partes actualizados";
  render();
}

function downloadJson() {
  state.lastBackupAt = new Date().toISOString();
  saveState();
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `nomina-al-dia_${state.period.payrollMonth}_24-23.json`;
  link.click();
  URL.revokeObjectURL(url);
  render();
}

async function restoreJson(file) {
  const text = await file.text();
  const restored = safeJson(text);
  if (!restored?.days || !restored?.settings) {
    alert("El JSON no parece ser una copia válida de Nómina al Día.");
    return;
  }
  const proceed = confirm("Esto reemplazará los datos actuales de la app. ¿Continuar?");
  if (!proceed) return;
  state = {
    ...defaultState(),
    ...restored,
    settings: { ...DEFAULT_SETTINGS, ...restored.settings },
    days: restored.days.map(normalizeDay),
  };
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
    const day = state.days.find((item) => item.date === target.dataset.date);
    day.notes = target.value;
    saveState();
  }
});

document.addEventListener("change", (event) => {
  const target = event.target;
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
  if (target.dataset.diet) {
    const day = state.days.find((item) => item.date === target.dataset.date);
    day.dietOverrides[target.dataset.diet] = "manual";
    day.diets[target.dataset.diet] = target.checked;
    saveState();
    render();
    return;
  }
  if (target.dataset.field) {
    const day = state.days.find((item) => item.date === target.dataset.date);
    day[target.dataset.field] = target.value;
    if (target.dataset.field === "serviceType" && target.value === "discrecional_nacional") {
      day.dietOverrides.nationalMeal = "manual";
    }
    saveState();
    render();
  }
});

document.addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  if (button.id === "newPeriodBtn") {
    const month = document.getElementById("periodMonth").value;
    const nextPeriod = periodFromPayrollMonth(month);
    const proceed = confirm(
      `Crear ${nextPeriod.label} (${formatDate(nextPeriod.from)} - ${formatDate(nextPeriod.to)}) vaciará los partes actuales. Guarda una copia antes si los quieres conservar. ¿Continuar?`,
    );
    if (!proceed) return;
    state = { ...defaultState(), period: nextPeriod, days: [] };
    saveState();
    render();
  }
  if (button.id === "saveJsonBtn") downloadJson();
  if (button.dataset.action === "delete") {
    const proceed = confirm(`¿Eliminar el parte del ${formatDate(button.dataset.date)}?`);
    if (!proceed) return;
    state.days = state.days.filter((day) => day.date !== button.dataset.date);
    saveState();
    render();
  }
});

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./service-worker.js").catch(() => {});
}

render();
