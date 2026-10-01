// Firebase Cloud Messaging service worker — shows a notification when a
// push arrives while the site isn't open. Must live at the site root so its
// scope covers every page.
//
// The config values below are filled in after the NextPrints project
// migration (same values as js/firebase-config.js).

importScripts("https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyBsuZAuW_ncWkb4f9fwd0jQkhPs0NkPC38",
  authDomain: "nextprints.firebaseapp.com",
  projectId: "nextprints",
  messagingSenderId: "1000408269543",
  appId: "1:1000408269543:web:f6ced768359c8be7be9842",
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const n = payload.notification || {};
  self.registration.showNotification(n.title || "NextPrints", {
    body: n.body || "",
    tag: "nextprints-deal",
  });
});
