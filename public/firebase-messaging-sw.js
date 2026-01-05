/* eslint-disable no-undef */
importScripts("https://www.gstatic.com/firebasejs/12.7.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/12.7.0/firebase-messaging-compat.js");

const params = new URLSearchParams(self.location.search);
const firebaseConfig = {
  apiKey: params.get("apiKey"),
  authDomain: params.get("authDomain"),
  projectId: params.get("projectId"),
  appId: params.get("appId"),
  messagingSenderId: params.get("messagingSenderId"),
};

if (!firebase.apps.length && firebaseConfig.apiKey) {
  firebase.initializeApp(firebaseConfig);
}

let messaging = null;
try {
  messaging = firebase.messaging();
} catch {
  messaging = null;
}

if (messaging) {
  messaging.onBackgroundMessage((payload) => {
    const title = payload?.notification?.title || "Family Hub";
    const body = payload?.notification?.body || "Time for your daily check-in.";
    const icon = payload?.notification?.icon;
    const link = payload?.fcmOptions?.link || payload?.data?.link || self.location.origin;

    self.registration.showNotification(title, {
      body,
      icon,
      data: { url: link },
    });
  });
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = event.notification?.data?.url || self.location.origin;
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url === target && "focus" in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow(target);
      return undefined;
    }),
  );
});
