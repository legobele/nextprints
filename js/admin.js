// Admin panel: products / deals / promo codes / orders CRUD.
// Visible only to ADMIN_EMAIL (checked here AND enforced by firestore.rules).

import { onAuthStateChanged } from "firebase/auth";
import {
  collection, doc, getDocs, getDoc, addDoc, setDoc, updateDoc, deleteDoc,
  arrayUnion, serverTimestamp,
} from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { auth, db, storage } from "./firebase.js";
import { BRAND_NAME, ADMIN_EMAIL } from "./config.js";
import { renderNav, escapeHtml, fmtMoney, fmtDate, toDate, toast, canonStatus, statusLabel, fmtBatch, fmtDeliveryWindow } from "./ui.js";
import { seedProducts } from "../seed/seed-products.js";

renderNav("admin");
document.title = `Admin · ${BRAND_NAME}`;

// [value, label] — order fulfillment workflow.
const ORDER_STATUSES = [
  ["ordered", "Ordered"],
  ["queued", "Queued"],
  ["printing", "Printing"],
  ["ready_for_delivery", "Ready for delivery"],
  ["reprint_queued", "Failed — reprint on new batch"],
  ["delivering", "Delivering"],
  ["delivered", "Delivered"],
  ["cancelled", "Cancelled"],
];

let products = [];
let deals = [];
let promos = [];
let orders = [];
let pickupMap = {}; // orderId -> pickupLocation (admin view)

/* ---------- small helpers ---------- */

function dtLocalToDate(v) {
  return v ? new Date(v) : null;
}
function dateToDtLocal(d) {
  d = toDate(d);
  if (!d) return "";
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
function numOrNull(v) {
  const s = String(v ?? "").trim();
  return s === "" ? null : Number(s);
}

/* ---------- boot ---------- */

onAuthStateChanged(auth, async (user) => {
  const gate = document.getElementById("gate");
  const panel = document.getElementById("admin-panel");
  if (!user || user.email !== ADMIN_EMAIL) {
    gate.hidden = false;
    panel.hidden = true;
    gate.innerHTML = `
      <div class="card"><div class="card-body" style="text-align:center;padding:32px 20px">
        <h2>Restricted</h2>
        <p>Sign in as <code class="inline">${escapeHtml(ADMIN_EMAIL)}</code> to manage the shop.</p>
        <a class="btn" href="account.html">Go to sign in</a>
      </div></div>`;
    return;
  }
  gate.hidden = true;
  panel.hidden = false;
  wireTabs();
  wireProducts();
  wireDeals();
  wirePromos();
  wireOrders();
  document.getElementById("seed-btn").addEventListener("click", onSeed);
  await refreshAll();
});

function wireTabs() {
  document.querySelectorAll(".tab").forEach((t) => {
    t.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((x) => x.classList.remove("active"));
      document.querySelectorAll(".tabpane").forEach((x) => x.classList.remove("active"));
      t.classList.add("active");
      document.getElementById("tab-" + t.dataset.tab).classList.add("active");
    });
  });
}

async function refreshAll() {
  await Promise.all([refreshProducts(), refreshDeals(), refreshPromos(), refreshOrders()]);
}

/* ---------- products ---------- */

let editingProductId = null;

function wireProducts() {
  document.getElementById("prod-new").addEventListener("click", () => showProductForm(null));
  document.getElementById("prod-cancel").addEventListener("click", () => {
    document.getElementById("prod-form").hidden = true;
  });
  document.getElementById("prod-form").addEventListener("submit", saveProduct);
}

