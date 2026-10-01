// NextPrints Cloud Functions — EMAIL codebase (requires Gmail secrets).
//
// Needs Secret Manager secrets (set once by the shop owner):
//   firebase functions:secrets:set GMAIL_USER
//   firebase functions:secrets:set GMAIL_APP_PASSWORD
// The app password is created at myaccount.google.com → Security →
// 2-Step Verification → App passwords.

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { defineSecret } = require("firebase-functions/params");
const nodemailer = require("nodemailer");
const admin = require("firebase-admin");

admin.initializeApp();

const ADMIN_EMAIL = "legobele@gmail.com";
const VIP_ORDER_THRESHOLD = 10;
const SHOP_URL = "https://legobele.github.io/nextprints";

// Gmail SMTP credentials — must exist in Secret Manager before deploy.
const gmailUser = defineSecret("GMAIL_USER");
const gmailPass = defineSecret("GMAIL_APP_PASSWORD");

function esc(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function mailer() {
  return nodemailer.createTransport({
    service: "gmail",
    auth: { user: gmailUser.value(), pass: gmailPass.value() },
  });
}

function emailShell(inner) {
  return `<div style="font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;max-width:560px;margin:0 auto;color:#1e293b">
  <div style="padding:20px 24px;border-bottom:2px solid #1a56db"><strong style="font-size:18px">NextPrints</strong></div>
  <div style="padding:24px">${inner}</div>
  <div style="padding:16px 24px;color:#64748b;font-size:12px;border-top:1px solid #e2e8f0">
    You're getting this because you opted in to NextPrints emails.<br>
    <a href="${SHOP_URL}/account.html" style="color:#1a56db">Manage your preferences</a>
  </div></div>`;
}

async function sendMail({ to, subject, html }) {
  await mailer().sendMail({
    from: `NextPrints <${gmailUser.value()}>`,
    to,
    subject,
    html,
  });
}

function adminOnly(request) {
  const email = (request.auth && request.auth.token && request.auth.token.email) || "";
  if (email !== ADMIN_EMAIL) throw new HttpsError("permission-denied", "Admin only.");
}

function cleanTitle(s, max) {
  return String(s || "").trim().slice(0, max);
}

// Email blast to every opted-in subscriber (admin only).
exports.sendEmailBlast = onCall({ secrets: [gmailUser, gmailPass] }, async (request) => {
  adminOnly(request);
  const title = cleanTitle(request.data && request.data.title, 80);
  const body = cleanTitle(request.data && request.data.body, 500);
  if (!title || !body) throw new HttpsError("invalid-argument", "Title and message are required.");

  const prefsSnap = await admin
    .firestore()
    .collection("prefs")
    .where("emailMarketing", "==", true)
    .get();

  let sent = 0;
  for (const pref of prefsSnap.docs) {
    const userDoc = await admin.firestore().collection("users").doc(pref.id).get();
    const to = userDoc.data() && userDoc.data().email;
    if (!to) continue;
    const html = emailShell(
      `<h2 style="margin-top:0">${esc(title)}</h2><p>${esc(body)}</p>` +
        `<p><a href="${SHOP_URL}/" style="display:inline-block;background:#1a56db;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none">Shop the drop</a></p>`
    );
    try {
      await sendMail({ to, subject: title, html });
      sent++;
    } catch (e) {
      console.error("blast email failed for", pref.id, e.message);
    }
    await new Promise((r) => setTimeout(r, 300)); // gentle on Gmail rate limits
  }
  return { sent };
});

// Hourly: remind opted-in shoppers about carts untouched for 4+ hours.
// Skips carts already reminded, emptied carts, and carts followed by an order.
exports.checkAbandonedCarts = onSchedule(
  { schedule: "every 60 minutes", secrets: [gmailUser, gmailPass] },
  async () => {
    const cutoff = new Date(Date.now() - 4 * 60 * 60 * 1000);
    const snap = await admin.firestore().collection("carts").where("updatedAt", "<", cutoff).get();
    let sent = 0;
    for (const d of snap.docs) {
      const cart = d.data();
      if (cart.reminded || !cart.items || !cart.items.length) continue;
      const uid = d.id;
      const pref = await admin.firestore().collection("prefs").doc(uid).get();
      if (!pref.data() || !pref.data().emailMarketing) continue;

      const updatedMs =
        cart.updatedAt && typeof cart.updatedAt.toMillis === "function" ? cart.updatedAt.toMillis() : 0;
      const ordersSnap = await admin.firestore().collection("orders").where("userId", "==", uid).get();
      let orderedSince = false;
      ordersSnap.forEach((o) => {
        const t = o.data().createdAt && typeof o.data().createdAt.toMillis === "function"
          ? o.data().createdAt.toMillis() : 0;
        if (t > updatedMs) orderedSince = true;
      });
      if (orderedSince) {
        await d.ref.update({ reminded: true });
        continue;
      }

      const userDoc = await admin.firestore().collection("users").doc(uid).get();
      const to = userDoc.data() && userDoc.data().email;
      if (!to) continue;

      const lines = [];
      for (const item of cart.items) {
        const p = await admin.firestore().collection("products").doc(item.productId).get();
        const name = (p.data() && p.data().name) || "Item";
        lines.push(
          `<li>${esc(name)}${item.variantLabel ? ` — ${esc(item.variantLabel)}` : ""} × ${item.qty}</li>`
        );
      }
      const html = emailShell(
        `<h2 style="margin-top:0">You left items in your cart</h2><ul>${lines.join("")}</ul>` +
          `<p><a href="${SHOP_URL}/cart.html" style="display:inline-block;background:#1a56db;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none">Complete your order</a></p>`
      );
      try {
        await sendMail({ to, subject: "Your NextPrints cart is waiting", html });
        sent++;
      } catch (e) {
        console.error("abandoned-cart email failed for", uid, e.message);
      }
      await d.ref.update({ reminded: true });
      await new Promise((r) => setTimeout(r, 300));
    }
    console.log(`abandoned carts: ${sent} reminders sent`);
  }
);

// Welcome email on signup.
exports.sendWelcomeEmail = onDocumentCreated(
  { document: "users/{uid}", secrets: [gmailUser, gmailPass] },
  async (event) => {
    const data = (event.data && event.data.data()) || {};
    if (!data.email) return;
    const html = emailShell(
      `<h2 style="margin-top:0">Welcome to NextPrints</h2>` +
        `<p>Your account is ready. Verify your email (we sent you a link), then you're good to order.</p>` +
        `<p>Place ${VIP_ORDER_THRESHOLD} orders in a month to unlock <strong>VIP</strong> — deal alerts before everyone else, plus price-drop codes.</p>` +
        `<p><a href="${SHOP_URL}/" style="display:inline-block;background:#1a56db;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none">Start shopping</a></p>`
    );
    try {
      await sendMail({ to: data.email, subject: "Welcome to NextPrints", html });
    } catch (e) {
      console.error("welcome email failed", e.message);
    }
  }
);
