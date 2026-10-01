// Cart + checkout: promo codes, pickup form, order placement (no payments).

import { onAuthStateChanged } from "firebase/auth";
import { collection, doc, getDoc, getDocs, query, where, runTransaction, serverTimestamp } from "firebase/firestore";
import { auth, db } from "./firebase.js";
import { BRAND_NAME, SCHOOL_DOMAIN } from "./config.js";
import { renderNav, escapeHtml, fmtMoney, fmtEstimatedDelivery, toDate, toast, placeholderSVG, updateCartBadge } from "./ui.js";
import { getCart, setQty, clearCart, fetchProduct, fetchDeals, chargedPrice, round2 } from "./store.js";

renderNav("cart");
document.title = `Cart · ${BRAND_NAME}`;

const GRADES = ["6th", "7th", "8th", "9th", "10th", "11th", "12th"];

let appliedPromo = null; // { code, type, value }
let lines = []; // resolved cart lines: { productId, variantKey, variantLabel, qty, name, image, unitPrice, isPreorder, leadTimeDays }
let knownGrade = null; // grade remembered from the customer's most recent order
let gradeChecked = false;

function discountFor(subtotal, promo) {
  if (!promo) return 0;
  const raw = promo.type === "percent" ? subtotal * (Number(promo.value) / 100) : Number(promo.value);
  return round2(Math.min(Math.max(0, raw), subtotal));
}

async function loadLines() {
  const cart = getCart();
  lines = [];
  let deals = [];
  try { deals = await fetchDeals(); } catch (e) { console.warn("deals load failed", e); }
  for (const l of cart) {
    let p = null;
    try { p = await fetchProduct(l.productId); } catch (e) { console.warn(e); }
    if (!p) continue; // product removed — skip silently
    // Base price is re-resolved live (preorder windows and deals change);
    // the variant delta snapshot adjusts it. An active deal is the charged
    // price, matching what the shop advertises.
    const { price, isPreorder } = chargedPrice(p, deals);
    lines.push({
      productId: p.id, qty: l.qty,
      variantKey: l.variantKey || "",
      variantLabel: l.variantLabel || "",
      name: p.name,
      image: (p.images && p.images.length ? p.images[0] : placeholderSVG(p.name, 270, 320)),
      // Base price is re-resolved live (preorder windows change);
      // the variant delta snapshot adjusts it.
      unitPrice: round2(price + (Number(l.priceDelta) || 0)), isPreorder,
      leadTimeDays: p.leadTimeDays ?? null,
      // Snapshotted so old orders keep the original description.
      description: p.description || "",
    });
  }
}