async function refreshProducts() {
  const snap = await getDocs(collection(db, "products"));
  products = snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (toDate(b.createdAt)?.getTime() || 0) - (toDate(a.createdAt)?.getTime() || 0));
  document.getElementById("prod-rows").innerHTML = products.map((p) => {
    const pre = p.preorderPrice != null
      ? `${fmtMoney(p.preorderPrice)}${toDate(p.preorderEndsAt) ? ` → ${fmtDate(p.preorderEndsAt)}` : ""}`
      : "—";
    return `<tr>
      <td><strong>${escapeHtml(p.name)}</strong><br><span style="color:var(--muted)">${escapeHtml(p.colorsNote || "")}</span></td>
      <td>${fmtMoney(p.price)}</td>
      <td>${escapeHtml(pre)}</td>
      <td>${p.active === false ? "hidden" : "live"}</td>
      <td style="white-space:nowrap">
        <button class="btn small ghost" data-pedit="${p.id}">Edit</button>
        <button class="btn small danger" data-pdel="${p.id}">Delete</button>
      </td>
    </tr>`;
  }).join("") || `<tr><td colspan="5" style="text-align:center;color:var(--muted)">No products yet — use "Seed demo products" to add the starter catalog.</td></tr>`;

  document.querySelectorAll("[data-pedit]").forEach((b) =>
    b.addEventListener("click", () => showProductForm(products.find((p) => p.id === b.dataset.pedit))));
  document.querySelectorAll("[data-pdel]").forEach((b) =>
    b.addEventListener("click", async () => {
      if (!confirm("Delete this product?")) return;
      await deleteDoc(doc(db, "products", b.dataset.pdel));
      toast("Product deleted");
      refreshProducts();
    }));
}

