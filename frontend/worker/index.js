// CMG Telematics — Custom Service Worker additions
// Handles push notifications from the server

self.addEventListener('push', function (event) {
  const data = event.data ? event.data.json() : {};
  const title = data.title || 'CMG Telematics - Alerta';
  const options = {
    body: data.body || 'Nueva alerta en tu flota',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    vibrate: [200, 100, 200],
    data: { url: data.url || '/alerts' },
    actions: [
      { action: 'view', title: 'Ver alerta' },
      { action: 'dismiss', title: 'Descartar' },
    ],
    tag: data.tag || 'cmg-alert',
    requireInteraction: data.level === 'high',
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  if (event.action === 'view' || !event.action) {
    event.waitUntil(
      clients.openWindow(event.notification.data.url || '/alerts')
    );
  }
});
