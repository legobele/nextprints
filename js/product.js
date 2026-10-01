// Product detail: gallery, price tiers, quantity, add to cart.

import { BRAND_NAME } from "./config.js";
import { renderNav, escapeHtml, fmtMoney, fmtDate, toDate, isProductVisible, startCountdowns, fmtEstimatedDelivery, toast, placeholderSVG, updateCartBadge } from "./ui.js";
import { fetchProduct, fetchDeals, chargedPrice, addToCart, sanitizeVariants, variantDelta, variantLabel, variantKey, variantImages, deltaSuffix, round2 } from "./store.js";
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
  if (!p || !isProductVisible(p)) {
    app.innerHTML = `<div class="empty">Product not found. <a href="index.html">Back to shop</a></div>`;
    return;
  }
  document.title = `${p.name} · ${BRAND_NAME}`;

  let reviews = [];
  try {
    const rsnap = await getDocs(query(collection(db, "reviews"), where("productId", "==", p.id)));
    reviews = rsnap.docs.map((d) => d.data());
  } catch (e) { console.warn("reviews load failed", e); }

  // Reviews are restricted to verified students; signed-out visitors get the
  // empty state ("No reviews yet") instead of an error or a hang.
  let deals = [];
  try { deals = await fetchDeals(); } catch (e) { console.warn("deals load failed", e); }

  const now = new Date();
  const { price, deal, isPreorder, endsAt } = chargedPrice(p, deals, now);
  const dealEnd = deal ? toDate(deal.endsAt) : null;
  const productImages = (p.images && p.images.length ? p.images : [placeholderSVG(p.name, 270, 320)]);
  const variants = sanitizeVariants(p.variants);
  // First option of each dimension is preselected, so add-to-cart always works.
  const selections = variants.map(() => 0);
  // Variant images win over product images: the first dimension (in order)
  // whose selected option has its own photos drives the gallery.
  const galleryImages = () => variantImages(variants, selections) || productImages;

  let tierHTML;
  if (deal) {
    // An active deal is the charged price (and the advertised one) — it wins
    // over preorder/regular tiers.
    tierHTML = `
      <div class="tier-box">
        <div class="row"><span>Limited deal</span><strong>${fmtMoney(price)}</strong></div>
        <div class="row"><span>Regular price</span><span>${fmtMoney(p.price)}</span></div>
        ${dealEnd ? `<div class="row"><span>Deal ends</span><span class="countdown"><span data-countdown-to="${dealEnd.getTime()}"></span> (${fmtDate(dealEnd)})</span></div>` : ""}
      </div>`;
  } else if (isPreorder) {
    tierHTML = `
      <div class="tier-box">
        <div class="row"><span>Pre-order price</span><strong>${fmtMoney(price)}</strong></div>
        <div class="row"><span>Regular price after pre-order</span><span>${fmtMoney(p.price)}</span></div>
        ${endsAt ? `<div class="row"><span>Pre-order ends</span><span class="countdown"><span data-countdown-to="${endsAt.getTime()}"></span> (${fmtDate(endsAt)})</span></div>` : ""}
      </div>`;
  } else {
    // Scheduled products are hidden entirely by isProductVisible(), so there
    // is no "upcoming preorder" branch here.
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
      <div class="gallery" id="gallery"></div>
      <div>
        ${isPreorder ? `<span class="badge preorder">Pre-order</span>` : ""}
        ${deal ? `<span class="badge deal">Limited deal</span>` : ""}
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

  // Gallery: re-rendered whenever the variant selection changes so each
  // option can show its own photos (falling back to product images).
  function renderGallery() {
    const imgs = galleryImages();
    const g = document.getElementById("gallery");
    g.innerHTML = `
      <img class="main" id="main-img" src="${escapeHtml(imgs[0])}" alt="${escapeHtml(p.name)}">
      ${imgs.length > 1 ? `<div class="thumbs">${imgs.map((src, i) =>
        `<img src="${escapeHtml(src)}" data-i="${i}" class="${i === 0 ? "sel" : ""}" alt="photo ${i + 1}">`).join("")}</div>` : ""}`;
    g.querySelectorAll(".thumbs img").forEach((t) => {
      t.addEventListener("click", () => {
        document.getElementById("main-img").src = imgs[Number(t.dataset.i)];
        g.querySelectorAll(".thumbs img").forEach((x) => x.classList.remove("sel"));
        t.classList.add("sel");
      });
    });
  }
  renderGallery();

  // Quantity stepper + variant-aware pricing.
  let qty = 1;
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

  // Variant dropdowns live-update the price and swap the gallery to the
  // selected option's photos (when it has its own).
  app.querySelectorAll("[data-variant]").forEach((sel) => {
    sel.addEventListener("change", () => {
      selections[Number(sel.dataset.variant)] = Number(sel.value) || 0;
      renderGallery();
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
