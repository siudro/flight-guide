/* Flight Guide — service worker.
 *
 * Exists for one job: showing "your gate changed" as a phone notification.
 * Android Chrome only allows notifications through a service worker. It does
 * NOT cache or intercept anything (there is no fetch handler), so it cannot
 * serve a stale page or hide a new deploy.
 */
self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (e) { e.waitUntil(self.clients.claim()); });

self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
      for (var i = 0; i < list.length; i++) {
        if ('focus' in list[i]) return list[i].focus();
      }
      return self.clients.openWindow ? self.clients.openWindow('/') : null;
    })
  );
});
