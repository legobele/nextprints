// Shop domain logic: pricing tiers, cart (localStorage), product/deal reads.

import { collection, doc, getDoc, getDocs, setDoc, deleteDoc, serverTimestamp } from "firebase/firestore";
import { auth, db } from "./firebase.js";
import { toDate, isProductVisible } from "./ui.js";

/* ---------------- cart (localStorage) ---------------- */

const CART_KEY = "fidgetlab_cart_v1";

export function getCart() {
  try {
    const raw = JSON.parse(localStorage.getItem(CART_KEY));
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

export function saveCart(cart) {
  localStorage.setItem(CART_KEY, JSON.stringify(cart));
  syncCartSoon();
}

// Abandoned-cart sync: mirrors the signed-in user's cart to Firestore
// (debounced) so the hourly Cloud Function can send "left in your cart"
// reminders. Fire-and-forget — a sync failure never breaks the local cart.
let cartSyncTimer = null;
function syncCartSoon() {
  clearTimeout(cartSyncTimer);
  cartSyncTimer = setTimeout(async () => {
    try {
      const user = auth.currentUser;
      if (!user) return;
      const items = getCart().map((l) => ({
        productId: l.productId,
        variantKey: l.variantKey || "",
        variantLabel: l.variantLabel || "",
        qty: l.qty,
      }));
      // reminded:false resets the reminder cycle whenever the cart changes —
      // a changed cart is a new abandonment.
      await setDoc(
        doc(db, "carts", user.uid),
        { items, reminded: false, updatedAt: serverTimestamp() },
        { merge: true }
      );
    } catch (e) {
      console.error("cart sync failed", e);
    }
  }, 4000);
}

export function addToCart(productId, qty = 1, variant = null) {
  const cart = getCart();
  const key = variant?.key || "";
  const line = cart.find((l) => l.productId === productId && (l.variantKey || "") === key);
  if (line) line.qty = Math.min(99, line.qty + qty);
  else cart.push({
    productId,
    variantKey: key, // stable product+options key; "" = no variants (or pre-variant carts)
    variantLabel: variant?.label || "", // human-readable, e.g. "Color: Red · Type: Mini"
    priceDelta: variant?.delta || 0, // snapshot of selected options' total delta
    qty: Math.max(1, qty),
  });
  saveCart(cart);
}

export function setQty(productId, qty, variantKey = "") {
  let cart = getCart();
  const match = (l) => l.productId === productId && (l.variantKey || "") === (variantKey || "");
  if (qty <= 0) cart = cart.filter((l) => !match(l));
  else {
    const line = cart.find(match);
    if (line) line.qty = Math.min(99, qty);
  }
  saveCart(cart);
}

export function clearCart() {
  localStorage.removeItem(CART_KEY);
  // Drop the server mirror too — no cart, no reminder.
  try {
    const user = auth.currentUser;
    if (user) deleteDoc(doc(db, "carts", user.uid)).catch(() => {});
  } catch {}
}

export function cartCount() {
  return getCart().reduce((n, l) => n + (l.qty || 0), 0);
}

/* ---------------- pricing ---------------- */

// Returns { price, isPreorder, endsAt, upcomingPreorder, startsAt }.
// Handles Firestore Timestamps AND plain ISO strings (seed data).
export function getActivePrice(product, now = new Date()) {
  const start = toDate(product.preorderStartAt);
  const end = toDate(product.preorderEndsAt);
  const hasPreorder = product.preorderPrice != null && product.preorderPrice !== "";
  const live =
    hasPreorder && (!start || now >= start) && (!end || now <= end);
  if (live) {
    return { price: Number(product.preorderPrice), isPreorder: true, endsAt: end, startsAt: start };
  }
  const upcoming = hasPreorder && start && now < start;
  return {
    price: Number(product.price),
    isPreorder: false,
    upcomingPreorder: !!upcoming,
    startsAt: start,
  };
}

export function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

/* ---------------- variants ----------------
   Product doc shape:
   variants: [{ name: "Color", options: [{ label: "Black", priceDelta: 0 },
                                          { label: "Red", priceDelta: 1.5 }] },
              { name: "Type",  options: [{ label: "Standard", priceDelta: 0 },
                                          { label: "Mini", priceDelta: -1 }] }]
   selections: array of option indices, one per dimension (index 0 = first option). */

// Normalize a variants array into [{ name, options: [{ label, priceDelta, images }] }],
// dropping dimensions with no name/options and options with no label.
export function sanitizeVariants(variants) {
  if (!Array.isArray(variants)) return [];
  return variants
    .map((d) => ({
      name: String(d?.name || "").trim(),
      options: (Array.isArray(d?.options) ? d.options : [])
        .map((o) => ({
          label: String(o?.label || "").trim(),
          priceDelta: Number(o?.priceDelta) || 0,
          images: (Array.isArray(o?.images) ? o.images : [])
            .map((s) => String(s || "").trim())
            .filter(Boolean),
        }))
        .filter((o) => o.label),
    }))
    .filter((d) => d.name && d.options.length);
}

// Sum of the selected options' price deltas (can be negative).
export function variantDelta(variants, selections) {
  const vs = sanitizeVariants(variants);
  return round2(vs.reduce((sum, d, i) => {
    const opt = d.options[selections?.[i] ?? 0] || d.options[0];
    return sum + (opt ? opt.priceDelta : 0);
  }, 0));
}

// "Color: Red · Type: Mini" — empty string when there are no variants.
export function variantLabel(variants, selections) {
  return sanitizeVariants(variants)
    .map((d, i) => {
      const opt = d.options[selections?.[i] ?? 0] || d.options[0];
      return opt ? `${d.name}: ${opt.label}` : null;
    })
    .filter(Boolean)
    .join(" · ");
}

// Stable key so the same product+option combination merges into one cart line.
export function variantKey(variants, selections) {
  const vs = sanitizeVariants(variants);
  if (!vs.length) return "";
  return vs.map((d, i) => `${i}:${selections?.[i] ?? 0}`).join("|");
}

// Parse a variantKey back into a selections array (["0:2","1:0"] -> [2, 0]).
// Returns [] for empty/invalid keys.
export function selectionsFromKey(variantKey) {
  if (!variantKey) return [];
  return String(variantKey).split("|").map((part) => {
    const n = Number(part.split(":")[1]);
    return Number.isInteger(n) && n >= 0 ? n : 0;
  });
}

// Images for the current variant selection: the first dimension (in order)
// whose selected option has its own images wins. Returns null when no
// selected option carries images (caller falls back to product images).
export function variantImages(variants, selections) {
  const vs = sanitizeVariants(variants);
  for (let i = 0; i < vs.length; i++) {
    const opt = vs[i].options[selections?.[i] ?? 0] || vs[i].options[0];
    if (opt && opt.images && opt.images.length) return opt.images;
  }
  return null;
}

// " (+$1.50)" / " (−$1.00)" / "" — suffix for option dropdown labels.
export function deltaSuffix(delta) {
  const n = Number(delta) || 0;
  if (n === 0) return "";
  return n > 0 ? ` (+$${n.toFixed(2)})` : ` (−$${Math.abs(n).toFixed(2)})`;
}

/* ---------------- reads ---------------- */

export async function fetchProducts() {
  const snap = await getDocs(collection(db, "products"));
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter(isProductVisible)
    .sort((a, b) => {
      const ta = toDate(a.createdAt)?.getTime() || 0;
      const tb = toDate(b.createdAt)?.getTime() || 0;
      return ta - tb;
    });
}

export async function fetchProduct(id) {
  const snap = await getDoc(doc(db, "products", id));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function fetchDeals() {
  const snap = await getDocs(collection(db, "deals"));
  const now = new Date();
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((deal) => {
      if (deal.active === false) return false;
      const start = toDate(deal.startsAt);
      const end = toDate(deal.endsAt);
      return (!start || now >= start) && (!end || now <= end);
    });
}

// The currently active deal for a product (window-checked), or null.
// fetchDeals() already filters to active windows; this double-checks in
// case a caller passes an unfiltered list.
export function dealForProduct(productId, deals, now = new Date()) {
  for (const d of deals || []) {
    if (d.productId !== productId) continue;
    if (d.active === false) continue;
    const start = toDate(d.startsAt);
    const end = toDate(d.endsAt);
    if ((!start || now >= start) && (!end || now <= end)) return d;
  }
  return null;
}

// The price a customer is actually charged: an active deal wins, then the
// product's own preorder/regular tiers. Advertised and charged prices must
// always agree, so every price display and cart line goes through this.
export function chargedPrice(product, deals, now = new Date()) {
  const { price: basePrice, isPreorder, endsAt } = getActivePrice(product, now);
  const deal = dealForProduct(product.id, deals, now);
  if (deal && Number(deal.dealPrice) >= 0) {
    return { price: Number(deal.dealPrice), deal, isPreorder, endsAt };
  }
  return { price: basePrice, deal: null, isPreorder, endsAt };
}

export function productImage(product, ui) {
  // ui = the ui module's placeholderSVG (passed in to avoid a cycle)
  if (product.images && product.images.length) return product.images[0];
  return ui.placeholderSVG(product.name || "Product", 270, 320);
}
