// S&C Performance Coaching service worker — push notifications only.
// No fetch handler: this app does not cache for offline use.

self.addEventListener("push", function (event) {
  if (!event.data) return;

  let data;
  try {
    data = event.data.json();
  } catch {
    data = { title: "S&C Performance Coaching", body: event.data.text() };
  }

  const title = data.title ?? "S&C Performance Coaching";
  const options = {
    body: data.body ?? "",
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    data: { linkHref: data.linkHref ?? "/dashboard" },
    requireInteraction: false,
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", function (event) {
  event.notification.close();

  const linkHref = event.notification.data?.linkHref ?? "/dashboard";
  // Build an absolute URL so client.navigate() and clients.openWindow() both
  // receive a fully-qualified href regardless of what was stored in data.
  const targetUrl = new URL(linkHref, self.location.origin).href;

  event.waitUntil(
    clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then(function (list) {
        // If any existing window belongs to this origin, navigate it and focus.
        for (const client of list) {
          if (client.url.startsWith(self.location.origin) && "focus" in client) {
            client.navigate(targetUrl);
            return client.focus();
          }
        }
        // No existing window — open a new one.
        if (clients.openWindow) {
          return clients.openWindow(targetUrl);
        }
      })
  );
});
