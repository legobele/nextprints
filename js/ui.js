// Shared UI helpers: nav, toasts, countdowns, formatting, SVG placeholders.

import { onAuthStateChanged } from "firebase/auth";
import { auth, FIREBASE_CONFIGURED } from "./firebase.js";
import { BRAND_NAME, ADMIN_EMAIL, CURRENCY } from "./config.js";
import { cartCount } from "./store.js";

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

export function fmtDate(d) {
  const dt = toDate(d);
  return dt ? dt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—";
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
  });
}
