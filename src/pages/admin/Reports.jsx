import LoadingIndicator from "../../components/LoadingIndicator";
import { useMemo, useRef, useState } from "react";
import { collection, getDocs } from "firebase/firestore";
import { utils as xlsxUtils, writeFile as writeExcelFile } from "xlsx";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import EmptyState from "../../components/EmptyState";
import { db } from "../../firebase";
import {
  buildReportData,
  formatReportCurrency,
  formatReportDate,
  formatReportPeriod,
  getManilaToday,
  toManilaDateKey,
} from "../../utils/reports";

const REPORT_CATEGORIES = ["Appointments", "Patients", "Payments", "Services", "Dentists"];
const COLLECTIONS_BY_CATEGORY = {
  Appointments: ["bookings", "patients", "dentists"],
  Patients: ["patients", "bookings"],
  Payments: [
    "payments",
    "paymentTreatmentSummaries",
    "bracesAccounts",
    "bracesPayments",
    "patients",
    "bookings",
  ],
  Services: ["bookings", "clinicServices"],
  Dentists: ["bookings", "dentists"],
};
const PAGE_SIZE = 20;
const CHART_COLORS = ["#FFC94D", "#6BB58B", "#D7C8A3", "#9AA39B", "#E1A468"];
const DEFAULT_SORT = {
  Appointments: { key: "sortDate", direction: "desc" },
  Patients: { key: "dateRegistered", direction: "desc" },
  Payments: { key: "sortDate", direction: "desc" },
  Services: { key: "rank", direction: "asc" },
  Dentists: { key: "name", direction: "asc" },
};

function getInitialFilters() {
  const today = getManilaToday();
  return {
    category: REPORT_CATEGORIES[0],
    startDate: `${today.slice(0, 7)}-01`,
    endDate: today,
  };
}

function formatCardValue(card) {
  if (card.format === "currency") return formatReportCurrency(card.value);
  if (typeof card.value === "number") return new Intl.NumberFormat("en-PH").format(card.value);
  return card.value;
}

function getDisplayedValue(row, column) {
  if (column.render) return column.render(row);
  const value = row[column.key];
  if (value == null || value === "") return "—";
  if (column.type === "currency") return formatReportCurrency(value);
  if (column.type === "percentage") return `${Number(value).toFixed(1)}%`;
  if (column.type === "number") return new Intl.NumberFormat("en-PH").format(Number(value) || 0);
  if (column.key === "date" || column.key === "dateRegistered") return formatReportDate(value);
  return String(value);
}

function getSortValue(row, column) {
  const value = row[column.sortKey || column.key];
  if (column.type === "number" || column.type === "currency" || column.type === "percentage") {
    return Number(value) || 0;
  }
  return String(value ?? "").toLocaleLowerCase();
}

function exportFileName(category, range, extension) {
  return `topdent-${category.toLowerCase()}-${range.start}-to-${range.end}.${extension}`;
}

function exportTableRows(rows, columns) {
  return rows.map((row) => columns.map((column) => {
    const value = getDisplayedValue(row, column);
    return value === "—" ? "" : value;
  }));
}

function dateDistance(start, end) {
  return Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000);
}

function getBucketKey(dateKey, grouping) {
  if (grouping === "month") return dateKey.slice(0, 7);
  if (grouping === "week") {
    const date = new Date(`${dateKey}T00:00:00Z`);
    const weekday = date.getUTCDay() || 7;
    date.setUTCDate(date.getUTCDate() - weekday + 1);
    return date.toISOString().slice(0, 10);
  }
  return dateKey;
}

