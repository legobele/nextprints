// "My orders" — signed-in user sees their own orders + live status.
//
// Status workflow: Ordered > Queued (Batch X) > Printing > Ready for
// delivery > Delivering (window) > Delivered. A failed print shows a
// reprint sub-step. Legacy "pending"/"confirmed" render as "ordered".

import { onAuthStateChanged } from "firebase/auth";
import { collection, getDocs, query, where } from "firebase/firestore";
import { auth, db } from "./firebase.js";
import { BRAND_NAME } from "./config.js";
import {
  renderNav, escapeHtml, fmtMoney, toDate, fmtDate,
  canonStatus, statusLabel, fmtBatch, fmtDeliveryWindow, fmtETA,
} from "./ui.js";
import { fetchPickupMap, openPickupModal } from "./pickup.js";

renderNav("orders");
document.title = `My orders · ${BRAND_NAME}`;

let currentUser = null;
let pickupMap = {};

const TRACK_STEPS = [
  ["ordered", "Ordered"],
  ["queued", "Queued"],
  ["printing", "Printing"],
  ["ready_for_delivery", "Ready for delivery"],
  ["delivering", "Delivering"],
  ["delivered", "Delivered"],
];

function stepIndex(status) {
  // reprint_queued sits at the Printing stage (with its own note).
  const s = status === "reprint_queued" ? "printing" : status;
  const i = TRACK_STEPS.findIndex(([v]) => v === s);
  return i === -1 ? 0 : i;
}

function reprintBatch(o) {
  const h = o.reprintHistory || [];
  return h.length ? h[h.length - 1].batch : o.statusBatch;
}

function trackerHTML(o) {
  const status = canonStatus(o.status);
  if (status === "cancelled") {
    return `<div class="error-box">This order was cancelled.</div>`;
  }
  const cur = stepIndex(status);
  const steps = [];
  TRACK_STEPS.forEach(([v, label], i) => {
    let text = label;
    if (v === "queued" && o.statusBatch) text = `Queued (${fmtBatch(o.statusBatch)})`;
    steps.push({ key: v, label: text, i });
    // Reprint sub-step between Printing and Ready for delivery.
    if (v === "printing" && (o.reprintHistory || []).length) {
      const rb = fmtBatch(reprintBatch(o));
      steps.push({ key: "reprint", label: rb ? `Reprinting — ${rb}` : "Reprinting", i: i + 0.5, note: true });
    }
  });
  return `
    <div class="stepper" aria-label="Order status">
      ${steps.map((s) => {
        let cls = "";
        if (s.note) {
          // Reprint sub-step: current while reprinting, done afterwards.
          cls = status === "reprint_queued" ? " current" : (cur > 2 ? " done" : "");
        } else {
          const isReprint = status === "reprint_queued";
          const done = s.i < cur || (isReprint && s.i <= 2);
          const current = s.i === cur && !(isReprint && s.i === 2);
          cls = (done ? " done" : "") + (current ? " current" : "");
        }
        return `
        <div class="stepper-step${cls}${s.note ? " reprint-step" : ""}">
          <span class="stepper-dot"></span>
          <span class="stepper-label">${escapeHtml(s.label)}</span>
        </div>`;
      }).join("")}
    </div>`;
}

function statusHint(o) {
  const status = canonStatus(o.status);
  switch (status) {
    case "ordered": return "Order received.";
    case "queued": return o.statusBatch ? `Queued for production — ${fmtBatch(o.statusBatch)}.` : "Queued for production.";
    case "printing": return "Printing — your item is being produced.";
    case "ready_for_delivery": return "Ready for delivery.";
    case "reprint_queued": {
      const rb = fmtBatch(reprintBatch(o));
      return rb ? `Print failed — printing again on ${rb}.` : "Print failed — printing again.";
    }
    case "delivering": {
      const w = fmtDeliveryWindow(o.deliveryWindow);
      return w ? `Delivering ${w}.` : "Out for delivery.";
    }
    case "delivered": return "Delivered.";
    case "cancelled": return "Cancelled.";
    default: return "";
  }
}

// Customer-visible ETA, auto-calculated from Giulia's status updates and
// floored at 2 days out (unless she toggled the order to allow earlier).
// Not shown while delivering (the scheduled window is shown instead).
function etaLineHTML(o) {
  const status = canonStatus(o.status);
  if (status === "delivering" || status === "delivered" || status === "cancelled") return "";
  const eta = fmtETA(o);
  if (!eta) return "";
  return `<p style="font-size:0.92rem;color:var(--muted)">Estimated delivery: <strong style="color:var(--text)">${escapeHtml(eta)}</strong></p>`;
}