function showProductForm(p) {
  editingProductId = p ? p.id : null;
  document.getElementById("prod-form-title").textContent = p ? "Edit product" : "New product";
  document.getElementById("pf-name").value = p?.name || "";
  document.getElementById("pf-colors").value = p?.colorsNote || "";
  document.getElementById("pf-desc").value = p?.description || "";
  document.getElementById("pf-leadtime").value = p?.leadTimeDays ?? 7;
  document.getElementById("pf-price").value = p?.price ?? "";
  document.getElementById("pf-preprice").value = p?.preorderPrice ?? "";
  document.getElementById("pf-prestart").value = dateToDtLocal(p?.preorderStartAt);
  document.getElementById("pf-preend").value = dateToDtLocal(p?.preorderEndsAt);
  document.getElementById("pf-active").checked = p ? p.active !== false : true;
  document.getElementById("pf-file").value = "";
  renderProductImages(p?.images || []);
  document.getElementById("prod-form").hidden = false;
  document.getElementById("prod-form").scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function renderProductImages(images) {
  const box = document.getElementById("pf-images");
  box.innerHTML = images.map((src, i) => `
    <span class="img-thumb">
      <img src="${escapeHtml(src)}" alt="product image ${i + 1}">
      <button type="button" data-rmimg="${i}" title="Remove">×</button>
    </span>`).join("");
  box.querySelectorAll("[data-rmimg]").forEach((b) =>
    b.addEventListener("click", async () => {
      if (!editingProductId) return;
      const cur = products.find((p) => p.id === editingProductId);
      const next = (cur.images || []).filter((_, i) => i !== Number(b.dataset.rmimg));
      await updateDoc(doc(db, "products", editingProductId), { images: next });
      cur.images = next;
      renderProductImages(next);
      toast("Image removed");
    }));
}

async function saveProduct(e) {
  e.preventDefault();
  const btn = e.target.querySelector('button[type="submit"]');
  if (btn.disabled) return; // already saving — ignore double taps
  btn.disabled = true;
  const data = {
    name: document.getElementById("pf-name").value.trim(),
    colorsNote: document.getElementById("pf-colors").value.trim(),
    description: document.getElementById("pf-desc").value.trim(),
    leadTimeDays: Math.max(0, Math.round(Number(document.getElementById("pf-leadtime").value) || 0)),
    price: Number(document.getElementById("pf-price").value),
    preorderPrice: numOrNull(document.getElementById("pf-preprice").value),
    preorderStartAt: dtLocalToDate(document.getElementById("pf-prestart").value),
    preorderEndsAt: dtLocalToDate(document.getElementById("pf-preend").value),
    active: document.getElementById("pf-active").checked,
    updatedAt: serverTimestamp(),
  };
  if (!data.name || !(data.price >= 0)) { toast("Name and price are required."); return; }

  let id = editingProductId;
  try {
    if (id) {
      await updateDoc(doc(db, "products", id), data);
    } else {
      const r = await addDoc(collection(db, "products"), { ...data, images: [], createdAt: serverTimestamp() });
      id = r.id;
    }
    const file = document.getElementById("pf-file").files[0];
    if (file) {
      const r = ref(storage, `product-images/${id}/${Date.now()}_${file.name}`);
      await uploadBytes(r, file);
      const url = await getDownloadURL(r);
      const cur = products.find((p) => p.id === id);
      const images = [...(cur?.images || []), url];
      await updateDoc(doc(db, "products", id), { images });
      document.getElementById("pf-file").value = "";
    }
    document.getElementById("prod-form").hidden = true;
    toast("Product saved.");
    await refreshProducts();
  } catch (err) {
    console.error(err);
    toast("Couldn't save: " + (err.message || err));
    btn.disabled = false;
  }
}

async function onSeed() {
  if (!confirm("Add the 3 demo products (gear shifter tiers) to Firestore?")) return;
  try {
    const ids = await seedProducts(db);
    toast(`Seeded ${ids.length} products.`);
    await refreshProducts();
  } catch (err) {
    console.error(err);
    toast("Seeding failed: " + (err.message || err));
  }
}

/* ---------- deals ---------- */

let editingDealId = null;

function wireDeals() {
  document.getElementById("deal-new").addEventListener("click", () => showDealForm(null));
  document.getElementById("deal-cancel").addEventListener("click", () => {
    document.getElementById("deal-form").hidden = true;
  });
  document.getElementById("deal-form").addEventListener("submit", saveDeal);
}

function productName(id) {
  return products.find((p) => p.id === id)?.name || id;
}

async function refreshDeals() {
  const snap = await getDocs(collection(db, "deals"));
  deals = snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (toDate(b.createdAt)?.getTime() || 0) - (toDate(a.createdAt)?.getTime() || 0));
  document.getElementById("deal-rows").innerHTML = deals.map((d) => `
    <tr>
      <td><strong>${escapeHtml(d.title)}</strong></td>
      <td>${escapeHtml(productName(d.productId))}</td>
      <td>${fmtMoney(d.dealPrice)}</td>
      <td>${fmtDate(d.startsAt)} → ${fmtDate(d.endsAt)}</td>
      <td>${d.active === false ? "off" : "on"}</td>
      <td style="white-space:nowrap">
        <button class="btn small ghost" data-dedit="${d.id}">Edit</button>
        <button class="btn small danger" data-ddel="${d.id}">Delete</button>
      </td>
    </tr>`).join("") || `<tr><td colspan="6" style="text-align:center;color:var(--muted)">No deals yet.</td></tr>`;

  document.querySelectorAll("[data-dedit]").forEach((b) =>
    b.addEventListener("click", () => showDealForm(deals.find((d) => d.id === b.dataset.dedit))));
  document.querySelectorAll("[data-ddel]").forEach((b) =>
    b.addEventListener("click", async () => {
      if (!confirm("Delete this deal?")) return;
      await deleteDoc(doc(db, "deals", b.dataset.ddel));
      toast("Deal deleted");
      refreshDeals();
    }));
}

function showDealForm(d) {
  editingDealId = d ? d.id : null;
  document.getElementById("deal-form-title").textContent = d ? "Edit deal" : "New deal";
  document.getElementById("df-product").innerHTML = products
    .map((p) => `<option value="${p.id}" ${d && d.productId === p.id ? "selected" : ""}>${escapeHtml(p.name)}${p.active === false ? " (hidden)" : ""}</option>`)
    .join("");
  document.getElementById("df-title").value = d?.title || "";
  document.getElementById("df-price").value = d?.dealPrice ?? "";
  document.getElementById("df-start").value = dateToDtLocal(d?.startsAt);
  document.getElementById("df-end").value = dateToDtLocal(d?.endsAt);
  document.getElementById("df-active").checked = d ? d.active !== false : true;
  document.getElementById("deal-form").hidden = false;
}