function getChartBuckets(range) {
  const span = dateDistance(range.start, range.end);
  const grouping = span <= 45 ? "day" : span <= 180 ? "week" : "month";
  const buckets = [];
  let date = new Date(`${range.start}T00:00:00Z`);
  const end = new Date(`${range.end}T00:00:00Z`);

  if (grouping === "week") {
    const weekday = date.getUTCDay() || 7;
    date.setUTCDate(date.getUTCDate() - weekday + 1);
  } else if (grouping === "month") {
    date.setUTCDate(1);
  }

  while (date <= end) {
    const key = date.toISOString().slice(0, 10);
    buckets.push({
      key: grouping === "month" ? key.slice(0, 7) : key,
      date: key,
    });
    if (grouping === "month") date.setUTCMonth(date.getUTCMonth() + 1);
    else date.setUTCDate(date.getUTCDate() + (grouping === "week" ? 7 : 1));
  }
  return { grouping, buckets };
}

function normalizeStatus(value) {
  return String(value || "Unknown").trim().replace(/[_-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function bookingStatus(booking) {
  const status = String(booking.status || "pending").toLowerCase().replace(/[\s-]+/g, "_");
  if (status === "pending_payment" && booking.treatmentCompletedAt) return "Completed";
  if (status === "pending_payment") return "Pending payment";
  return normalizeStatus(status);
}

function getBookingServices(booking) {
  const services = Array.isArray(booking.services) && booking.services.length
    ? booking.services
    : String(booking.service || "").split(",");
  return [...new Set(services
    .map((service) => String(typeof service === "string" ? service : service?.name || "").trim())
    .filter(Boolean))];
}

function getChartRows(category, data) {
  if (category === "Appointments") {
    return (data.bookings || [])
      .filter((booking) => booking.archiveStatus !== "Archived")
      .map((booking) => ({
        date: toManilaDateKey(booking.date || booking.appointmentAt),
        value: 1,
        status: bookingStatus(booking),
      }));
  }
  if (category === "Patients") {
    return (data.patients || [])
      .filter((patient) => patient.status !== "Archived")
      .map((patient) => ({
        date: toManilaDateKey(patient.createdAt || patient.registeredAt),
        value: 1,
        status: String(patient.patientType || "").toLowerCase().includes("ortho") ? "Ortho" : "Regular",
      }));
  }
  if (category === "Payments") {
    return [...(data.payments || []), ...(data.bracesPayments || [])].map((payment) => ({
      date: toManilaDateKey(payment.paymentDate || payment.date || payment.paidAt || payment.createdAt),
      value: Math.max(0, Number(payment.amount ?? payment.paid) || 0),
    }));
  }
  const bookings = (data.bookings || []).filter((booking) => booking.archiveStatus !== "Archived");
  if (category === "Services") {
    return bookings.map((booking) => ({
      date: toManilaDateKey(booking.date || booking.appointmentAt),
      value: getBookingServices(booking).length,
      status: bookingStatus(booking),
    }));
  }
  return bookings.map((booking) => ({
    date: toManilaDateKey(booking.date || booking.appointmentAt),
    value: 1,
    status: bookingStatus(booking),
  }));
}

function buildChartData(category, data, report, range) {
  const { grouping, buckets } = getChartBuckets(range);
  const chartRows = getChartRows(category, data)
    .filter((row) => row.date >= range.start && row.date <= range.end);
  const valuesByPeriod = new Map(buckets.map(({ key }) => [key, 0]));
  chartRows.forEach((row) => {
    const key = getBucketKey(row.date, grouping);
    if (valuesByPeriod.has(key)) valuesByPeriod.set(key, valuesByPeriod.get(key) + row.value);
  });
  const trend = buckets.map(({ key, date }) => ({
    key,
    label: grouping === "month"
      ? new Intl.DateTimeFormat("en-PH", { month: "short", year: "2-digit", timeZone: "UTC" })
        .format(new Date(`${date}T00:00:00Z`))
      : grouping === "week"
        ? formatReportDate(date)
        : new Intl.DateTimeFormat("en-PH", { day: "numeric", month: "short", timeZone: "UTC" })
          .format(new Date(`${date}T00:00:00Z`)),
    value: valuesByPeriod.get(key) || 0,
  }));

  let distribution = [];
  if (category === "Services") {
    distribution = report.rows
      .filter((row) => row.bookings > 0)
      .map((row) => ({ label: row.name, value: row.bookings }));
  } else if (category === "Dentists") {
    const completed = report.rows.reduce((total, row) => total + row.completedTreatments, 0);
    const active = report.rows.reduce((total, row) => total + row.activeTreatments, 0);
    const other = report.rows.reduce((total, row) => total + row.otherAppointments, 0);
    distribution = [
      { label: "Completed", value: completed },
      { label: "Active", value: active },
      { label: "Other", value: other },
    ];
  } else if (category === "Payments") {
    const counts = new Map();
    report.rows.forEach((row) => {
      counts.set(row.status, (counts.get(row.status) || 0) + 1);
    });
    distribution = [...counts].map(([label, value]) => ({ label, value }));
  } else {
    const counts = new Map();
    chartRows.forEach((row) => {
      if (!row.status) return;
      counts.set(row.status, (counts.get(row.status) || 0) + 1);
    });
    distribution = [...counts].map(([label, value]) => ({ label, value }));
  }

  return {
    grouping,
    trend,
    distribution: distribution.filter((entry) => entry.value > 0),
  };
}

function ReportsTable({ columns, rows, page, setPage, sort, setSort }) {
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const pageRows = rows.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  function sortBy(column) {
    setPage(1);
    setSort((current) => ({
      key: column.sortKey || column.key,
      direction: current.key === (column.sortKey || column.key) && current.direction === "asc" ? "desc" : "asc",
    }));
  }

  return (
    <>
      <div className="reportsTableWrap">
        <table className="reportsTable">
          <thead>
            <tr>
              {columns.map((column) => (
                <th key={column.key} scope="col">
                  <button
                    type="button"
                    className="reportsSortButton"
                    onClick={() => sortBy(column)}
                    aria-label={`Sort by ${column.label}`}
                  >
                    {column.label}
                    <span aria-hidden="true">
                      {sort.key === (column.sortKey || column.key)
                        ? (sort.direction === "asc" ? " ↑" : " ↓")
                        : " ↕"}
                    </span>
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pageRows.map((row) => (
              <tr key={row.id}>
                {columns.map((column) => {
                  const value = getDisplayedValue(row, column);
                  const isStatus = ["status", "patientType"].includes(column.key);
                  const statusClass = String(row[column.key] || "").toLowerCase().replace(/[\s_]+/g, "-");
                  return (
                    <td key={column.key} data-label={column.label}>
                      {isStatus ? <span className={`reportsStatus reportsStatus-${statusClass}`}>{value}</span> : value}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="reportsTableFooter">
        <span>
          {rows.length
            ? `Showing ${(currentPage - 1) * PAGE_SIZE + 1}–${Math.min(currentPage * PAGE_SIZE, rows.length)} of ${rows.length}`
            : "No records"}
        </span>
        <div className="reportsPagination" aria-label="Report table pagination">
          <button
            type="button"
            className="reportsPageButton"
            onClick={() => setPage((current) => Math.max(1, current - 1))}
            disabled={currentPage <= 1}
            aria-label="Previous page"
          >
            Previous
          </button>
          <label>Page <select className="input" aria-label="Select report page" value={currentPage} onChange={event => setPage(Number(event.target.value))}>
            {Array.from({ length: pageCount }, (_, index) => <option key={index + 1} value={index + 1}>{index + 1}</option>)}
          </select> of {pageCount}</label>
          <button
            type="button"
            className="reportsPageButton"
            onClick={() => setPage((current) => Math.min(pageCount, current + 1))}
            disabled={currentPage >= pageCount}
            aria-label="Next page"
          >
            Next
          </button>
        </div>
      </div>
    </>
  );
}

function TrendsChart({ trend, category, grouping }) {
  const maxValue = Math.max(1, ...trend.map((entry) => entry.value));
  const points = trend.map((entry, index) => {
    const x = trend.length === 1 ? 200 : 16 + (index / (trend.length - 1)) * 368;
    const y = 142 - (entry.value / maxValue) * 116;
    return `${x},${y}`;
  }).join(" ");
  const labelIndexes = new Set([0, Math.floor((trend.length - 1) / 3), Math.floor(2 * (trend.length - 1) / 3), trend.length - 1]);
  return (
    <div className="reportsTrendChart">
      {trend.length ? (
        <>
          <svg viewBox="0 0 400 160" role="img" aria-label={`${category} records trend, grouped by ${grouping}`}>
            {[26, 64, 103, 142].map((y) => <line key={y} x1="12" x2="388" y1={y} y2={y} className="reportsChartGridLine" />)}
            {trend.length > 1 ? <polyline points={points} className="reportsTrendLine" /> : null}
            {trend.map((entry, index) => {
              const x = trend.length === 1 ? 200 : 16 + (index / (trend.length - 1)) * 368;
              const y = 142 - (entry.value / maxValue) * 116;
              return <circle key={entry.key} cx={x} cy={y} r={trend.length > 90 ? 1.7 : 3.2} className="reportsTrendPoint" />;
            })}
          </svg>
          <div className="reportsTrendLabels">
            {trend.map((entry, index) => labelIndexes.has(index)
              ? <span key={entry.key}>{entry.label}</span>
              : null)}
          </div>
        </>
      ) : <p className="reportsChartEmpty">No dated records in this range.</p>}
    </div>
  );
}

function StatusChart({ entries }) {
  const total = entries.reduce((sum, entry) => sum + entry.value, 0);
  const circumference = 2 * Math.PI * 43;
  const segments = entries.reduce((result, entry, index) => {
    const length = total ? (entry.value / total) * circumference : 0;
    const previous = result[index - 1];
    return [...result, {
      entry,
      index,
      length,
      offset: previous ? previous.offset + previous.length : 0,
    }];
  }, []);

  return (
    <div className="reportsStatusChart">
      <div className="reportsDonutWrap">
        <svg viewBox="0 0 120 120" role="img" aria-label={`Status distribution, ${total} records`}>
          <circle cx="60" cy="60" r="43" className="reportsDonutTrack" />
          {segments.map(({ entry, index, length, offset }) => (
              <circle
                key={entry.label}
                cx="60"
                cy="60"
                r="43"
                fill="none"
                stroke={CHART_COLORS[index % CHART_COLORS.length]}
                strokeWidth="13"
                strokeDasharray={`${length} ${circumference - length}`}
                strokeDashoffset={-offset}
                transform="rotate(-90 60 60)"
              />
          ))}
          <text x="60" y="58" className="reportsDonutTotal">{total}</text>
          <text x="60" y="74" className="reportsDonutCaption">records</text>
        </svg>
      </div>
      {entries.length ? (
        <ul className="reportsDonutLegend">
          {entries.map((entry, index) => (
            <li key={entry.label}>
              <span className="reportsLegendDot" style={{ backgroundColor: CHART_COLORS[index % CHART_COLORS.length] }} />
              <span className="reportsLegendLabel" title={entry.label}>{entry.label}</span>
              <strong>{entry.value}</strong>
            </li>
          ))}
        </ul>
      ) : <p className="reportsChartEmpty">No records to summarize.</p>}
    </div>
  );
}

export default function Reports() {
  const [filters, setFilters] = useState(getInitialFilters);
  const [generated, setGenerated] = useState(null);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState(DEFAULT_SORT.Appointments);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const requestId = useRef(0);

  const filteredRows = useMemo(() => {
    if (!generated) return [];
    const term = search.trim().toLocaleLowerCase();
    const matchesSearch = generated.report.rows.filter((row) =>
      !term || Object.values(row).some((value) =>
        String(value ?? "").toLocaleLowerCase().includes(term)
      )
    );
    const sortColumn = generated.report.columns.find(
      (column) => (column.sortKey || column.key) === sort.key
    ) || generated.report.columns[0];
    return [...matchesSearch].sort((left, right) => {
      const a = getSortValue(left, sortColumn);
      const b = getSortValue(right, sortColumn);
      const comparison = typeof a === "number" && typeof b === "number"
        ? a - b
        : String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
      return sort.direction === "asc" ? comparison : -comparison;
    });
  }, [generated, search, sort]);

  async function generateReport(category = filters.category) {
    const { startDate, endDate } = filters;
    if (!REPORT_CATEGORIES.includes(category)) {
      setLoadError("Select a valid report category.");
      return;
    }
    if (!startDate || !endDate || startDate > endDate) {
      setLoadError("Choose a valid date range. The start date must be on or before the end date.");
      return;
    }

    const currentRequest = ++requestId.current;
    setLoading(true);
    setLoadError("");
    setGenerated(null);
    try {
      const entries = await Promise.all(COLLECTIONS_BY_CATEGORY[category].map(async (name) => {
        try {
          const snapshot = await getDocs(collection(db, name));
          return [name, snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() }))];
        } catch (error) {
          const collectionError = new Error(`Could not load "${name}".`, { cause: error });
          collectionError.reportCollection = name;
          throw collectionError;
        }
      }));
      if (currentRequest !== requestId.current) return;
      const data = Object.fromEntries(entries);
      const range = { start: startDate, end: endDate };
      const report = buildReportData(category, data, range);
      const charts = buildChartData(category, data, report, range);
      setGenerated({ category, range, data, report, charts, generatedOn: getManilaToday() });
      setFilters((current) => ({ ...current, category }));
      setSearch("");
      setSort(DEFAULT_SORT[category]);
      setPage(1);
    } catch (error) {
      if (currentRequest !== requestId.current) return;
      console.error(`Reports could not load "${error.reportCollection || "clinic"}" data:`, error);
      setGenerated(null);
      setLoadError(
        `${error.reportCollection || "Report"} data could not be loaded. Check your access and try again.`
      );
    } finally {
      if (currentRequest === requestId.current) setLoading(false);
    }
  }

  function updateFilter(key, value) {
    setFilters((current) => ({ ...current, [key]: value }));
    if (key === "category") {
      setSort(DEFAULT_SORT[value]);
      setPage(1);
    }
  }

  function selectCategory(category) {
    setFilters((current) => ({ ...current, category }));
    setSort(DEFAULT_SORT[category]);
    setPage(1);
    setSearch("");
    generateReport(category);
  }

  function exportExcel() {
    if (!generated) return;
    const { category, range, report, generatedOn } = generated;
    const worksheetRows = [
      ["TopDent Dental Clinic System"],
      [`${category} Report`],
      ["Reporting Period", formatReportPeriod(range)],
      ["Generated", formatReportDate(generatedOn)],
      [],
      ["Summary"],
      ["Metric", "Value"],
      ...report.cards.map((card) => [card.label, formatCardValue(card)]),
      [],
      report.columns.map((column) => column.label),
      ...exportTableRows(filteredRows, report.columns),
    ];
    const worksheet = xlsxUtils.aoa_to_sheet(worksheetRows);
    worksheet["!cols"] = report.columns.map((column) => ({
      wch: Math.max(14, Math.min(30, column.label.length + 4)),
    }));
    const workbook = xlsxUtils.book_new();
    xlsxUtils.book_append_sheet(workbook, worksheet, category.slice(0, 31));
    writeExcelFile(workbook, exportFileName(category, range, "xlsx"));
  }

  function exportPdf() {
    if (!generated) return;
    const { category, range, report, generatedOn } = generated;
    const doc = new jsPDF({
      orientation: report.columns.length > 6 ? "landscape" : "portrait",
      unit: "pt",
      format: "a4",
    });
    const pageWidth = doc.internal.pageSize.getWidth();
    doc.setFont("helvetica", "bold");
    doc.setFontSize(18);
    doc.text("TopDent Dental Clinic System", 38, 38);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(12);
    doc.text(`${category} Report`, 38, 58);
    doc.setFontSize(9);
    doc.setTextColor(95, 102, 110);
    doc.text(`Reporting period: ${formatReportPeriod(range)}`, 38, 75);
    doc.text(`Generated: ${formatReportDate(generatedOn)}`, pageWidth - 38, 75, { align: "right" });

    autoTable(doc, {
      startY: 88,
      head: [["Summary", "Value"]],
      body: report.cards.map((card) => [card.label, formatCardValue(card)]),
      theme: "grid",
      styles: { fontSize: 8, cellPadding: 5, textColor: [35, 40, 45], lineColor: [225, 228, 231] },
      headStyles: { fillColor: [255, 201, 77], textColor: [36, 39, 31] },
      margin: { left: 38, right: 38 },
      tableWidth: "wrap",
    });
    autoTable(doc, {
      startY: (doc.lastAutoTable?.finalY || 120) + 18,
      head: [report.columns.map((column) => column.label)],
      body: exportTableRows(filteredRows, report.columns),
      theme: "grid",
      styles: { fontSize: 7, cellPadding: 4, overflow: "linebreak", textColor: [35, 40, 45], lineColor: [225, 228, 231] },
      headStyles: { fillColor: [255, 201, 77], textColor: [36, 39, 31], fontSize: 7 },
      alternateRowStyles: { fillColor: [250, 249, 246] },
      margin: { left: 28, right: 28, top: 28, bottom: 34 },
      didDrawPage: () => {
        const currentPage = doc.internal.getCurrentPageInfo().pageNumber;
        doc.setFontSize(8);
        doc.setTextColor(115, 120, 126);
        doc.text(`Page ${currentPage}`, pageWidth - 38, doc.internal.pageSize.getHeight() - 16, { align: "right" });
      },
    });
    doc.save(exportFileName(category, range, "pdf"));
  }

  function handleExportChange(event) {
    const format = event.target.value;
    event.target.value = "";
    if (format === "pdf") exportPdf();
    if (format === "excel") exportExcel();
  }

  const report = generated?.report;
  const category = generated?.category || filters.category;
  const canExport = Boolean(generated) && !loading;

  return (
    <main className="container adminSurface reportsPage">
      <header className="reportsHeader">
        <div>
          <span className="reportsEyebrow">ADMIN</span>
          <h1>Reports</h1>
          <p>Generate and analyze clinic records.</p>
        </div>
      </header>

      <section className="reportsFilterPanel" aria-label="Report filters">
        <label className="reportsPeriodSelect">
          <span>Report type</span>
          <select value={filters.category} onChange={(event) => updateFilter("category", event.target.value)}>
            {REPORT_CATEGORIES.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </label>
        <label className="reportsDateField">
          <span>Start date</span>
          <input
            type="date"
            value={filters.startDate}
            max={filters.endDate || undefined}
            onChange={(event) => updateFilter("startDate", event.target.value)}
          />
        </label>
        <label className="reportsDateField">
          <span>End date</span>
          <input
            type="date"
            value={filters.endDate}
            min={filters.startDate || undefined}
            onChange={(event) => updateFilter("endDate", event.target.value)}
          />
        </label>
        <button
          type="button"
          className="reportsExportButton reportsExportPrimary reportsGenerateButton"
          onClick={() => generateReport()}
          disabled={loading}
        >
          {loading ? <LoadingIndicator>Generating…</LoadingIndicator> : "Generate Report"}
        </button>
        <label className="reportsExportSelect">
          <span className="reportsVisuallyHidden">Export report</span>
          <select aria-label="Export report" onChange={handleExportChange} disabled={!canExport} defaultValue="">
            <option value="" disabled>Export</option>
            <option value="pdf">Export PDF</option>
            <option value="excel">Export Excel</option>
          </select>
        </label>
      </section>

      {loadError ? <div className="reportsError" role="alert">{loadError}</div> : null}
      {loading ? (
        <div className="reportsLoading" role="status" aria-live="polite">
          <span className="reportsLoadingMark" />
          Retrieving {filters.category.toLowerCase()} records from Firestore…
        </div>
      ) : null}

      {!generated && !loading && !loadError ? (
        <section className="reportsFirstRun panel">
          <span className="reportsFirstRunIcon" aria-hidden="true">↗</span>
          <div>
            <strong>Your clinic report is ready to generate</strong>
            <p>Select a report type and date range, then generate to view the latest records.</p>
          </div>
        </section>
      ) : null}

      {generated && report ? (
        <>
          <section className="reportsSummaryGrid" aria-label={`${category} report summary`}>
            {report.cards.map((card, index) => (
              <article className="reportsSummaryCard" key={card.label}>
                <span className={`reportsSummaryIcon reportsSummaryIcon-${index % 4}`} aria-hidden="true">
                  {["↗", "◷", "✓", "＋"][index % 4]}
                </span>
                <span className="reportsCardLabel">{card.label}</span>
                <strong className={typeof card.value === "string" && card.value.length > 22 ? "reportsCardLongValue" : ""}>
                  {formatCardValue(card)}
                </strong>
              </article>
            ))}
          </section>

          <section className="reportsChartsGrid" aria-label="Report charts">
            <article className="reportsChartPanel panel">
              <div className="reportsPanelHeader">
                <div>
                  <span className="reportsEyebrow">ACTIVITY</span>
                  <h2>Trends Overview</h2>
                </div>
                <span className="reportsChartNote">Grouped by {generated.charts.grouping}</span>
              </div>
              <TrendsChart
                trend={generated.charts.trend}
                category={category}
                grouping={generated.charts.grouping}
              />
            </article>
            <article className="reportsChartPanel panel">
              <div className="reportsPanelHeader">
                <div>
                  <span className="reportsEyebrow">BREAKDOWN</span>
                  <h2>Status Distribution</h2>
                </div>
              </div>
              <StatusChart entries={generated.charts.distribution} />
            </article>
          </section>

          <nav className="reportsCategoryTabs" aria-label="Report categories">
            {REPORT_CATEGORIES.map((item) => (
              <button
                key={item}
                type="button"
                className={`reportsCategoryTab${item === category ? " active" : ""}`}
                aria-pressed={item === category}
                onClick={() => selectCategory(item)}
                disabled={loading}
              >
                {item} Reports
              </button>
            ))}
          </nav>

          <section className="reportsRecordsPanel panel" aria-labelledby="reports-records-title">
            <div className="reportsPanelHeader reportsRecordsHeader">
              <div>
                <span className="reportsEyebrow">{category.toUpperCase()} RECORDS</span>
                <h2 id="reports-records-title">{category} Details</h2>
                <p className="reportsRecordCount">
                  {filteredRows.length} matching {filteredRows.length === 1 ? "record" : "records"}
                  {" · "}{formatReportPeriod(generated.range)}
                </p>
              </div>
              <label className="reportsSearch">
                <span className="reportsSearchIcon" aria-hidden="true">⌕</span>
                <input
                  type="search"
                  value={search}
                  onChange={(event) => {
                    setSearch(event.target.value);
                    setPage(1);
                  }}
                  placeholder={`Search ${category.toLowerCase()} records`}
                  aria-label={`Search ${category.toLowerCase()} records`}
                />
              </label>
            </div>
            {filteredRows.length ? (
              <ReportsTable
                columns={report.columns}
                rows={filteredRows}
                page={page}
                setPage={setPage}
                sort={sort}
                setSort={setSort}
              />
            ) : (
              <EmptyState
                compact
                title={report.rows.length ? "No matching records" : `No ${category.toLowerCase()} found`}
                message={report.rows.length
                  ? "Try a different search term."
                  : `There are no ${category.toLowerCase()} records for ${formatReportPeriod(generated.range)}.`}
              />
            )}
          </section>
        </>
      ) : null}
    </main>
  );
}
