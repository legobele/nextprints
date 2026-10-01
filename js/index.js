// Storefront: hero, live-preorder rail, product grid, limited deals.

import { BRAND_NAME } from "./config.js";
import { renderNav, escapeHtml, fmtMoney, fmtDate, fmtEstimatedDelivery, toDate, startCountdowns, placeholderSVG } from "./ui.js";
import { fetchProducts, fetchDeals, getActivePrice } from "./store.js";
import { fetchReviews, ratingLineHTML } from "./reviews.js";

renderNav("shop");
document.title = `${BRAND_NAME} · Shop`;
document.getElementById("hero-title").textContent = BRAND_NAME;

function cardHTML(p, reviews) {
  const now = new Date();
  const { price, isPreorder, endsAt, upcomingPreorder, startsAt } = getActivePrice(p, now);
  const img = (p.images && p.images.length ? p.images[0] : placeholderSVG(p.name, 270, 320));
  const badge = isPreorder
    ? `<span class="badge preorder">Pre-order</span>
       ${endsAt ? `<span class="countdown">Ends <span data-countdown-to="${endsAt.getTime()}"></span></span>` : ""}`
    : upcomingPreorder && startsAt
    ? `<span class="badge soon">Pre-orders open ${fmtDate(startsAt)}</span>`
    : "";
  const priceRow = isPreorder
    ? `<div class="price-row"><span class="price">${fmtMoney(price)}</span><span class="price strike">${fmtMoney(p.price)}</span></div>`
    : `<div class="price-row"><span class="price">${fmtMoney(price)}</span></div>`;
  const eta = fmtEstimatedDelivery(p.leadTimeDays);
  const delivery = eta
    ? `<p class="delivery-note">Estimated delivery: <strong>${escapeHtml(eta)}</strong></p>`
    : "";
  return `
    <a class="card" href="product.html?id=${encodeURIComponent(p.id)}" style="color:inherit">
      <img src="${escapeHtml(img)}" alt="${escapeHtml(p.name)}" loading="lazy">
      <div class="card-body">
        ${badge}
        <h3>${escapeHtml(p.name)}</h3>
        ${ratingLineHTML(reviews, p.id)}
        ${p.colorsNote ? `<p class="desc">${escapeHtml(p.colorsNote)}</p>` : ""}
        ${priceRow}
        ${delivery}
      </div>
    </a>`;
}

async function main() {
  const loading = document.getElementById("loading");
  try {
    const [products, deals, reviews] = await Promise.all([fetchProducts(), fetchDeals(), fetchReviews().catch(() => [])]);
    loading.hidden = true;

    // Deals section
    const dealsSection = document.getElementById("deals-section");
    if (deals.length) {
      const byId = Object.fromEntries(products.map((p) => [p.id, p]));
      const cards = deals
        .map((d) => {
          const p = byId[d.productId];
          if (!p) return "";
          const img = (p.images && p.images.length ? p.images[0] : placeholderSVG(p.name, 190, 230));
          const end = toDate(d.endsAt);
          return `
            <a class="card" href="product.html?id=${encodeURIComponent(p.id)}" style="color:inherit">
              <img src="${escapeHtml(img)}" alt="${escapeHtml(p.name)}" loading="lazy">
              <div class="card-body">
                <span class="badge deal">Limited deal</span>
                <h3>${escapeHtml(d.title)}</h3>
                <p class="desc">${escapeHtml(p.name)}</p>
                <div class="price-row"><span class="price">${fmtMoney(d.dealPrice)}</span><span class="price strike">${fmtMoney(p.price)}</span></div>
                ${end ? `<span class="countdown">ends in <span data-countdown-to="${end.getTime()}"></span></span>` : ""}
              </div>
            </a>`;
        })
        .join("");
      if (cards) {
        dealsSection.innerHTML = `<h2 class="section-title">Limited-time deals</h2><div class="grid">${cards}</div>`;
      }
    }

    // Live preorders rail
    const now = new Date();
    const live = products.filter((p) => getActivePrice(p, now).isPreorder);
    if (live.length) {
      document.getElementById("preorders-heading").hidden = false;
      document.getElementById("preorder-grid").innerHTML = live.map((p) => cardHTML(p, reviews)).join("");
    }

    // Full grid
    const grid = document.getElementById("product-grid");
    grid.innerHTML = products.length
      ? products.map((p) => cardHTML(p, reviews)).join("")
      : `<div class="empty">No products available at this time. Please check back later.</div>`;

    startCountdowns();
  } catch (err) {
    console.error(err);
    loading.textContent = "Couldn't load products. Check your Firebase config (see README.md).";
  }
}

main();
