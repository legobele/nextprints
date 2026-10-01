// "My orders" — signed-in user sees their own orders + live status.

import { onAuthStateChanged } from "firebase/auth";
import { collection, getDocs, query, where } from "firebase/firestore";
import { auth, db } from "./firebase.js";
import { BRAND_NAME } from "./config.js";
import { renderNav, escapeHtml, fmtMoney, toDate, fmtDate } from "./ui.js";

renderNav("orders");
document.title = `My orders · ${BRAND_NAME}`;

const STATUS_HINT = {
  pending: "Received — waiting for confirmation.",
  confirmed: "Confirmed — your item is in the print queue.",
  printing: "Printing — your item is being produced.",
  ready: "Ready for pickup or delivery. Please bring cash.",
  delivered: "Delivered.",
  cancelled: "Cancelled.",
};

// Order placed → Confirmed → Printing → Ready for pickup → Delivered
const TRACK_STEPS = [
  ["pending", "Order placed"],
  ["confirmed", "Confirmed"],
  ["printing", "Printing"],
  ["ready", "Ready for pickup"],
  ["delivered", "Delivered"],
];

function trackerHTML(status) {
  if (status === "cancelled") {
    return `<div class="error-box">This order was cancelled.</div>`;
  }
  const idx = TRACK_STEPS.findIndex(([s]) => s === status);
  const cur = idx === -1 ? 0 : idx;
  return `
    <div class="stepper" aria-label="Order status">
      ${TRACK_STEPS.map(([s, label], i) => `
        <div class="stepper-step${i < cur ? " done" : ""}${i === cur ? " current" : ""}">
          <span class="stepper-dot"></span>
          <span class="stepper-label">${label}</span>
        </div>`).join("")}
    </div>`;
}

function trunc(s, n = 120) {
  s = String(s || "");
  return s.length > n ? s.slice(0, n).trimEnd() + "…" : s;
}

function itemHTML(i) {
  return `
    <div class="tracker-item">
      <div><strong>${i.qty} × ${escapeHtml(i.name)}</strong>${i.batchNumber ? `<span class="batch-tag">Batch #${escapeHtml(i.batchNumber)}</span>` : ""}</div>
      ${i.description ? `<p class="desc clamp-2">${escapeHtml(trunc(i.description))}</p>` : ""}
    </div>`;
}

onAuthStateChanged(auth, async (user) => {
  const loading = document.getElementById("loading");
  const list = document.getElementById("list");
  if (!user) {
    loading.hidden = true;
    list.innerHTML = `<div class="empty">Sign in to see your orders.<br><br><a class="btn" href="account.html">Sign in</a></div>`;
    return;
  }
  try {
    // No orderBy — sorted client-side so no composite index is needed.
    const snap = await getDocs(query(collection(db, "orders"), where("userId", "==", user.uid)));
    const orders = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (toDate(b.createdAt)?.getTime() || 0) - (toDate(a.createdAt)?.getTime() || 0);
    loading.hidden = true;
    if (!orders.length) {
      list.innerHTML = `<div class="empty">No orders yet.<br><br><a class="btn" href="index.html">Start shopping</a></div>`;
      return;
    }
    list.innerHTML = orders.map((o) => `
      <div class="order-card">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
          <strong>Order ${escapeHtml(o.id.slice(0, 8))}…</strong>
          <span class="status-pill ${escapeHtml(o.status)}">${escapeHtml(o.status)}</span>
        </div>
        <p style="color:var(--muted);font-size:0.88rem;margin:6px 0">
          ${fmtDate(o.createdAt)} · ${escapeHtml(o.name || "")} · ${escapeHtml(o.homeroom || "")}${o.grade ? ` · Grade ${escapeHtml(o.grade)}` : ""}
        </p>
        ${trackerHTML(o.status)}
        <p style="font-size:0.92rem">${STATUS_HINT[o.status] || ""}</p>
        <div>${(o.items || []).map(itemHTML).join("")}</div>
        <div class="totals" style="margin:10px 0 0">
          <div class="row"><span>Subtotal</span><span>${fmtMoney(o.subtotal)}</span></div>
          ${o.discount ? `<div class="row"><span>Discount${o.promoCode ? ` (${escapeHtml(o.promoCode)})` : ""}</span><span>−${fmtMoney(o.discount)}</span></div>` : ""}
          <div class="row grand"><span>Total (cash)</span><span>${fmtMoney(o.total)}</span></div>
        </div>
      </div>`).join("");
  } catch (err) {
    console.error(err);
    loading.textContent = "Couldn't load orders. Check your Firebase config (see README.md).";
  }
});
