// Account: signup (school-email only) / login / logout / email verification.

import {
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendEmailVerification,
  sendPasswordResetEmail,
  signOut,
  TotpMultiFactorGenerator,
  getMultiFactorResolver,
  multiFactor,
} from "firebase/auth";
import { doc, getDoc, setDoc, serverTimestamp, collection, query, where, getDocs } from "firebase/firestore";
import { auth, db } from "./firebase.js";
import { BRAND_NAME, VIP_ORDER_THRESHOLD } from "./config.js";
import { renderNav, escapeHtml, toast } from "./ui.js";
import { pushPermissionState, enablePush } from "./messaging.js";

renderNav("account");
document.title = `Account · ${BRAND_NAME}`;

function emailOK(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

function authFormsHTML(mode) {
  return `
    <div class="auth-card">
      <div class="auth-tabs">
        <button id="tab-login" class="${mode === "login" ? "active" : ""}">Log in</button>
        <button id="tab-signup" class="${mode === "signup" ? "active" : ""}">Sign up</button>
      </div>
      <div id="form-login" ${mode === "login" ? "" : "hidden"}>
        <label>Email<input id="li-email" type="email" placeholder="you@example.com" autocomplete="email"></label>
        <label>Password<input id="li-pass" type="password" autocomplete="current-password"></label>
        <button class="btn" id="li-go" style="width:100%">Log in</button>
        <button class="btn small ghost" id="li-forgot" style="width:100%;margin-top:8px">Forgot password?</button>
      </div>
      <div id="mfa-box" hidden>
        <p style="color:var(--muted);font-size:0.9rem">Enter the 6-digit code from your authenticator app.</p>
        <label>Authenticator code<input id="mfa-code" inputmode="numeric" autocomplete="one-time-code" placeholder="000000" maxlength="6"></label>
        <button class="btn" id="mfa-go" style="width:100%">Verify</button>
      </div>
      <div id="form-signup" ${mode === "signup" ? "" : "hidden"}>
        <label>Email<input id="su-email" type="email" placeholder="you@example.com" autocomplete="email"></label>
        <p style="color:var(--muted);font-size:0.85rem;margin:0 0 8px">Any email works — we'll send a verification link, and checkout stays blocked until you verify.</p>
        <label>Password (6+ characters)<input id="su-pass" type="password" autocomplete="new-password"></label>
        <label style="display:flex;gap:8px;align-items:flex-start;font-weight:normal;cursor:pointer;margin:4px 0 8px">
          <input type="checkbox" id="su-email-optin" checked style="margin-top:5px;flex:none">
          <span style="font-size:0.9rem;color:var(--muted)">Email me about drops, deals and price cuts.</span>
        </label>
        <button class="btn" id="su-go" style="width:100%">Create account</button>
      </div>
      <p id="auth-err" style="color:var(--red);font-size:0.9rem"></p>
    </div>`;
}

function wireForms(mode, setMode) {
  // Holds the Firebase multi-factor resolver while the admin finishes the
  // 2nd step of login (authenticator code after password).
  let mfaResolver = null;
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
      // Admin account has authenticator 2FA enrolled: password alone isn't
      // enough — Firebase throws and hands us a resolver for the 2nd step.
      if (e.code === "auth/multi-factor-auth-required") {
        mfaResolver = getMultiFactorResolver(auth, e);
        document.getElementById("form-login").hidden = true;
        document.getElementById("mfa-box").hidden = false;
        document.getElementById("mfa-code").focus();
        return;
      }
      console.error(e);
      err(friendlyAuthError(e));
    }
  });

  document.getElementById("mfa-go").addEventListener("click", async () => {
    err("");
    const code = document.getElementById("mfa-code").value.trim();
    if (!/^\d{6}$/.test(code)) { err("Enter the 6-digit code from your authenticator app."); return; }
    try {
      const assertion = TotpMultiFactorGenerator.assertionForSignIn(mfaResolver.hints[0].uid, code);
      await mfaResolver.resolveSignIn(assertion);
      mfaResolver = null;
      // onAuthStateChanged takes over from here.
    } catch (e) {
      console.error(e);
      err(e.code === "auth/invalid-verification-code"
        ? "That code didn't work — check your authenticator app and try again."
        : friendlyAuthError(e));
    }
  });

  document.getElementById("li-forgot").addEventListener("click", async () => {
    err("");
    const email = document.getElementById("li-email").value.trim();
    if (!email) { err("Enter your email first, then click Forgot password."); return; }
    try {
      await sendPasswordResetEmail(auth, email);
      toast("Password reset email sent — check your inbox.");
    } catch (e) {
      console.error(e);
      err(friendlyAuthError(e));
    }
  });

  document.getElementById("su-go").addEventListener("click", async () => {
    err("");
    const email = document.getElementById("su-email").value.trim();
    const pass = document.getElementById("su-pass").value;
    if (!emailOK(email)) { err("Enter a valid email address."); return; }
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
      // Marketing preference lives in prefs/{uid} (owner-writable).
      await setDoc(doc(db, "prefs", cred.user.uid), {
        emailMarketing: document.getElementById("su-email-optin").checked,
        updatedAt: serverTimestamp(),
      }, { merge: true });
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
      <label style="display:flex;gap:8px;align-items:flex-start;font-weight:normal;cursor:pointer;margin-top:10px">
        <input type="checkbox" id="email-optin" style="margin-top:5px;flex:none">
        <span class="muted" style="font-size:0.9rem">Email me about drops, deals and price cuts.</span>
      </label>
    </div>
    <div class="auth-card" style="margin-top:12px;text-align:left" id="mfa-card">
      <h3 style="margin:0 0 8px">Two-factor authentication</h3>
      <p class="muted" id="mfa-status">Checking…</p>
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
  wireMfaControls(user);
});

