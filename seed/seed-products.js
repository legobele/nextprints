// Demo seed data for the fidget shop.
//
// Run it by opening admin.html (signed in as the admin) and clicking
// "🌱 Seed demo products" — that button imports this module.
// (You can also paste this file's body into the browser console on any
// shop page, as long as `db` from js/firebase.js is in scope.)

import { collection, addDoc, Timestamp, serverTimestamp } from "firebase/firestore";

// Placeholder product art until real photos are uploaded (data-URI SVG).
function svgPlaceholder(label, hueA, hueB) {
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

const T = (iso) => Timestamp.fromDate(new Date(iso));

const PRODUCTS = [
  {
    name: "Gear Shifter Fidget",
    description:
      "A fidgety little manual-transmission shifter with a satisfying H-pattern gate. " +
      "Printed in black PLA. Preorder now for $3 — goes up to $4 after Oct 2.",
    colorsNote: "Black only · delivery from Oct 7, 2026",
    price: 4.0,
    preorderPrice: 3.0,
    preorderStartAt: null, // live immediately
    preorderEndsAt: T("2026-10-02T23:59:59-04:00"),
    images: [svgPlaceholder("Gear Shifter · Black", 260, 300)],
    active: true,
  },
  {
    name: "Gear Shifter Fidget — Plain Colors",
    description:
      "The same shifter, now in color. One solid color (non-black) — pick your vibe. " +
      "Preorders open Oct 15–20 at $7, then $10 after.",
    colorsNote: "One color (non-black) · colors ~Oct 30",
    price: 10.0,
    preorderPrice: 7.0,
    preorderStartAt: T("2026-10-15T00:00:00-04:00"),
    preorderEndsAt: T("2026-10-20T23:59:59-04:00"),
    images: [svgPlaceholder("Gear Shifter · Colors", 200, 260)],
    active: true,
  },
  {
    name: "Gear Shifter Fidget — Multicolor",
    description:
      "Full multicolor print — multiple colors in a single print. " +
      "Preorders Nov 7–12 at $12, then $15 after. Delivery Dec 1, 2026 — just in time for the holidays.",
    colorsNote: "Multicolor print · delivery Dec 1, 2026",
    price: 15.0,
    preorderPrice: 12.0,
    preorderStartAt: T("2026-11-07T00:00:00-04:00"),
    preorderEndsAt: T("2026-11-12T23:59:59-04:00"),
    images: [svgPlaceholder("Gear Shifter · Multicolor", 320, 180)],
    active: true,
  },
];

export async function seedProducts(db) {
  const ids = [];
  for (const p of PRODUCTS) {
    const ref = await addDoc(collection(db, "products"), {
      ...p,
      createdAt: serverTimestamp(),
    });
    ids.push(ref.id);
    console.log("seeded:", p.name, "→", ref.id);
  }
  return ids;
}
