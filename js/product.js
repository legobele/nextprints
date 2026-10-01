// Product detail: gallery, price tiers, quantity, add to cart.

import { BRAND_NAME } from "./config.js";
import { renderNav, escapeHtml, fmtMoney, fmtDate, toDate, startCountdowns, fmtEstimatedDelivery, toast, placeholderSVG, updateCartBadge } from "./ui.js";
import { fetchProduct, getActivePrice, addToCart, sanitizeVariants, variantDelta, variantLabel, variantKey, deltaSuffix, round2 } from "./store.js";
import { ratingLineHTML } from "./reviews.js";
import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "./firebase.js";

renderNav("shop");

async function main() {
  const app = document.getElementById("app");
  const id = new URLSearchParams(location.search).get("id");
  if (!id) {
    app.innerHTML = `<div class="empty">No product selected. <a href="index.html">Back to shop</a></div>`;
    return;
  }
  let p;
  try {
    p = await fetchProduct(id);
  } catch (err) {
    console.error(err);
  }
  if (!p) {
    app.innerHTML = `<div class="empty">Product not found. <a href="index.html">Back to shop</a></div>`;
    return;
  }
  document.title = `${p.name} · ${BRAND_NAME}`;

  let reviews = [];
  try {
    const rsnap = await getDocs(query(collection(db, "reviews"), where("productId", "==", p.id)));
    reviews = rsnap.docs.map((d) => d.data());
  } catch (e) { console.warn("reviews load failed", e); }

  const now = new Date();
  const { price, isPreorder, endsAt, upcomingPreorder, startsAt } = getActivePrice(p, now);
  const images = (p.images && p.images.length ? p.images : [placeholderSVG(p.name, 270, 320)]);
  const variants = sanitizeVariants(p.variants);

  let tierHTML;
  if (isPreorder) {
    tierHTML = `
      <div class="tier-box">
        <div class="row"><span>Pre-order price</span><strong>${fmtMoney(price)}</strong></div>
        <div class="row"><span>Regular price after pre-order</span><span>${fmtMoney(p.price)}</span></div>
        ${endsAt ? `<div class="row"><span>Pre-order ends</span><span class="countdown"><span data-countdown-to="${endsAt.getTime()}"></span> (${fmtDate(endsAt)})</span></div>` : ""}
      </div>`;
  } else if (upcomingPreorder && startsAt) {
    tierHTML = `
      <div class="tier-box">
        <div class="row"><span>Pre-orders open</span><strong>${fmtDate(startsAt)}</strong></div>
        <div class="row"><span>Pre-order price</span><span>${fmtMoney(p.preorderPrice)}</span></div>
        <div class="row"><span>Regular price</span><span>${fmtMoney(p.price)}</span></div>
      </div>`;
  } else {
    tierHTML = `
      <div class="tier-box">
        <div class="row"><span>Price</span><strong>${fmtMoney(price)}</strong></div>
      </div>`;
  }

  const specRows = [
    p.leadTimeDays != null ? ["Estimated delivery", fmtEstimatedDelivery(p.leadTimeDays)] : null,
    ["Payment", "Cash on pickup or delivery"],
  ].filter(Boolean);
  const specHTML = `
    <table class="spec-table">
      <tbody>
        ${specRows.map(([k, v]) => `<tr><th>${escapeHtml(k)}</th><td>${escapeHtml(v)}</td></tr>`).join("")}
      </tbody>
    </table>`;

  app.innerHTML = `
    <p><a href="index.html">← Back to shop</a></p>
    <div class="product-detail">
      <div class="gallery">
        <img class="main" id="main-img" src="${escapeHtml(images[0])}" alt="${escapeHtml(p.name)}">
        ${images.length > 1 ? `<div class="thumbs">${images.map((src, i) =>
          `<img src="${escapeHtml(src)}" data-i="${i}" class="${i === 0 ? "sel" : ""}" alt="photo ${i + 1}">`).join("")}</div>` : ""}
      </div>
      <div>
        ${isPreorder ? `<span class="badge preorder">Pre-order</span>` : ""}
        <h1 style="margin:8px 0">${escapeHtml(p.name)}</h1>
        ${ratingLineHTML(reviews, p.id)}
        ${p.colorsNote ? `<p style="color:var(--muted)">${escapeHtml(p.colorsNote)}</p>` : ""}
        ${tierHTML}
        ${variants.length ? `
        <div class="variant-block">
          ${variants.map((d, i) => `
            <label>${escapeHtml(d.name)}
              <select data-variant="${i}">
                ${d.options.map((o, j) => `<option value="${j}">${escapeHtml(o.label)}${escapeHtml(deltaSuffix(o.priceDelta))}</option>`).join("")}
              </select>
            </label>`).join("")}
          <p class="variant-summary" id="variant-summary"></p>
        </div>` : ""}
        <p>${escapeHtml(p.description || "")}</p>
        ${specHTML}
        <div class="qty-stepper">
          <button id="qty-minus" aria-label="decrease">−</button>
          <span id="qty-val">1</span>
          <button id="qty-plus" aria-label="increase">+</button>
        </div>
        <button class="btn" id="add-btn">Add to cart · <span id="add-total">${fmtMoney(price)}</span></button>
        <p style="color:var(--muted);font-size:0.9rem;margin-top:12px">No online payment — pay cash on pickup or delivery.</p>
      </div>
    </div>`;

  // Gallery thumbs
  app.querySelectorAll(".thumbs img").forEach((t) => {
    t.addEventListener("click", () => {
      document.getElementById("main-img").src = images[Number(t.dataset.i)];
      app.querySelectorAll(".thumbs img").forEach((x) => x.classList.remove("sel"));
      t.classList.add("sel");
    });
  });

  // Quantity stepper + variant-aware pricing.
  // First option of each dimension is preselected, so add-to-cart always works.
  let qty = 1;
  const selections = variants.map(() => 0);
  const unitPrice = () => round2(price + variantDelta(variants, selections));
  const qtyVal = document.getElementById("qty-val");
  const addTotal = document.getElementById("add-total");
  const variantSummary = document.getElementById("variant-summary");
  const sync = () => {
    qtyVal.textContent = qty;
    addTotal.textContent = fmtMoney(unitPrice() * qty);
    if (variantSummary) {
      variantSummary.innerHTML =
        `<strong>${escapeHtml(variantLabel(variants, selections))}</strong> — ${fmtMoney(unitPrice())} each`;
    }
  };
  document.getElementById("qty-minus").addEventListener("click", () => { if (qty > 1) { qty--; sync(); } });
  document.getElementById("qty-plus").addEventListener("click", () => { if (qty < 99) { qty++; sync(); } });

  // Variant dropdowns live-update the price.
  app.querySelectorAll("[data-variant]").forEach((sel) => {
    sel.addEventListener("change", () => {
      selections[Number(sel.dataset.variant)] = Number(sel.value) || 0;
      sync();
    });
  });
  sync();

  document.getElementById("add-btn").addEventListener("click", () => {
    const v = variants.length ? {
      key: variantKey(variants, selections),
      label: variantLabel(variants, selections),
      delta: variantDelta(variants, selections),
    } : null;
    addToCart(p.id, qty, v);
    updateCartBadge();
    toast(`Added ${qty} × ${p.name}${v ? ` (${v.label})` : ""} to cart`);
  });

  startCountdowns();
}

main();
