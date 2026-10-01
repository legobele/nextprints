// Account: signup (school-email only) / login / logout / email verification.

import {
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendEmailVerification,
  signOut,
} from "firebase/auth";
import { doc, setDoc, serverTimestamp, collection, query, where, getDocs } from "firebase/firestore";
import { auth, db } from "./firebase.js";
import { BRAND_NAME, SCHOOL_DOMAIN, ADMIN_EMAIL, VIP_ORDER_THRESHOLD } from "./config.js";
import { renderNav, escapeHtml, toast } from "./ui.js";
import { pushPermissionState, enablePush } from "./messaging.js";

renderNav("account");
document.title = `Account · ${BRAND_NAME}`;

function schoolEmailOK(email) {
  const e = email.trim().toLowerCase();
  // The shop owner signs up with a non-school email; everyone else needs @intermetro.edu.
  return e.endsWith(`@${SCHOOL_DOMAIN}`) || e === ADMIN_EMAIL.toLowerCase();
}

function authFormsHTML(mode) {
  return `
    <div class="auth-card">
      <div class="auth-tabs">
        <button id="tab-login" class="${mode === "login" ? "active" : ""}">Log in</button>
        <button id="tab-signup" class="${mode === "signup" ? "active" : ""}">Sign up</button>
      </div>
      <div id="form-login" ${mode === "login" ? "" : "hidden"}>
        <label>School email<input id="li-email" type="email" placeholder="you@${SCHOOL_DOMAIN}" autocomplete="email"></label>
        <label>Password<input id="li-pass" type="password" autocomplete="current-password"></label>
        <button class="btn" id="li-go" style="width:100%">Log in</button>
      </div>
      <div id="form-signup" ${mode === "signup" ? "" : "hidden"}>
        <label>School email<input id="su-email" type="email" placeholder="you@${SCHOOL_DOMAIN}" autocomplete="email"></label>
        <p style="color:var(--muted);font-size:0.85rem;margin:0 0 8px">Must be your <strong>@${escapeHtml(SCHOOL_DOMAIN)}</strong> address — it's how we know you're from school.</p>
        <label>Password (6+ characters)<input id="su-pass" type="password" autocomplete="new-password"></label>
        <button class="btn" id="su-go" style="width:100%">Create account</button>
      </div>
      <p id="auth-err" style="color:var(--red);font-size:0.9rem"></p>
    </div>`;
}

function wireForms(mode, setMode) {
  const err = (m) => { document.getElementById("auth-err").textContent = m; };
  document.getElementById("tab-login").addEventListener("click", () => setMode("login"));
  document.getElementById("tab-signup").addEventListener("click", () => setMode("signup"));

  document.getElementById("li-go").addEventListener("click", async () => {
    err("");
    const email = document.getElementById("li-email").value.trim();
    const pass = document.getElementById("li-pass").value;
    try {
      await signInWithEmailAndPassword(auth, email, pass);
    } catch (e) {
      console.error(e);
      err(friendlyAuthError(e));
    }
  });

  document.getElementById("su-go").addEventListener("click", async () => {
    err("");
    const email = document.getElementById("su-email").value.trim();
    const pass = document.getElementById("su-pass").value;
    if (!schoolEmailOK(email)) { err(`Use your @${SCHOOL_DOMAIN} email.`); return; }
    if (pass.length < 6) { err("Password needs at least 6 characters."); return; }
    try {
      const cred = await createUserWithEmailAndPassword(auth, email, pass);
      // Verification email goes out immediately; checkout is blocked until verified.
      await sendEmailVerification(cred.user);
      // Create the user profile doc (allowed by firestore.rules for own uid).
      await setDoc(doc(db, "users", cred.user.uid), {
        email: cred.user.email,
        createdAt: serverTimestamp(),
      });
      toast("Account created — check your inbox for the verification email.");
    } catch (e) {
      console.error(e);
      err(friendlyAuthError(e));
    }
  });
}

function friendlyAuthError(e) {
  const code = e.code || "";
  if (code.includes("email-already-in-use")) return "That email already has an account — try logging in.";
  if (code.includes("invalid-credential") || code.includes("wrong-password") || code.includes("user-not-found"))
    return "Wrong email or password.";
  if (code.includes("invalid-email")) return "That doesn't look like a valid email.";
  if (code.includes("too-many-requests")) return "Too many tries — wait a bit and try again.";
  return e.message || "Something went wrong.";
}