async function saveDeal(e) {
  e.preventDefault();
  const btn = e.target.querySelector('button[type="submit"]');
  if (btn.disabled) return;
  btn.disabled = true;
  const data = {
    title: document.getElementById("df-title").value.trim(),
    productId: document.getElementById("df-product").value,
    dealPrice: Number(document.getElementById("df-price").value),
    startsAt: dtLocalToDate(document.getElementById("df-start").value),
    endsAt: dtLocalToDate(document.getElementById("df-end").value),
    active: document.getElementById("df-active").checked,
    updatedAt: serverTimestamp(),
  };
  if (!data.title || !(data.dealPrice >= 0)) { toast("Title and deal price are required."); return; }
  try {
    if (editingDealId) await updateDoc(doc(db, "deals", editingDealId), data);
    else await addDoc(collection(db, "deals"), { ...data, createdAt: serverTimestamp() });
    document.getElementById("deal-form").hidden = true;
    toast("Deal saved.");
    refreshDeals();
  } catch (err) {
    console.error(err);
    toast("Couldn't save: " + (err.message || err));
    btn.disabled = false;
  }
}

/* ---------- promo codes ---------- */

let editingPromoCode = null;

function wirePromos() {
  document.getElementById("promo-new").addEventListener("click", () => showPromoForm(null));
  document.getElementById("promo-cancel").addEventListener("click", () => {
    document.getElementById("promo-form").hidden = true;
  });
  document.getElementById("promo-form").addEventListener("submit", savePromo);
}

async function refreshPromos() {
  const snap = await getDocs(collection(db, "promoCodes"));
  promos = snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => a.id.localeCompare(b.id));
  document.getElementById("promo-rows").innerHTML = promos.map((c) => `
    <tr>
      <td><code class="inline">${escapeHtml(c.id)}</code></td>
      <td>${c.type === "percent" ? `${escapeHtml(String(c.value))}%` : fmtMoney(c.value)}</td>
      <td>${c.usedCount || 0} / ${c.maxUses ?? "∞"}</td>
      <td>${c.expiresAt ? fmtDate(c.expiresAt) : "—"}</td>
      <td>${c.active === false ? "off" : "on"}</td>
      <td style="white-space:nowrap">
        <button class="btn small ghost" data-cedit="${escapeHtml(c.id)}">Edit</button>
        <button class="btn small danger" data-cdel="${escapeHtml(c.id)}">Delete</button>
      </td>
    </tr>`).join("") || `<tr><td colspan="6" style="text-align:center;color:var(--muted)">No promo codes yet.</td></tr>`;

  document.querySelectorAll("[data-cedit]").forEach((b) =>
    b.addEventListener("click", () => showPromoForm(promos.find((c) => c.id === b.dataset.cedit))));
  document.querySelectorAll("[data-cdel]").forEach((b) =>
    b.addEventListener("click", async () => {
      if (!confirm(`Delete code ${b.dataset.cdel}?`)) return;
      await deleteDoc(doc(db, "promoCodes", b.dataset.cdel));
      toast("Code deleted");
      refreshPromos();
    }));
}

function showPromoForm(c) {
  editingPromoCode = c ? c.id : null;
  document.getElementById("promo-form-title").textContent = c ? `Edit code ${c.id}` : "New promo code";
  const codeInput = document.getElementById("cf-code");
  codeInput.value = c?.id || "";
  codeInput.disabled = !!c; // doc id can't change — delete + recreate to rename
  document.getElementById("cf-type").value = c?.type || "percent";
  document.getElementById("cf-value").value = c?.value ?? "";
  document.getElementById("cf-max").value = c?.maxUses ?? 50;
  document.getElementById("cf-exp").value = dateToDtLocal(c?.expiresAt);
  document.getElementById("cf-active").checked = c ? c.active !== false : true;
  document.getElementById("promo-form").hidden = false;
}

