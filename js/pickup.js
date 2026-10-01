// Pickup location prompt: when an order is out for delivery, ask the
// customer where in the school they will be to receive it.
//
// In-app only (see maybePromptPickup, called from ui.js after sign-in).
// True push notifications would need Firebase Cloud Messaging — out of scope.
// Locations live in /pickupLocations/{orderId} because Firestore rules only
// let owners touch their order doc to cancel it, not to add fields.

import { collection, doc, getDocs, query, setDoc, where, serverTimestamp } from "firebase/firestore";
import { db } from "./firebase.js";
import { escapeHtml, toast } from "./ui.js";

const dismissed = new Set(); // orderIds skipped this session

// orderId -> pickupLocation string for this user.
export async function fetchPickupMap(user) {
  const map = {};
  if (!user) return map;
  try {
    const snap = await getDocs(query(collection(db, "pickupLocations"), where("userId", "==", user.uid)));
    snap.docs.forEach((d) => {
      const data = d.data();
      if (data.pickupLocation) map[d.id] = data.pickupLocation;
    });
  } catch (e) {
    console.warn("pickup locations fetch failed", e);
  }
  return map;
}

export async function savePickupLocation(user, orderId, location) {
  try { await user.reload(); } catch (e) { console.warn(e); }
  if (!user.emailVerified) throw new Error("Email is not verified.");
  // Force-refresh the ID token: Firestore rules read email_verified from the
  // token, which stays stale for up to an hour after verification otherwise.
  try { await user.getIdToken(true); } catch (e) { console.warn(e); }
  await setDoc(doc(db, "pickupLocations", orderId), {
    orderId,
    userId: user.uid,
    email: user.email,
    pickupLocation: location,
    updatedAt: serverTimestamp(),
  }, { merge: true });
}

// Prompt for the first delivering order that has no pickup location.
export async function maybePromptPickup(user) {
  if (!user || !user.emailVerified) return;
  try {
    const snap = await getDocs(query(collection(db, "orders"), where("userId", "==", user.uid)));
    const delivering = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((o) => o.status === "delivering");
    if (!delivering.length) return;
    const pickupMap = await fetchPickupMap(user);
    const needs = delivering.find((o) => !pickupMap[o.id] && !dismissed.has(o.id));
    if (needs) openPickupModal(user, needs.id, "");
  } catch (e) {
    console.warn("pickup prompt failed", e);
  }
}

// Reusable modal: used for the auto-prompt and for editing from the tracker.
export function openPickupModal(user, orderId, existing) {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal" role="dialog" aria-label="Pickup location">
      <h3>Your order is out for delivery</h3>
      <p style="color:var(--muted);margin-top:0">Where in the school will you be to receive it?</p>
      <label>Pickup location<input id="pk-loc" maxlength="120" placeholder="Cafeteria, Library, Room 204…" value="${escapeHtml(existing || "")}"></label>
      <p id="pk-err" style="color:var(--red);font-size:0.9rem" hidden>Please enter a location.</p>
      <div style="display:flex;gap:8px;margin-top:12px">
        <button class="btn" id="pk-save">Save</button>
        <button class="btn ghost" id="pk-later">Maybe later</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const input = overlay.querySelector("#pk-loc");
  input.focus();

  overlay.querySelector("#pk-later").addEventListener("click", () => {
    dismissed.add(orderId);
    overlay.remove();
  });

  const doSave = async () => {
    const loc = input.value.trim();
    if (!loc) {
      overlay.querySelector("#pk-err").hidden = false;
      return;
    }
    const btn = overlay.querySelector("#pk-save");
    btn.disabled = true;
    try {
      await savePickupLocation(user, orderId, loc);
      dismissed.delete(orderId);
      overlay.remove();
      toast("Pickup location saved.");
      // Refresh the tracker if we're on the orders page.
      if (typeof window.refreshPickupDisplay === "function") {
        window.refreshPickupDisplay(orderId, loc);
      }
    } catch (e) {
      console.error(e);
      toast("Couldn't save. Please try again.");
      btn.disabled = false;
    }
  };
  overlay.querySelector("#pk-save").addEventListener("click", doSave);
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") doSave(); });
}