function render() {
  const view = document.getElementById("cart-view");
  document.getElementById("loading").hidden = true;
  if (!lines.length) {
    view.hidden = false;
    view.innerHTML = `<div class="empty">Your cart is empty.<br><br><a class="btn" href="index.html">Browse the shop</a></div>`;
    return;
  }
  const subtotal = round2(lines.reduce((n, l) => n + l.unitPrice * l.qty, 0));
  const discount = discountFor(subtotal, appliedPromo);
  const total = round2(subtotal - discount);

  view.hidden = false;
  view.innerHTML = `
    ${lines.map((l, idx) => `
      <div class="cart-line">
        <img src="${escapeHtml(l.image)}" alt="${escapeHtml(l.name)}">
        <div class="info">
          <h4>${escapeHtml(l.name)}</h4>
          ${l.variantLabel ? `<div style="color:var(--muted);font-size:0.85rem">${escapeHtml(l.variantLabel)}</div>` : ""}
          <div>${l.isPreorder ? `<span class="badge preorder">pre-order</span> ` : ""}${fmtMoney(l.unitPrice)} each</div>
          ${fmtEstimatedDelivery(l.leadTimeDays) ? `<div class="delivery-note">Estimated delivery: <strong>${escapeHtml(fmtEstimatedDelivery(l.leadTimeDays))}</strong></div>` : ""}
        </div>
        <div class="qty-stepper" style="margin:0">
          <button data-dec="${idx}" aria-label="decrease">−</button>
          <span>${l.qty}</span>
          <button data-inc="${idx}" aria-label="increase">+</button>
        </div>
      </div>`).join("")}

    <h3>Promo code</h3>
    ${appliedPromo
      ? `<p><strong>${escapeHtml(appliedPromo.code)}</strong> applied — ${escapeHtml(promoLabel(appliedPromo))}
           <button class="btn small ghost" id="promo-remove">Remove</button></p>`
      : `<div class="promo-row">
           <input id="promo-input" placeholder="Enter code" autocapitalize="characters">
           <button class="btn small" id="promo-apply">Apply</button>
         </div>`}

    <div class="totals">
      <div class="row"><span>Subtotal</span><span>${fmtMoney(subtotal)}</span></div>
      ${discount ? `<div class="row"><span>Discount</span><span>−${fmtMoney(discount)}</span></div>` : ""}
      <div class="row grand"><span>Total (cash on pickup)</span><span>${fmtMoney(total)}</span></div>
    </div>

    <h3>Pickup details</h3>
    <div id="verify-notice"></div>
    <div id="grade-notice"></div>
    <label>Your name<input id="f-name" placeholder="e.g. Alex Rivera" autocomplete="name"></label>
    ${knownGrade === null ? `
    <label>What grade are you in?
      <select id="f-grade">
        <option value="">Select grade…</option>
        ${GRADES.map((g) => `<option value="${g}">${g} grade</option>`).join("")}
      </select>
    </label>` : ""}
    <button class="btn" id="place-order" style="width:100%;margin-top:8px">Place order · ${fmtMoney(total)} cash on pickup</button>
    <p style="color:var(--muted);font-size:0.9rem">No online payment — bring cash when you pick up. You need a verified <strong>@${escapeHtml(SCHOOL_DOMAIN)}</strong> email to order. NextPrints serves grades 8–12 only.</p>
  `;

  // qty buttons (keyed by line index — the same product can appear
  // multiple times with different variants)
  view.querySelectorAll("[data-dec]").forEach((b) => b.addEventListener("click", async () => {
    const l = lines[Number(b.dataset.dec)];
    setQty(l.productId, l.qty - 1, l.variantKey); updateCartBadge(); await reload();
  }));
  view.querySelectorAll("[data-inc]").forEach((b) => b.addEventListener("click", async () => {
    const l = lines[Number(b.dataset.inc)];
    setQty(l.productId, l.qty + 1, l.variantKey); updateCartBadge(); await reload();
  }));

  const applyBtn = document.getElementById("promo-apply");
  if (applyBtn) applyBtn.addEventListener("click", onApplyPromo);
  const rmBtn = document.getElementById("promo-remove");
  if (rmBtn) rmBtn.addEventListener("click", () => { appliedPromo = null; render(); });

  document.getElementById("place-order").addEventListener("click", placeOrder);
  refreshVerifyNotice();
}

function promoLabel(p) {
  return p.type === "percent" ? `${p.value}% off` : `${fmtMoney(p.value)} off`;
}

async function onApplyPromo() {
  const input = document.getElementById("promo-input");
  const code = input.value.trim().toUpperCase();
  if (!code) return;
  try {
    const snap = await getDoc(doc(db, "promoCodes", code));
    if (!snap.exists()) throw new Error("Code not found.");
    const c = snap.data();
    const now = new Date();
    if (c.active === false) throw new Error("This code is inactive.");
    if (c.expiresAt && toDate(c.expiresAt) < now) throw new Error("This code expired.");
    if ((c.usedCount || 0) >= (c.maxUses ?? Infinity)) throw new Error("This code is fully redeemed.");
    // Validate the promo shape before applying: a malformed doc would apply
    // a NaN discount and block checkout until removed.
    const value = Number(c.value);
    if ((c.type !== "percent" && c.type !== "fixed") || !Number.isFinite(value) || value < 0) {
      throw new Error("That code isn't valid.");
    }
    appliedPromo = { code, type: c.type, value };
    toast(`Promo applied: ${promoLabel(appliedPromo)}`);
    render();
  } catch (err) {
    console.error(err);
    toast(err.message || "Couldn't apply that code.");
  }
}

async function refreshVerifyNotice() {
  const slot = document.getElementById("verify-notice");
  if (!slot) return;
  const user = auth.currentUser;
  if (user && !user.emailVerified) {
    slot.innerHTML = `<div class="notice">Your email is not verified yet — check your inbox, then <a href="account.html">verify here</a> before ordering.</div>`;
  } else slot.innerHTML = "";
}

async function reload() {
  await loadLines();
  // Remember the grade from the customer's most recent order (if any),
  // so first-time buyers are asked once and repeat buyers aren't asked again.
  const user = auth.currentUser;
  if (user && !gradeChecked) {
    gradeChecked = true;
    try {
      const snap = await getDocs(query(collection(db, "orders"), where("userId", "==", user.uid)));
      const prior = snap.docs
        .map((d) => d.data())
        .sort((a, b) => (toDate(b.createdAt)?.getTime() || 0) - (toDate(a.createdAt)?.getTime() || 0));
      const withGrade = prior.find((o) => o.grade);
      if (withGrade) knownGrade = withGrade.grade;
    } catch (e) { console.warn("grade lookup failed", e); }
  }
  render();
}

