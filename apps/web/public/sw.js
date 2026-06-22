/* glassbottles service worker — Web Push only (migration 027).
   Kept deliberately tiny: no offline caching, just push display + click routing.
   Payloads come from the push-notify Edge Function: { title, body, url }. */

self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    /* non-JSON payload — fall back to defaults */
  }

  const title = data.title || 'glassbottles'
  const options = {
    body: data.body || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: data.url || 'glassbottles', // collapse repeats to one notification
    data: { url: data.url || '/home' },
  }

  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = (event.notification.data && event.notification.data.url) || '/home'

  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        // Focus an existing tab and route it, else open a new one.
        for (const client of clientList) {
          if ('focus' in client) {
            if ('navigate' in client) client.navigate(target).catch(() => {})
            return client.focus()
          }
        }
        if (self.clients.openWindow) return self.clients.openWindow(target)
      }),
  )
})
