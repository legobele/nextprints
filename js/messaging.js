// Deal-alert push notifications (Firebase Cloud Messaging).
//
// Flow: customer opts in → we get an FCM token → the registerFcmToken Cloud
// Function subscribes the token to the "deals-all" topic (plus "deals-vip"
// when the customer has VIP status). Blasts are sent per topic, so VIPs can
// get alerts before everyone else. Topic subscribe/unsubscribe needs the
// Admin SDK, which is why the Cloud Function does it — the web client can't.

import { getMessaging, getToken, onMessage, isSupported } from "firebase/messaging";
import { getFunctions, httpsCallable } from "firebase/functions";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "./firebase.js";
import { VAPID_KEY, BRAND_NAME } from "./config.js";

const BANNER_DISMISSED_KEY = "np_push_banner_dismissed";
const SW_PATH = "firebase-messaging-sw.js";

let messaging = null;
let supported = false;
let readyResolve = null;
const ready = new Promise((r) => { readyResolve = r; });

function vapidReady() {
  return !!VAPID_KEY && !VAPID_KEY.startsWith("__");
}

// Register (or refresh) this device's token with the backend. Idempotent —
// safe to call on every page load; the function also re-checks VIP status.
async function registerToken() {
  if (!supported || !vapidReady() || !auth.currentUser) return null;
  const reg = await navigator.serviceWorker.ready;
  const token = await getToken(messaging, { vapidKey: VAPID_KEY, serviceWorkerRegistration: reg });
  const res = await httpsCallable(getFunctions(), "registerFcmToken")({ token });
  return res.data; // { vip, topics }
}

// Small in-page notice for messages that arrive while the site is open.
function foregroundToast(title, body) {
  const el = document.createElement("div");
  el.className = "push-toast";
  el.innerHTML = `<strong></strong><span></span>`;
  el.querySelector("strong").textContent = title;
  el.querySelector("span").textContent = body;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add("show"));
  setTimeout(() => {
    el.classList.remove("show");
    setTimeout(() => el.remove(), 400);
  }, 6000);
}

function showOptInBanner() {
  if (localStorage.getItem(BANNER_DISMISSED_KEY)) return;
  if (document.querySelector(".push-banner")) return;
  const el = document.createElement("div");
  el.className = "push-banner";
  el.innerHTML = `
    <div class="push-banner-text">
      <strong>Get deal alerts</strong>
      <span>Enable notifications to hear about drops and price cuts first.</span>
    </div>
    <div class="push-banner-actions">
      <button class="btn small" data-act="enable">Enable</button>
      <button class="btn small ghost" data-act="dismiss">Not now</button>
    </div>`;
  document.body.prepend(el);
  el.querySelector('[data-act="enable"]').addEventListener("click", async () => {
    const perm = await Notification.requestPermission();
    el.remove();
    if (perm === "granted") {
      try {
        const data = await registerToken();
        foregroundToast(
          BRAND_NAME,
          data && data.vip
            ? "Deal alerts on — and you're VIP, so you hear about drops first."
            : "Deal alerts on. You'll hear about drops and price cuts here."
        );
      } catch (e) {
        console.error(e);
        foregroundToast(BRAND_NAME, "Couldn't finish setup — try again from your account page.");
      }
    }
  });
  el.querySelector('[data-act="dismiss"]').addEventListener("click", () => {
    localStorage.setItem(BANNER_DISMISSED_KEY, "1");
    el.remove();
  });
}

// Call once per page load (after the maintenance gate). Wires foreground
// handling, refreshes the token when signed in, and shows the opt-in banner
// to signed-in customers who haven't decided yet.
export async function setupPush() {
  try {
    try {
      supported = await isSupported();
    } catch {
      supported = false;
    }
    if (!supported || !("Notification" in window) || !("serviceWorker" in navigator)) return;
    if (!vapidReady()) return;
    try {
      await navigator.serviceWorker.register(SW_PATH);
    } catch (e) {
      console.error("push service worker failed", e);
      return;
    }
    messaging = getMessaging();
    onMessage(messaging, (payload) => {
      const n = payload.notification || {};
      foregroundToast(n.title || BRAND_NAME, n.body || "");
    });
    onAuthStateChanged(auth, (user) => {
      if (!user) return;
      if (Notification.permission === "granted") {
        registerToken().catch((e) => console.error("push register failed", e));
      } else if (Notification.permission === "default") {
        showOptInBanner();
      }
    });
  } finally {
    readyResolve();
  }
}

// Account-page controls ------------------------------------------------

export async function pushPermissionState() {
  await ready;
  if (!supported || !("Notification" in window)) return "unsupported";
  return Notification.permission; // "granted" | "denied" | "default"
}

// Returns { permission, vip?, topics? }.
export async function enablePush() {
  await ready;
  if (!supported) throw new Error("unsupported");
  const perm = await Notification.requestPermission();
  if (perm !== "granted") return { permission: perm };
  const data = await registerToken();
  return { permission: perm, ...(data || {}) };
}
