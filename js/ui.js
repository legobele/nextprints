// Shared UI helpers: nav, toasts, countdowns, formatting, SVG placeholders.

import { onAuthStateChanged } from "firebase/auth";
import { auth, FIREBASE_CONFIGURED } from "./firebase.js";
import { BRAND_NAME, ADMIN_EMAIL, CURRENCY, FIRST_DELIVERY_DATE, MAINTENANCE_MODE } from "./config.js";
import { cartCount } from "./store.js";
import { maybePromptReview } from "./reviews.js";

// Maintenance gate: when MAINTENANCE_MODE is on, every storefront page
// becomes a maintenance notice. The admin console is exempt so the shop
// can be managed during the window. Throwing here stops the importing
// page module, so no shop code runs.
if (MAINTENANCE_MODE && !location.pathname.includes("nxp-ops-7q2")) {
  document.title = `Under maintenance · ${BRAND_NAME}`;
  document.body.innerHTML = `
    <div class="maintenance">
      <div class="maintenance-card">
        <div class="maintenance-brand">${escapeHtml(BRAND_NAME)}</div>
        <h1>Under maintenance</h1>
        <p>We&rsquo;re upgrading our systems to serve you better. The shop will be back shortly &mdash; thank you for your patience.</p>
      </div>
    </div>`;
  throw new Error("maintenance mode: storefront disabled");
}
import { maybePromptPickup } from "./pickup.js";

export function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

export function fmtMoney(n) {
  return `${CURRENCY}${Number(n || 0).toFixed(2)}`;
}

// Firestore Timestamps, Dates, and ISO strings all → Date (or null).
export function toDate(v) {
  if (!v) return null;
  if (typeof v.toDate === "function") return v.toDate();
  if (v instanceof Date) return v;
  const d = new Date(v);
  return isNaN(d) ? null : d;
}

// Storefront visibility: hidden when deactivated, or when the preorder
// hasn't started yet (scheduled products appear automatically at start).
export function isProductVisible(p) {
  if (!p || p.active === false) return false;
  const start = toDate(p.preorderStartAt);
  if (start && start.getTime() > Date.now()) return false;
  return true;
}

export function fmtDate(d) {
  const dt = toDate(d);
  return dt ? dt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—";
}