async function placeOrder() {
  const user = auth.currentUser;
  if (!user) {
    toast("Sign in first so we know who the order is for.");
    location.href = "account.html";
    return;
  }
  try { await user.reload(); } catch (e) { console.warn(e); }
  if (!user.emailVerified) {
    toast("Verify your email first — check your inbox.");
    location.href = "account.html";
    return;
  }
  // Force-refresh the ID token: Firestore rules read email_verified from the
  // token, which stays stale for up to an hour after verification otherwise.
  try { await user.getIdToken(true); } catch (e) { console.warn(e); }
  const name = document.getElementById("f-name").value.trim();
  if (!name) { toast("Please enter your name."); return; }
  if (!lines.length) { toast("Your cart is empty."); return; }

  // Grade gate: reuse the grade from a previous order when we have one;
  // otherwise the buyer must pick it now. Grades below 8th are blocked.
  let grade = knownGrade;
  if (!grade) {
    const sel = document.getElementById("f-grade");
    grade = sel ? sel.value : "";
    if (!grade) { toast("Please select your grade."); if (sel) sel.focus(); return; }
  }
  if (grade === "6th" || grade === "7th") {
    const slot = document.getElementById("grade-notice");
    if (slot) slot.innerHTML = `<div class="error-box">NextPrints currently serves students in grades 8–12 only.</div>`;
    window.scrollTo(0, 0);
    return;
  }

  const btn = document.getElementById("place-order");
  const btnLabel = btn.textContent; // e.g. "Place order · $8.00 cash on pickup"
  btn.disabled = true;
  btn.textContent = "Placing order…";

  try {
    const subtotal = round2(lines.reduce((n, l) => n + l.unitPrice * l.qty, 0));
    const orderId = await runTransaction(db, async (tx) => {
      let discount = 0;
      let promoCode = null;
      if (appliedPromo) {
        const codeRef = doc(db, "promoCodes", appliedPromo.code);
        const csnap = await tx.get(codeRef);
        if (!csnap.exists()) throw new Error("Promo code is no longer valid.");
        const c = csnap.data();
        const now = new Date();
        if (c.active === false) throw new Error("Promo code is no longer valid.");
        if (c.expiresAt && toDate(c.expiresAt) < now) throw new Error("Promo code expired.");
        if ((c.usedCount || 0) >= (c.maxUses ?? Infinity)) throw new Error("Promo code is fully redeemed.");
        discount = discountFor(subtotal, { type: c.type, value: Number(c.value) });
        tx.update(codeRef, { usedCount: (c.usedCount || 0) + 1 });
        promoCode = appliedPromo.code;
      }
      const total = round2(subtotal - discount);
      const orderRef = doc(collection(db, "orders"));
      tx.set(orderRef, {
        userId: user.uid,
        email: user.email,
        name,
        grade,
        items: lines.map((l) => ({ productId: l.productId, name: l.name, qty: l.qty, unitPrice: l.unitPrice, variantLabel: l.variantLabel || "", description: l.description })),
        subtotal,
        discount,
        total,
        promoCode,
        status: "pending",
        createdAt: serverTimestamp(),
      });
      return orderRef.id;
    });

    clearCart();
    updateCartBadge();
    const total = round2(subtotal - discountFor(subtotal, appliedPromo));
    document.getElementById("cart-view").hidden = true;
    const done = document.getElementById("done-view");
    done.hidden = false;
    done.innerHTML = `
      <div class="card"><div class="card-body" style="text-align:center;padding:32px 20px">
        <h2>Order placed</h2>
        <p>Order <code class="inline">${escapeHtml(orderId.slice(0, 8))}…</code> has been reserved.</p>
        <p>Bring <strong>${fmtMoney(total)} in cash</strong> on pickup or delivery day.<br>
        Track it under <a href="orders.html">My orders</a>.</p>
        <a class="btn" href="index.html">Back to shop</a>
      </div></div>`;
    window.scrollTo(0, 0);
  } catch (err) {
    console.error(err);
    // Translate Firestore permission errors into something human.
    const msg = /missing or insufficient permissions/i.test(String(err.message || err))
      ? "We couldn't place your order due to a permissions issue. Try signing out and back in, then try again."
      : (err.message || "Couldn't place the order. Try again.");
    toast(msg);
    btn.disabled = false;
    btn.textContent = btnLabel; // restore the full original label
    await reload();
  }
}

onAuthStateChanged(auth, () => refreshVerifyNotice());
reload();