// Two-factor authentication (authenticator app) — available to every account.
// Enrollment: generate a TOTP secret, show it as a QR code + manual key, verify
// a 6-digit code, enroll. Login challenge is handled in the login form above:
// Firebase throws auth/multi-factor-auth-required and we resolve it with the code.
function wireMfaControls(user) {
  const card = document.getElementById("mfa-card");
  if (!card) return;

  const render = () => {
    const factors = multiFactor(auth.currentUser).enrolledFactors;
    const status = document.getElementById("mfa-status");
    if (factors.length === 0) {
      status.innerHTML = `Add your authenticator app (Google Authenticator, 1Password, or similar) for an extra layer of security on this account.<br><br>
        <button class="btn small" id="mfa-setup">Set up authenticator app</button>`;
      document.getElementById("mfa-setup").addEventListener("click", startEnroll);
    } else {
      status.innerHTML = `<span class="status-pill delivered">on</span>
        <span class="muted">Authenticator app is protecting this account. You'll be asked for a code each time you log in.</span><br><br>
        <button class="btn small ghost" id="mfa-remove">Remove authenticator</button>`;
      document.getElementById("mfa-remove").addEventListener("click", async () => {
        try {
          await multiFactor(auth.currentUser).unenroll(factors[0].uid);
          await auth.currentUser.reload();
          toast("Authenticator removed.");
          render();
        } catch (e) {
          console.error(e);
          toast("Couldn't remove it — try again in a bit.");
        }
      });
    }
  };

  const startEnroll = async () => {
    const me = auth.currentUser;
    const status = document.getElementById("mfa-status");
    try {
      const session = await multiFactor(me).getSession();
      const secret = await TotpMultiFactorGenerator.generateSecret(session);
      const otpauth = `otpauth://totp/${encodeURIComponent(BRAND_NAME)}:${encodeURIComponent(me.email)}?secret=${secret.secretKey}&issuer=${encodeURIComponent(BRAND_NAME)}`;
      const qrOK = typeof window.QRCode === "function";
      status.innerHTML = `
        <p class="muted" style="margin-top:0">${qrOK ? "Scan this with your authenticator app, then enter the 6-digit code it shows." : "Add this key to your authenticator app manually, then enter the 6-digit code it shows."}</p>
        ${qrOK ? `<div id="mfa-qr" style="margin:8px 0"></div>` : ""}
        <p class="muted" style="font-size:0.85rem">Manual key: <code class="inline" style="user-select:all">${escapeHtml(secret.secretKey)}</code></p>
        <label>6-digit code<input id="mfa-enroll-code" inputmode="numeric" autocomplete="one-time-code" placeholder="000000" maxlength="6"></label>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn small" id="mfa-enroll-go">Verify and turn on</button>
          <button class="btn small ghost" id="mfa-enroll-cancel">Cancel</button>
        </div>
        <p class="muted" id="mfa-enroll-err" style="font-size:0.85rem"></p>`;
      if (qrOK) new window.QRCode(document.getElementById("mfa-qr"), { text: otpauth, width: 180, height: 180 });
      document.getElementById("mfa-enroll-cancel").addEventListener("click", render);
      document.getElementById("mfa-enroll-go").addEventListener("click", async () => {
        const codeEl = document.getElementById("mfa-enroll-code");
        const errEl = document.getElementById("mfa-enroll-err");
        const code = codeEl.value.trim();
        if (!/^\d{6}$/.test(code)) { errEl.textContent = "Enter the 6-digit code from your authenticator app."; return; }
        try {
          const assertion = TotpMultiFactorGenerator.assertionForEnrollment(secret, code);
          await multiFactor(auth.currentUser).enroll(assertion, "Authenticator app");
          await auth.currentUser.reload();
          toast("Two-factor authentication is on.");
          render();
        } catch (e) {
          console.error(e);
          errEl.textContent = e.code === "auth/invalid-verification-code"
            ? "That code didn't work — check your authenticator app and try again."
            : "Couldn't finish setup — sign out and back in, then try again.";
        }
      });
    } catch (e) {
      console.error(e);
      status.innerHTML = `<span class="muted">Couldn't start setup — sign out and back in, then try again.</span><br><br>
        <button class="btn small ghost" id="mfa-retry">Back</button>`;
      document.getElementById("mfa-retry").addEventListener("click", render);
    }
  };

  render();
}

// Deal alerts + VIP progress + email preference on the account page.
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

  // Email preference toggle (prefs/{uid}, owner-writable).
  const emailOptIn = document.getElementById("email-optin");
  try {
    const pref = await getDoc(doc(db, "prefs", user.uid));
    emailOptIn.checked = !!(pref.data() && pref.data().emailMarketing);
  } catch (e) {
    console.error(e);
  }
  emailOptIn.addEventListener("change", async () => {
    try {
      await setDoc(doc(db, "prefs", user.uid), {
        emailMarketing: emailOptIn.checked,
        updatedAt: serverTimestamp(),
      }, { merge: true });
      toast(emailOptIn.checked ? "Deal emails on." : "Deal emails off.");
    } catch (e) {
      console.error(e);
      toast("Couldn't save — try again in a bit.");
      emailOptIn.checked = !emailOptIn.checked;
    }
  });
}
