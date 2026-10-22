/* glassbottles service worker — Web Push only (migration 044).
   Deliberately tiny: no offline caching, just showing a push and routing its
   click. Payloads come from the push-notify Edge Function: { title, body, url }. */

self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    /* not JSON: fall back to the defaults */
  }
  event.waitUntil(
    self.registration.showNotification(data.title || 'glassbottles', {
      body: data.body || '',
      icon: '/icon/192',
      badge: '/icon/192',
      tag: data.url || 'glassbottles', // repeats collapse into one
      data: { url: data.url || '/feed' },
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = (event.notification.data && event.notification.data.url) || '/feed'
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((tabs) => {
      for (const tab of tabs) {
        if ('focus' in tab) {
          if ('navigate' in tab) tab.navigate(target).catch(() => {})
          return tab.focus()
        }
      }
      return self.clients.openWindow ? self.clients.openWindow(target) : undefined
    }),
  )
})
