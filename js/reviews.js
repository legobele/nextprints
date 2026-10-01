// Product reviews: prompt after delivery, store in /reviews, show averages.
//
// The prompt runs in-app (see maybePromptReview, called from ui.js after
// sign-in): when a customer with a delivered order opens the site, they get
// one modal per unreviewed product. True push notifications would need
// Firebase Cloud Messaging (VAPID key + service worker) — out of scope.

import { collection, getDocs, addDoc, query, where, serverTimestamp } from "firebase/firestore";
import { db } from "./firebase.js";
import { escapeHtml, toast } from "./ui.js";

const dismissed = new Set(); // productIds the user skipped this session

export async function fetchReviews() {
  const snap = await getDocs(collection(db, "reviews"));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export function ratingSummary(reviews, productId) {
  const rs = reviews.filter(
    (r) => r.productId === productId && Number(r.rating) >= 1 && Number(r.rating) <= 5
  );
  if (!rs.length) return null;
  const avg = rs.reduce((n, r) => n + Number(r.rating), 0) / rs.length;
  return { avg: Math.round(avg * 10) / 10, count: rs.length };
}

export function ratingLineHTML(reviews, productId) {
  const s = ratingSummary(reviews, productId);
  if (!s) return `<span class="rating-none">No reviews yet</span>`;
  return `<span class="rating-line">★ ${s.avg} <span class="rating-count">(${s.count} review${s.count === 1 ? "" : "s"})</span></span>`;
}

// Find the first delivered-order product this user hasn't reviewed and prompt.
export async function maybePromptReview(user) {
  if (!user || !user.emailVerified) return;
  try {
    const [ordersSnap, reviewsSnap] = await Promise.all([
      getDocs(query(collection(db, "orders"), where("userId", "==", user.uid))),
      getDocs(query(collection(db, "reviews"), where("userId", "==", user.uid))),
    ]);
    const reviewed = new Set(reviewsSnap.docs.map((d) => d.data().productId));
    const delivered = ordersSnap.docs.map((d) => d.data()).filter((o) => o.status === "delivered");
    for (const o of delivered) {
      for (const item of o.items || []) {
        const pid = item.productId;
        if (pid && !reviewed.has(pid) && !dismissed.has(pid)) {
          showReviewModal(user, pid, item.name || "this product");
          return; // one prompt at a time
        }
      }
    }
  } catch (e) {
    console.warn("review prompt failed", e);
  }
}

function showReviewModal(user, productId, productName) {
  let rating = 0;
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal" role="dialog" aria-label="Review product">
      <h3>How was your order?</h3>
      <p style="color:var(--muted);margin-top:0">Please rate <strong>${escapeHtml(productName)}</strong>.</p>
      <div class="stars" id="rv-stars">
        ${[1, 2, 3, 4, 5].map((n) => `<button type="button" data-star="${n}" aria-label="${n} star${n > 1 ? "s" : ""}">★</button>`).join("")}
      </div>
      <label>Comments (optional)<textarea id="rv-comment" placeholder="Anything we should know?"></textarea></label>
      <p id="rv-err" style="color:var(--red);font-size:0.9rem" hidden>Please select a star rating.</p>
      <div style="display:flex;gap:8px;margin-top:12px">
        <button class="btn" id="rv-submit">Submit review</button>
        <button class="btn ghost" id="rv-later">Maybe later</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const stars = overlay.querySelectorAll("[data-star]");
  const paint = () => stars.forEach((b) => b.classList.toggle("lit", Number(b.dataset.star) <= rating));
  stars.forEach((b) => b.addEventListener("click", () => {
    rating = Number(b.dataset.star);
    overlay.querySelector("#rv-err").hidden = true;
    paint();
  }));

  overlay.querySelector("#rv-later").addEventListener("click", () => {
    dismissed.add(productId);
    overlay.remove();
  });

  overlay.querySelector("#rv-submit").addEventListener("click", async () => {
    if (rating < 1) {
      overlay.querySelector("#rv-err").hidden = false;
      return;
    }
    const comment = overlay.querySelector("#rv-comment").value.trim();
    const btn = overlay.querySelector("#rv-submit");
    btn.disabled = true;
    try {
      await addDoc(collection(db, "reviews"), {
        productId,
        userId: user.uid,
        email: user.email,
        rating,
        comment,
        createdAt: serverTimestamp(),
      });
      overlay.remove();
      toast("Thanks for your review.");
    } catch (e) {
      console.error(e);
      toast("Couldn't submit the review. Please try again.");
      btn.disabled = false;
    }
  });
}
