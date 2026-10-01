// Shop domain logic: pricing tiers, cart (localStorage), product/deal reads.

import { collection, doc, getDoc, getDocs } from "firebase/firestore";
import { db } from "./firebase.js";
import { toDate } from "./ui.js";

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
}

export function addToCart(productId, qty = 1) {
  const cart = getCart();
  const line = cart.find((l) => l.productId === productId);
  if (line) line.qty = Math.min(99, line.qty + qty);
  else cart.push({ productId, qty: Math.max(1, qty) });
  saveCart(cart);
}

export function setQty(productId, qty) {
  let cart = getCart();
  if (qty <= 0) cart = cart.filter((l) => l.productId !== productId);
  else {
    const line = cart.find((l) => l.productId === productId);
    if (line) line.qty = Math.min(99, qty);
  }
  saveCart(cart);
}

export function clearCart() {
  localStorage.removeItem(CART_KEY);
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

/* ---------------- reads ---------------- */

export async function fetchProducts() {
  const snap = await getDocs(collection(db, "products"));
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((p) => p.active !== false)
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

export function productImage(product, ui) {
  // ui = the ui module's placeholderSVG (passed in to avoid a cycle)
  if (product.images && product.images.length) return product.images[0];
  return ui.placeholderSVG(product.name || "Fidget", 270, 320);
}