async function savePromo(e) {
  e.preventDefault();
  const btn = e.target.querySelector('button[type="submit"]');
  if (btn.disabled) return;
  btn.disabled = true;
  const code = document.getElementById("cf-code").value.trim().toUpperCase();
  const data = {
    type: document.getElementById("cf-type").value,
    value: Number(document.getElementById("cf-value").value),
    maxUses: Number(document.getElementById("cf-max").value),
    expiresAt: dtLocalToDate(document.getElementById("cf-exp").value),
    active: document.getElementById("cf-active").checked,
    updatedAt: serverTimestamp(),
  };
  if (!code || !(data.value >= 0) || !(data.maxUses >= 1)) { toast("Code, value and max uses are required."); return; }
  try {
    if (editingPromoCode) {
      await updateDoc(doc(db, "promoCodes", editingPromoCode), data);
    } else {
      const existing = await getDoc(doc(db, "promoCodes", code));
      if (existing.exists()) { toast("That code already exists."); btn.disabled = false; return; }
      await setDoc(doc(db, "promoCodes", code), { ...data, usedCount: 0, createdAt: serverTimestamp() });
    }
    document.getElementById("promo-form").hidden = true;
    toast("Promo code saved.");
    refreshPromos();
  } catch (err) {
    console.error(err);
    toast("Couldn't save: " + (err.message || err));
    btn.disabled = false;
  }
}

/* ---------- orders ---------- */

function wireOrders() {
  document.getElementById("ord-filter").addEventListener("change", renderOrders);
}

async function refreshOrders() {
  const [ordersSnap, pickupSnap] = await Promise.all([
    getDocs(collection(db, "orders")),
    getDocs(collection(db, "pickupLocations")),
  ]);
  orders = ordersSnap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (toDate(b.createdAt)?.getTime() || 0) - (toDate(a.createdAt)?.getTime() || 0));
  pickupMap = {};
  pickupSnap.docs.forEach((d) => {
    const data = d.data();
    if (data.pickupLocation) pickupMap[d.id] = data.pickupLocation;
  });
  renderOrders();
}

function statusMetaHTML(o) {
  const bits = [];
  if (o.statusBatch && (canonStatus(o.status) === "queued" || canonStatus(o.status) === "reprint_queued")) {
    bits.push(escapeHtml(fmtBatch(o.statusBatch)));
  }
  if (o.deliveryWindow && fmtDeliveryWindow(o.deliveryWindow)) {
    bits.push(escapeHtml(fmtDeliveryWindow(o.deliveryWindow)));
  }
  if ((o.reprintHistory || []).length) {
    const last = o.reprintHistory[o.reprintHistory.length - 1];
    bits.push(`Reprinted on ${escapeHtml(fmtBatch(last.batch))}`);
  }
  const pk = pickupMap[o.id];
  if (canonStatus(o.status) === "delivering") {
    bits.push(pk
      ? `<span class="pickup-flag">Pickup: <strong>${escapeHtml(pk)}</strong></span>`
      : `<span class="pickup-flag pickup-missing">Pickup: not set yet</span>`);
  }
  return bits.length ? `<div class="order-meta">${bits.join(" · ")}</div>` : "";
}

function renderOrders() {
  const filter = document.getElementById("ord-filter").value;
  const rows = orders.filter((o) => !filter || canonStatus(o.status) === filter);
  document.getElementById("ord-rows").innerHTML = rows.map((o) => {
    const canon = canonStatus(o.status);
    return `
    <tr>
      <td><code class="inline">${escapeHtml(o.id.slice(0, 8))}…</code></td>
      <td>${fmtDate(o.createdAt)}</td>
      <td><strong>${escapeHtml(o.name || "")}</strong><br><span style="color:var(--muted)">${escapeHtml(o.email || "")} · ${escapeHtml(o.homeroom || "")}</span></td>
      <td>${escapeHtml(o.grade || "—")}</td>
      <td>${(o.items || []).map((i) => `${i.qty}× ${escapeHtml(i.name)}`).join("<br>")}${o.promoCode ? `<br><span style="color:var(--muted)">${escapeHtml(o.promoCode)} (−${fmtMoney(o.discount)})</span>` : ""}</td>
      <td><strong>${fmtMoney(o.total)}</strong></td>
      <td>
        <select data-ostatus="${o.id}" style="margin:0;min-width:150px">
          ${ORDER_STATUSES.map(([v, label]) => `<option value="${v}" ${canon === v ? "selected" : ""}>${label}</option>`).join("")}
        </select>
        ${statusMetaHTML(o)}
        <div data-oextras="${o.id}"></div>
      </td>
    </tr>`;
  }).join("") || `<tr><td colspan="7" style="text-align:center;color:var(--muted)">No orders yet.</td></tr>`;

  document.querySelectorAll("[data-ostatus]").forEach((sel) =>
    sel.addEventListener("change", () => onOrderStatusChange(sel)));
}

