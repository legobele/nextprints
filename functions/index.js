// NextPrints Cloud Functions — deal-alert push notifications.
//
// registerFcmToken (callable, signed-in users): stores the device's FCM
//   token and subscribes it to the "deals-all" topic, plus "deals-vip" when
//   the customer has VIP status (10+ non-cancelled orders this month).
// sendBlast (callable, admin only): sends a push to a topic — "vip" for the
//   early VIP alert, "all" for the general blast.

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");

admin.initializeApp();

const ADMIN_EMAIL = "legobele@gmail.com";
const VIP_ORDER_THRESHOLD = 10;
const TOPIC_ALL = "deals-all";
const TOPIC_VIP = "deals-vip";

// True when the user placed >= threshold non-cancelled orders this month.
async function isVip(uid) {
  const snap = await admin.firestore().collection("orders").where("userId", "==", uid).get();
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  let count = 0;
  snap.forEach((doc) => {
    const o = doc.data();
    if (o.status === "cancelled") return;
    const t = o.createdAt && typeof o.createdAt.toMillis === "function" ? o.createdAt.toMillis() : 0;
    if (t >= monthStart) count++;
  });
  return count >= VIP_ORDER_THRESHOLD;
}

exports.registerFcmToken = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in first.");
  const token = String((request.data && request.data.token) || "").trim();
  if (token.length < 20) throw new HttpsError("invalid-argument", "Bad token.");

  const uid = request.auth.uid;
  const vip = await isVip(uid);
  const topics = [TOPIC_ALL];
  if (vip) topics.push(TOPIC_VIP);

  const messaging = admin.messaging();
  await messaging.subscribeToTopic([token], topics);
  if (!vip) {
    // Keep the VIP topic accurate when status lapses.
    try {
      await messaging.unsubscribeFromTopic([token], [TOPIC_VIP]);
    } catch (e) {
      console.warn("vip unsubscribe failed", e.message);
    }
  }

  await admin
    .firestore()
    .collection("fcmTokens")
    .doc(token)
    .set(
      { uid, topics, vip, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
      { merge: true }
    );

  return { vip, topics };
});

exports.sendBlast = onCall(async (request) => {
  const email = (request.auth && request.auth.token && request.auth.token.email) || "";
  if (email !== ADMIN_EMAIL) throw new HttpsError("permission-denied", "Admin only.");

  const title = String((request.data && request.data.title) || "").trim().slice(0, 60);
  const body = String((request.data && request.data.body) || "").trim().slice(0, 180);
  if (!title || !body) throw new HttpsError("invalid-argument", "Title and message are required.");

  const topic = request.data && request.data.audience === "vip" ? TOPIC_VIP : TOPIC_ALL;
  const messageId = await admin.messaging().send({
    topic,
    notification: { title, body },
  });
  return { messageId, topic };
});