function trunc(s, n = 120) {
  s = String(s || "");
  return s.length > n ? s.slice(0, n).trimEnd() + "…" : s;
}

function itemHTML(i) {
  return `
    <div class="tracker-item">
      <div><strong>${i.qty} × ${escapeHtml(i.name)}</strong></div>
      ${i.variantLabel ? `<div style="color:var(--muted);font-size:0.85rem">${escapeHtml(i.variantLabel)}</div>` : ""}
      ${i.description ? `<p class="desc clamp-2">${escapeHtml(trunc(i.description))}</p>` : ""}
    </div>`;
}

function pickupRowHTML(o) {
  const loc = pickupMap[o.id];
  return `
    <div class="pickup-row" data-pickup-row="${o.id}">
      ${loc
        ? `Pickup location: <strong>${escapeHtml(loc)}</strong> <button type="button" class="btn small ghost" data-pickup-edit="${o.id}">Change</button>`
        : `<button type="button" class="btn small" data-pickup-edit="${o.id}">Add pickup location</button>`}
    </div>`;
}

// Called by the pickup modal after saving, so the tracker updates in place.
window.refreshPickupDisplay = (orderId, loc) => {
  const row = document.querySelector(`[data-pickup-row="${orderId}"]`);
  if (row) {
    pickupMap[orderId] = loc;
    row.innerHTML = `Pickup location: <strong>${escapeHtml(loc)}</strong> <button type="button" class="btn small ghost" data-pickup-edit="${orderId}">Change</button>`;
    wirePickupButtons(row);
  }
};

function wirePickupButtons(scope) {
  scope.querySelectorAll("[data-pickup-edit]").forEach((b) =>
    b.addEventListener("click", () => {
      if (currentUser) openPickupModal(currentUser, b.dataset.pickupEdit, pickupMap[b.dataset.pickupEdit] || "");
    }));
}

onAuthStateChanged(auth, async (user) => {
  const loading = document.getElementById("loading");
  const list = document.getElementById("list");
  if (!user) {
    loading.hidden = true;
    list.innerHTML = `<div class="empty">Sign in to see your orders.<br><br><a class="btn" href="account.html">Sign in</a></div>`;
    return;
  }
  currentUser = user;
  try {
    // No orderBy — sorted client-side so no composite index is needed.
    const [ordersSnap, pkMap] = await Promise.all([
      getDocs(query(collection(db, "orders"), where("userId", "==", user.uid))),
      fetchPickupMap(user),
    ]);
    pickupMap = pkMap;
    const orders = ordersSnap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (toDate(b.createdAt)?.getTime() || 0) - (toDate(a.createdAt)?.getTime() || 0));
    loading.hidden = true;
    if (!orders.length) {
      list.innerHTML = `<div class="empty">No orders yet.<br><br><a class="btn" href="index.html">Start shopping</a></div>`;
      return;
    }
    list.innerHTML = orders.map((o) => {
      const canon = canonStatus(o.status);
      return `
      <div class="order-card">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
          <strong>Order ${escapeHtml(o.id.slice(0, 8))}…</strong>
          <span style="display:flex;gap:6px;align-items:center">
            ${o.priority ? `<span class="priority-flag">Priority delivery</span>` : ""}
            <span class="status-pill ${escapeHtml(canon)}">${escapeHtml(statusLabel(o))}</span>
          </span>
        </div>
        <p style="color:var(--muted);font-size:0.88rem;margin:6px 0">
          ${fmtDate(o.createdAt)} · ${escapeHtml(o.name || "")}${o.grade ? ` · Grade ${escapeHtml(o.grade)}` : ""}
        </p>
        ${trackerHTML(o)}
        <p style="font-size:0.92rem">${escapeHtml(statusHint(o))}</p>
        ${etaLineHTML(o)}
        ${canon === "delivering" ? pickupRowHTML(o) : ""}
        <div>${(o.items || []).map(itemHTML).join("")}</div>
        <div class="totals" style="margin:10px 0 0">
          <div class="row"><span>Subtotal</span><span>${fmtMoney(o.subtotal)}</span></div>
          ${o.discount ? `<div class="row"><span>Discount${o.promoCode ? ` (${escapeHtml(o.promoCode)})` : ""}</span><span>−${fmtMoney(o.discount)}</span></div>` : ""}
          ${o.priorityFee ? `<div class="row"><span>Priority delivery</span><span>+${fmtMoney(o.priorityFee)}</span></div>` : ""}
          <div class="row grand"><span>Total (cash)</span><span>${fmtMoney(o.total)}</span></div>
        </div>
      </div>`;
    }).join("");
    wirePickupButtons(list);
  } catch (err) {
    console.error(err);
    loading.textContent = "Couldn't load orders. Check your Firebase config (see README.md).";
  }
});
