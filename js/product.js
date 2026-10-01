// Product detail: gallery, price tiers, quantity, add to cart.

import { BRAND_NAME } from "./config.js";
import { renderNav, escapeHtml, fmtMoney, fmtDate, toDate, startCountdowns, toast, placeholderSVG, updateCartBadge } from "./ui.js";
import { fetchProduct, getActivePrice, addToCart } from "./store.js";

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

  const now = new Date();
  const { price, isPreorder, endsAt, upcomingPreorder, startsAt } = getActivePrice(p, now);
  const images = (p.images && p.images.length ? p.images : [placeholderSVG(p.name, 270, 320)]);

  let tierHTML;
  if (isPreorder) {
    tierHTML = `
      <div class="tier-box">
        <div class="row"><span>🔥 Preorder price</span><strong>${fmtMoney(price)}</strong></div>
        <div class="row"><span>Regular price after</span><span>${fmtMoney(p.price)}</span></div>
        ${endsAt ? `<div class="row"><span>Preorder ends</span><span class="countdown"><span data-countdown-to="${endsAt.getTime()}"></span> (${fmtDate(endsAt)})</span></div>` : ""}
      </div>`;
  } else if (upcomingPreorder && startsAt) {
    tierHTML = `
      <div class="tier-box">
        <div class="row"><span>💤 Preorders open</span><strong>${fmtDate(startsAt)}</strong></div>
        <div class="row"><span>Preorder price</span><span>${fmtMoney(p.preorderPrice)}</span></div>
        <div class="row"><span>Regular price</span><span>${fmtMoney(p.price)}</span></div>
      </div>`;
  } else {
    tierHTML = `
      <div class="tier-box">
        <div class="row"><span>Price</span><strong>${fmtMoney(price)}</strong></div>
      </div>`;
  }

  app.innerHTML = `
    <p><a href="index.html">← Back to shop</a></p>
    <div class="product-detail">
      <div class="gallery">
        <img class="main" id="main-img" src="${escapeHtml(images[0])}" alt="${escapeHtml(p.name)}">
        ${images.length > 1 ? `<div class="thumbs">${images.map((src, i) =>
          `<img src="${escapeHtml(src)}" data-i="${i}" class="${i === 0 ? "sel" : ""}" alt="photo ${i + 1}">`).join("")}</div>` : ""}
      </div>
      <div>
        ${isPreorder ? `<span class="badge preorder">Preorder live</span>` : ""}
        <h1 style="margin:8px 0">${escapeHtml(p.name)}</h1>
        ${p.colorsNote ? `<p style="color:var(--muted)">${escapeHtml(p.colorsNote)}</p>` : ""}
        ${tierHTML}
        <p>${escapeHtml(p.description || "")}</p>
        <div class="qty-stepper">
          <button id="qty-minus" aria-label="decrease">−</button>
          <span id="qty-val">1</span>
          <button id="qty-plus" aria-label="increase">+</button>
        </div>
        <button class="btn" id="add-btn">Add to cart · <span id="add-total">${fmtMoney(price)}</span></button>
        <p style="color:var(--muted);font-size:0.9rem;margin-top:12px">💵 No online payment — you pay cash on pickup/delivery.</p>
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

  // Quantity stepper
  let qty = 1;
  const qtyVal = document.getElementById("qty-val");
  const addTotal = document.getElementById("add-total");
  const sync = () => { qtyVal.textContent = qty; addTotal.textContent = fmtMoney(price * qty); };
  document.getElementById("qty-minus").addEventListener("click", () => { if (qty > 1) { qty--; sync(); } });
  document.getElementById("qty-plus").addEventListener("click", () => { if (qty < 99) { qty++; sync(); } });

  document.getElementById("add-btn").addEventListener("click", () => {
    addToCart(p.id, qty);
    updateCartBadge();
    toast(`Added ${qty} × ${p.name} to cart`);
  });

  startCountdowns();
}

main();
