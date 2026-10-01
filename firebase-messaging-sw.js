// Firebase Cloud Messaging service worker — shows a notification when a
// push arrives while the site isn't open. Must live at the site root so its
// scope covers every page.
//
// The config values below are filled in after the NextPrints project
// migration (same values as js/firebase-config.js).

importScripts("https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "__FIREBASE_API_KEY__",
  authDomain: "__FIREBASE_PROJECT_ID__.firebaseapp.com",
  projectId: "__FIREBASE_PROJECT_ID__",
  messagingSenderId: "__FIREBASE_SENDER_ID__",
  appId: "__FIREBASE_APP_ID__",
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const n = payload.notification || {};
  self.registration.showNotification(n.title || "NextPrints", {
    body: n.body || "",
    tag: "nextprints-deal",
  });
});
