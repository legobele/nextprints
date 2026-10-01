// Cart + checkout: promo codes, pickup form, order placement (no payments).

import { onAuthStateChanged } from "firebase/auth";
import { collection, doc, getDoc, getDocs, query, where, runTransaction, serverTimestamp } from "firebase/firestore";
import { auth, db } from "./firebase.js";
import { BRAND_NAME, SCHOOL_DOMAIN } from "./config.js";
import { renderNav, escapeHtml, fmtMoney, toDate, toast, placeholderSVG, updateCartBadge } from "./ui.js";
import { getCart, setQty, clearCart, fetchProduct, getActivePrice, round2 } from "./store.js";

renderNav("cart");
document.title = `Cart · ${BRAND_NAME}`;

const GRADES = ["6th", "7th", "8th", "9th", "10th", "11th", "12th"];

let appliedPromo = null; // { code, type, value }
let lines = []; // resolved cart lines: { productId, qty, name, image, unitPrice, isPreorder, deliveryEstimate }
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
  for (const l of cart) {
    let p = null;
    try { p = await fetchProduct(l.productId); } catch (e) { console.warn(e); }
    if (!p) continue; // product removed — skip silently
    const { price, isPreorder } = getActivePrice(p);
    lines.push({
      productId: p.id, qty: l.qty, name: p.name,
      image: (p.images && p.images.length ? p.images[0] : placeholderSVG(p.name, 270, 320)),
      unitPrice: price, isPreorder,
      deliveryEstimate: p.deliveryEstimate || null,
      // Snapshotted so old orders keep the original batch/description.
      description: p.description || "",
      batchNumber: p.batchNumber || "",
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
    ${lines.map((l) => `
      <div class="cart-line">
        <img src="${escapeHtml(l.image)}" alt="${escapeHtml(l.name)}">
        <div class="info">
          <h4>${escapeHtml(l.name)}</h4>
          <div>${l.isPreorder ? `<span class="badge preorder">pre-order</span> ` : ""}${fmtMoney(l.unitPrice)} each</div>
          ${l.deliveryEstimate ? `<div class="delivery-note">Estimated delivery: <strong>${escapeHtml(l.deliveryEstimate)}</strong></div>` : ""}
        </div>
        <div class="qty-stepper" style="margin:0">
          <button data-dec="${l.productId}" aria-label="decrease">−</button>
          <span>${l.qty}</span>
          <button data-inc="${l.productId}" aria-label="increase">+</button>
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
    <label>Homeroom<input id="f-homeroom" placeholder="e.g. 10-3"></label>
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

  // qty buttons
  view.querySelectorAll("[data-dec]").forEach((b) => b.addEventListener("click", async () => {
    const l = lines.find((x) => x.productId === b.dataset.dec);
    setQty(l.productId, l.qty - 1); updateCartBadge(); await reload();
  }));
  view.querySelectorAll("[data-inc]").forEach((b) => b.addEventListener("click", async () => {
    const l = lines.find((x) => x.productId === b.dataset.inc);
    setQty(l.productId, l.qty + 1); updateCartBadge(); await reload();
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
    appliedPromo = { code, type: c.type, value: Number(c.value) };
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
  const name = document.getElementById("f-name").value.trim();
  const homeroom = document.getElementById("f-homeroom").value.trim();
  if (!name) { toast("Please enter your name."); return; }
  if (!homeroom) { toast("Please enter your homeroom."); return; }
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
        homeroom,
        grade,
        items: lines.map((l) => ({ productId: l.productId, name: l.name, qty: l.qty, unitPrice: l.unitPrice, description: l.description, batchNumber: l.batchNumber })),
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
    toast(err.message || "Couldn't place the order. Try again.");
    btn.disabled = false;
    btn.textContent = "Place order";
    await reload();
  }
}

onAuthStateChanged(auth, () => refreshVerifyNotice());
reload();