// Estimated delivery for a product lead time: today + leadTimeDays,
// e.g. "October 7, 2026". Computed at render time, never stored.
export function fmtEstimatedDelivery(leadTimeDays) {
  const days = Number(leadTimeDays);
  if (!Number.isFinite(days) || days < 0) return null;
  const dt = new Date();
  dt.setDate(dt.getDate() + Math.round(days));
  return dt.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

// ---- Delivery windows: fixed school-day slots for the auto-queue ----
export const DELIVERY_WINDOWS = [
  { start: "07:00", end: "07:40" },
  { start: "09:40", end: "09:50" },
  { start: "12:40", end: "13:05" },
];

function ymd(d) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function isSchoolDay(d) {
  const g = d.getDay();
  return g !== 0 && g !== 6;
}

// Next upcoming delivery window (skips weekends; never before the first
// delivery date). { date, startTime, endTime }.
export function nextDeliveryWindow(from = new Date()) {
  const fdd = firstDeliveryDate();
  const effFrom = fdd && from < fdd ? fdd : from;
  const d = new Date(effFrom);
  for (let i = 0; i < 14; i++) {
    if (isSchoolDay(d)) {
      for (const w of DELIVERY_WINDOWS) {
        const [h, m] = w.start.split(":").map(Number);
        const start = new Date(d);
        start.setHours(h, m, 0, 0);
        if (start > effFrom) return { date: ymd(d), startTime: w.start, endTime: w.end };
      }
    }
    d.setDate(d.getDate() + 1);
    d.setHours(0, 0, 0, 0);
  }
  return null;
}

// End time for a window start ("07:00" -> "07:40"); falls back to +60 min.
export function windowEndFor(startTime) {
  const w = DELIVERY_WINDOWS.find((x) => x.start === startTime);
  return w ? w.end : null;
}

// Priority orders run their own ticker: the earliest slot in the priority
// lane — the assigned window once queued, otherwise the earliest upcoming
// window already held by a priority order, else the next upcoming window.
// The lane division is invisible to customers; only admin sees both lanes.
export function priorityDeliveryWindow(o, orderList = []) {
  if (o?.deliveryWindow?.date && o.deliveryWindow.startTime) return o.deliveryWindow;
  const q = priorityQueueWindows(orderList);
  if (q.length) return q[0];
  return nextDeliveryWindow();
}

// Minutes before a window's end when its still-queued orders start rolling
// to the next slot.
export const ROLLOVER_LEAD_MIN = 3;

// End of a delivery window as a Date (fixed windows use their real end;
// custom times default to start + 60 min, matching the render).
export function windowEndDate(w) {
  if (!w?.date || !w.startTime) return null;
  const end = windowEndFor(w.startTime);
  const d = new Date(w.date + "T12:00:00");
  if (end) {
    const [eh, em] = end.split(":").map(Number);
    d.setHours(eh, em, 0, 0);
  } else {
    const [sh, sm] = String(w.startTime).split(":").map(Number);
    d.setHours(sh, sm + 60, 0, 0);
  }
  return d;
}

// Ready orders whose window is ending (or ended) — they roll to the next
// slot. Delivering orders are in Giulia's hands and never auto-move.
export function rolloverOrders(orderList = [], now = new Date()) {
  const out = [];
  for (const o of orderList || []) {
    if (canonStatus(o?.status) !== "ready_for_delivery") continue;
    const endDt = windowEndDate(o.deliveryWindow);
    if (!endDt) continue;
    if ((endDt - now) / 60000 <= ROLLOVER_LEAD_MIN) out.push(o);
  }
  return out;
}

// Assigned windows of a delivery-queue lane, earliest first, skipping
// windows that already ended. lane: true = priority only, false = regular
// only, null = every order. The lane division is invisible to customers.
export function queueWindows(orderList = [], lane = null) {
  const now = new Date();
  const seen = new Map();
  for (const o of orderList || []) {
    if (lane === true && !o?.priority) continue;
    if (lane === false && o?.priority) continue;
    const s = canonStatus(o.status);
    if (s !== "ready_for_delivery" && s !== "delivering") continue;
    const w = o.deliveryWindow;
    if (!w?.date || !w.startTime) continue;
    if (windowEndDate(w) <= now) continue;
    const key = `${w.date}|${w.startTime}`;
    if (!seen.has(key)) seen.set(key, { date: w.date, startTime: w.startTime, endTime: w.endTime || windowEndFor(w.startTime) });
  }
  return [...seen.keys()].sort().map((k) => seen.get(k));
}

// Assigned windows of the priority lane, earliest first.
export function priorityQueueWindows(orderList = []) {
  return queueWindows(orderList, true);
}

// Where a missed delivery goes: the middle of its own lane's line — not
// the front, not the back. Falls back to the next upcoming window.
export function rescheduleWindow(o, orderList = []) {
  const others = (orderList || []).filter((x) => x?.id !== o?.id);
  const wins = queueWindows(others, o?.priority ? true : false);
  if (wins.length) return wins[Math.floor(wins.length / 2)];
  return nextDeliveryWindow();
}

// ---- Order ETA: auto-calculated from Giulia's status updates ----
// Days remaining until delivery once she sets each status. `null` means
// "fall back to the longest product lead time snapshotted on the order".
// Tweak the numbers any time — the customer view updates instantly.
export const ETA_FLOOR_DAYS = 2;
export const STATUS_ETA_DAYS = {
  ordered: null,
  queued: null,
  printing: 3,
  ready_for_delivery: 2,
  reprint_queued: 5,
};

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

// First delivery date as a local-midnight Date, or null if unconfigured.
function firstDeliveryDate() {
  const m = String(FIRST_DELIVERY_DATE || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

// Clamp an auto-calculated ETA: never before the first delivery date.
function finishETA(d) {
  const fdd = firstDeliveryDate();
  if (fdd && startOfDay(d) < fdd) return fdd;
  return d;
}

// Returns a Date (customer-visible ETA) or null when no ETA applies:
// - delivering: the scheduled window date, exact — never floored.
// - priority: null — priority orders run their own window ticker
//   (priorityDeliveryWindow), not the day-count estimate.
// - otherwise: (last status update) + remaining days for that status.
// Floors (auto-calc only): never before tomorrow; regular orders also never
// under today + ETA_FLOOR_DAYS unless allowEarlyEta; nothing auto-calcs
// before FIRST_DELIVERY_DATE.
export function orderETA(o) {
  const status = canonStatus(o?.status);
  if (!o || status === "delivered" || status === "cancelled" || o.priority) return null;
  if (status === "delivering") {
    const w = o.deliveryWindow?.date ? new Date(o.deliveryWindow.date + "T12:00:00") : null;
    return w && !isNaN(w) ? w : null;
  }
  let days = STATUS_ETA_DAYS[status];
  if (days == null) {
    const leads = (o.items || [])
      .map((i) => Number(i.leadTimeDays))
      .filter((n) => Number.isFinite(n) && n >= 0);
    days = leads.length ? Math.max(...leads) : 7;
  }
  const base = toDate(o.updatedAt) || toDate(o.createdAt) || new Date();
  const eta = new Date(base);
  eta.setDate(eta.getDate() + Math.round(days));
  const hardFloor = startOfDay(new Date());
  hardFloor.setDate(hardFloor.getDate() + 1);
  if (startOfDay(eta) < hardFloor) return finishETA(hardFloor);
  if (!o.allowEarlyEta) {
    const floor = startOfDay(new Date());
    floor.setDate(floor.getDate() + ETA_FLOOR_DAYS);
    if (startOfDay(eta) < floor) return finishETA(floor);
  }
  return finishETA(eta);
}

// Should the $3 priority upgrade be offered for these product lead times?
// Hidden when it couldn't beat the floors — i.e. both the regular and the
// priority estimate would pin at their minimums, so the upgrade buys nothing.
export function priorityOfferedFor(leadTimes) {
  const leads = (leadTimes || []).map(Number).filter((n) => Number.isFinite(n) && n >= 0);
  return leads.length > 0 && Math.max(...leads) > ETA_FLOOR_DAYS;
}

export function fmtETA(o) {
  const eta = orderETA(o);
  return eta
    ? eta.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
    : null;
}

export function formatDuration(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m ${sec}s`;
  return `${m}m ${sec}s`;
}

// Ticks every [data-countdown-to="<epoch ms>"] element on the page.
export function startCountdowns() {
  const tick = () => {
    document.querySelectorAll("[data-countdown-to]").forEach((el) => {
      const diff = Number(el.dataset.countdownTo) - Date.now();
      el.textContent = diff <= 0 ? "ended" : formatDuration(diff);
    });
  };
  tick();
  setInterval(tick, 1000);
}

let toastTimer = null;
export function toast(msg, ms = 2600) {
  let el = document.getElementById("toast");
  if (!el) return;
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, ms);
}

export function updateCartBadge() {
  const badge = document.getElementById("cart-badge");
  if (!badge) return;
  const n = cartCount();
  badge.hidden = n === 0;
  badge.textContent = n;
}

// Abstract shifter-ish placeholder art (data URI) until real photos exist.
export function placeholderSVG(label, hueA = 270, hueB = 320) {
  const safe = String(label).replace(/[<>&"']/g, "");
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0" stop-color="hsl(${hueA},75%,55%)"/>` +
    `<stop offset="1" stop-color="hsl(${hueB},75%,30%)"/></linearGradient></defs>` +
    `<rect width="800" height="600" fill="url(#g)"/>` +
    `<g stroke="rgba(255,255,255,0.85)" stroke-width="14" fill="none" stroke-linecap="round">` +
    `<circle cx="400" cy="175" r="62" fill="rgba(255,255,255,0.92)" stroke="none"/>` +
    `<line x1="400" y1="237" x2="400" y2="425"/>` +
    `<rect x="300" y="425" width="200" height="55" rx="10" fill="rgba(255,255,255,0.22)" stroke="none"/>` +
    `<path d="M335 505 v65 M465 505 v65 M335 537 h130" stroke-width="10" opacity="0.7"/>` +
    `</g>` +
    `<text x="400" y="72" text-anchor="middle" font-family="system-ui,sans-serif" ` +
    `font-size="36" font-weight="700" fill="rgba(255,255,255,0.95)">${safe}</text>` +
    `</svg>`;
  return "data:image/svg+xml," + encodeURIComponent(svg);
}

// Renders the shared header into #site-nav. Call once per page.
export function renderNav(active = "") {
  const el = document.getElementById("site-nav");
  if (!el) return;
  el.innerHTML = `
    <header class="nav">
      <a class="brand" href="index.html">${escapeHtml(BRAND_NAME)}</a>
      <nav class="nav-links">
        <a href="index.html" class="${active === "shop" ? "active" : ""}">Shop</a>
        <a href="orders.html" class="${active === "orders" ? "active" : ""}">My orders</a>
        <a href="cart.html" class="${active === "cart" ? "active" : ""}">Cart <span class="cart-badge" id="cart-badge" hidden></span></a>
        <span id="nav-auth"><a href="account.html">Sign in</a></span>
      </nav>
    </header>
    <div class="config-banner" id="config-banner" hidden>
      Firebase is not configured yet — paste your keys into <code>js/firebase-config.js</code> (see README.md).
    </div>
    <div class="toast" id="toast" hidden></div>`;
  updateCartBadge();
  if (!FIREBASE_CONFIGURED) {
    const b = document.getElementById("config-banner");
    if (b) b.hidden = false;
  }
  onAuthStateChanged(auth, (user) => {
    const slot = document.getElementById("nav-auth");
    if (!slot) return;
    if (!user) {
      slot.innerHTML = `<a href="account.html" class="${active === "account" ? "active" : ""}">Sign in</a>`;
      return;
    }
    const isAdmin = user.email === ADMIN_EMAIL;
    slot.innerHTML =
      (isAdmin ? `<a href="nxp-ops-7q2.html" class="${active === "admin" ? "active" : ""}">Admin</a>` : "") +
      `<a href="account.html" class="${active === "account" ? "active" : ""}">${escapeHtml(user.email.split("@")[0])}</a>`;
    // In-app review prompt after delivery (never on the admin page).
    if (!location.pathname.includes("nxp-ops-7q2")) maybePromptReview(user);
    // In-app pickup-location prompt while an order is out for delivery.
    if (!location.pathname.includes("nxp-ops-7q2")) maybePromptPickup(user);
  });
}

/* ---------- order status (shared by shop + admin) ---------- */

// Legacy "pending"/"confirmed" orders render as "ordered".
export function canonStatus(s) {
  if (s === "pending" || s === "confirmed") return "ordered";
  return s || "ordered";
}

// Batch number renders exactly as typed — no zero-padding.
export function fmtBatch(batch) {
  const b = String(batch ?? "").trim();
  return b ? `Batch ${b}` : "";
}

// "14:00" -> "2:00 PM"
export function fmtTime12(hhmm) {
  const m = String(hhmm || "").match(/^(\d{1,2}):(\d{2})/);
  if (!m) return "";
  let h = Number(m[1]);
  const ap = h >= 12 ? "PM" : "AM";
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${m[2]} ${ap}`;
}

// { date: "2026-11-18", startTime: "9:00" } -> "Wednesday, Nov 18, 9:00–10:00 AM"
export function fmtDeliveryWindow(dw) {
  if (!dw || !dw.date || !dw.startTime) return "";
  const parts = String(dw.date).split("-").map(Number);
  if (parts.length < 3 || parts.some(isNaN)) return "";
  const dt = new Date(parts[0], parts[1] - 1, parts[2]);
  const weekday = new Intl.DateTimeFormat("en-US", { weekday: "long" }).format(dt);
  const month = new Intl.DateTimeFormat("en-US", { month: "short" }).format(dt);
  const sm = String(dw.startTime).match(/^(\d{1,2}):(\d{2})/);
  if (!sm) return `${weekday}, ${month} ${parts[2]}`;
  const startMin = Number(sm[1]) * 60 + Number(sm[2]);
  // Fixed windows carry their own end time; legacy windows default to +60 min.
  const em = String(dw.endTime || "").match(/^(\d{1,2}):(\d{2})/);
  const endMin = em ? Number(em[1]) * 60 + Number(em[2]) : startMin + 60;
  const pad = (n) => String(n).padStart(2, "0");
  const endStr = `${pad(Math.floor(endMin / 60) % 24)}:${pad(endMin % 60)}`;
  const start12 = fmtTime12(dw.startTime);
  const end12 = fmtTime12(endStr);
  // Collapse the AM/PM when both sides share it: "9:00–10:00 AM".
  const range = start12.slice(-2) === end12.slice(-2)
    ? `${start12.slice(0, -3)}–${end12}`
    : `${start12}–${end12}`;
  return `${weekday}, ${month} ${parts[2]}, ${range}`;
}

// Display label for an order's status pill.
export function statusLabel(o) {
  const s = canonStatus(o.status);
  switch (s) {
    case "queued": return o.statusBatch ? `Queued — ${fmtBatch(o.statusBatch)}` : "Queued";
    case "printing": return "Printing";
    case "ready_for_delivery": return "Ready for delivery";
    case "reprint_queued": return o.statusBatch ? `Reprinting — ${fmtBatch(o.statusBatch)}` : "Reprinting";
    case "delivering": return "Delivering";
    case "delivered": return "Delivered";
    case "cancelled": return "Cancelled";
    default: return "Ordered";
  }
}