function loggedInHTML(user) {
  return `
    <div class="auth-card" style="text-align:center">
      <div style="font-size:2.5rem">👋</div>
      <h2 style="margin:8px 0">${escapeHtml(user.email)}</h2>
      <p>${user.emailVerified
        ? `<span class="status-pill delivered">✓ email verified</span>`
        : `<span class="status-pill pending">email not verified</span>`}</p>
      ${user.emailVerified ? "" : `
        <div class="notice">You need to verify your email before you can order.
        We sent a link when you signed up — check your spam folder as well.</div>
        <button class="btn small" id="resend">Resend verification email</button>
        <button class="btn small ghost" id="refresh">I've verified — refresh</button>`}
      <div style="margin-top:18px;display:flex;gap:8px;justify-content:center;flex-wrap:wrap">
        <a class="btn small ghost" href="orders.html">My orders</a>
        <button class="btn small ghost" id="logout">Log out</button>
      </div>
    </div>
    <div class="auth-card" style="margin-top:12px;text-align:left">
      <h3 style="margin:0 0 8px">Deal alerts</h3>
      <p class="muted" id="vip-line">Checking your VIP status…</p>
      <p class="muted" id="push-line">Checking notification status…</p>
      <button class="btn small" id="push-enable" hidden>Enable deal alerts</button>
    </div>`;
}

onAuthStateChanged(auth, (user) => {
  const loading = document.getElementById("loading");
  const view = document.getElementById("auth-view");
  loading.hidden = true;
  view.hidden = false;

  if (!user) {
    let mode = "login";
    const setMode = (m) => {
      mode = m;
      view.innerHTML = authFormsHTML(mode);
      wireForms(mode, setMode);
    };
    setMode(mode);
    return;
  }

  view.innerHTML = loggedInHTML(user);
  const resend = document.getElementById("resend");
  if (resend) resend.addEventListener("click", async () => {
    try { await sendEmailVerification(user); toast("Verification email sent."); }
    catch (e) { console.error(e); toast("Couldn't send right now — try again in a bit."); }
  });
  const refresh = document.getElementById("refresh");
  if (refresh) refresh.addEventListener("click", async () => {
    try {
      await user.reload();
      if (auth.currentUser.emailVerified) toast("Email verified. You can now place orders.");
      else toast("Still not verified — click the link in your email first.");
    } catch (e) { console.error(e); }
  });
  document.getElementById("logout").addEventListener("click", () => signOut(auth));
  wirePushControls(user);
});

// Deal alerts + VIP progress on the account page.
async function wirePushControls(user) {
  const vipLine = document.getElementById("vip-line");
  try {
    const snap = await getDocs(query(collection(db, "orders"), where("userId", "==", user.uid)));
    const start = new Date();
    start.setDate(1);
    start.setHours(0, 0, 0, 0);
    let count = 0;
    snap.forEach((d) => {
      const o = d.data();
      if (o.status === "cancelled") return;
      const t = o.createdAt && typeof o.createdAt.toMillis === "function" ? o.createdAt.toMillis() : 0;
      if (t >= start.getTime()) count++;
    });
    vipLine.innerHTML = count >= VIP_ORDER_THRESHOLD
      ? `<span class="status-pill delivered">VIP</span> — you get deal alerts before everyone else.`
      : `${count}/${VIP_ORDER_THRESHOLD} orders this month — reach ${VIP_ORDER_THRESHOLD} to unlock VIP early alerts.`;
  } catch (e) {
    console.error(e);
    vipLine.textContent = "";
  }

  const pushLine = document.getElementById("push-line");
  const btn = document.getElementById("push-enable");
  let state = "unsupported";
  try { state = await pushPermissionState(); } catch (e) { console.error(e); }
  if (state === "unsupported") {
    pushLine.textContent = "Push notifications aren't supported in this browser.";
    return;
  }
  if (state === "granted") {
    pushLine.textContent = "Deal alerts are on for this device.";
    return;
  }
  if (state === "denied") {
    pushLine.textContent = "Notifications are blocked — allow them in your browser settings to get deal alerts.";
    return;
  }
  pushLine.textContent = "Get a notification for drops and price cuts.";
  btn.hidden = false;
  btn.addEventListener("click", async () => {
    btn.disabled = true;
    try {
      const res = await enablePush();
      if (res.permission === "granted") {
        pushLine.textContent = "Deal alerts are on for this device.";
        btn.hidden = true;
        toast(res.vip ? "Alerts on — and you're VIP, so you hear about drops first." : "Deal alerts on.");
      } else {
        pushLine.textContent = "Notifications are blocked — allow them in your browser settings to get deal alerts.";
        btn.hidden = true;
      }
    } catch (e) {
      console.error(e);
      toast("Couldn't enable alerts — try again in a bit.");
      btn.disabled = false;
    }
  });
}