function orderExtrasForm(o, kind) {
  if (kind === "queued") {
    return `
      <label>Batch number<input data-xbatch value="" placeholder="e.g. 83"></label>
      <div style="display:flex;gap:6px;margin-top:6px">
        <button type="button" class="btn small" data-xsave>Save</button>
        <button type="button" class="btn small ghost" data-xcancel>Cancel</button>
      </div>`;
  }
  if (kind === "reprint_queued") {
    return `
      <label>New batch number<input data-xbatch placeholder="e.g. 84"></label>
      <div style="display:flex;gap:6px;margin-top:6px">
        <button type="button" class="btn small" data-xsave>Save</button>
        <button type="button" class="btn small ghost" data-xcancel>Cancel</button>
      </div>`;
  }
  // delivering
  const today = new Date();
  const p = (n) => String(n).padStart(2, "0");
  const todayStr = `${today.getFullYear()}-${p(today.getMonth() + 1)}-${p(today.getDate())}`;
  return `
    <div class="form-grid two">
      <div><label>Date<input type="date" data-xdate value="${o.deliveryWindow?.date || todayStr}"></label></div>
      <div><label>Start time<input type="time" data-xtime value="${o.deliveryWindow?.startTime || "14:00"}"></label></div>
    </div>
    <p style="color:var(--muted);font-size:0.82rem;margin:4px 0">Delivery window is 1 hour from the start time.</p>
    <div style="display:flex;gap:6px;margin-top:6px">
      <button type="button" class="btn small" data-xsave>Save</button>
      <button type="button" class="btn small ghost" data-xcancel>Cancel</button>
    </div>`;
}

async function onOrderStatusChange(sel) {
  const id = sel.dataset.ostatus;
  const val = sel.value;
  const o = orders.find((x) => x.id === id);
  const box = document.querySelector(`[data-oextras="${id}"]`);
  if (val === "queued" || val === "reprint_queued" || val === "delivering") {
    // These statuses need extra data — show the inline editor first.
    box.innerHTML = orderExtrasForm(o, val);
    box.querySelector("[data-xcancel]").addEventListener("click", () => {
      box.innerHTML = "";
      sel.value = canonStatus(o.status); // revert the dropdown
    });
    box.querySelector("[data-xsave]").addEventListener("click", async () => {
      const update = { status: val, updatedAt: serverTimestamp() };
      if (val === "queued" || val === "reprint_queued") {
        const batch = box.querySelector("[data-xbatch]").value.trim();
        if (!batch) { toast("Enter a batch number."); return; }
        update.statusBatch = batch;
        if (val === "reprint_queued") {
          update.reprintHistory = arrayUnion({ batch, at: serverTimestamp() });
        }
      } else if (val === "delivering") {
        const date = box.querySelector("[data-xdate]").value;
        const startTime = box.querySelector("[data-xtime]").value;
        if (!date || !startTime) { toast("Enter a date and start time."); return; }
        update.deliveryWindow = { date, startTime };
      }
      try {
        await updateDoc(doc(db, "orders", id), update);
        Object.assign(o, update, { reprintHistory: val === "reprint_queued"
          ? [...(o.reprintHistory || []), { batch: update.statusBatch, at: new Date() }]
          : o.reprintHistory });
        box.innerHTML = "";
        toast(`Order → ${ORDER_STATUSES.find(([v]) => v === val)[1]}`);
        renderOrders();
      } catch (err) {
        console.error(err);
        toast("Couldn't update: " + (err.message || err));
      }
    });
    return;
  }
  try {
    await updateDoc(doc(db, "orders", id), {
      status: val,
      updatedAt: serverTimestamp(),
    });
    if (o) o.status = val;
    toast(`Order → ${ORDER_STATUSES.find(([v]) => v === val)[1]}`);
  } catch (err) {
    console.error(err);
    toast("Couldn't update: " + (err.message || err));
  }
}
