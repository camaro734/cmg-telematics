// Web Push notification utilities for CMG Telematics PWA

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || '';

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export async function requestPushPermission(): Promise<NotificationPermission> {
  if (!('Notification' in window) || !('serviceWorker' in navigator)) {
    return 'denied';
  }
  return Notification.requestPermission();
}

export async function subscribeToPush(): Promise<PushSubscription | null> {
  if (!VAPID_PUBLIC_KEY) {
    console.warn('VAPID_PUBLIC_KEY not set — push subscriptions disabled');
    return null;
  }
  try {
    const reg = await navigator.serviceWorker.ready;
    const existing = await reg.pushManager.getSubscription();
    if (existing) return existing;
    const subscription = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY).buffer as ArrayBuffer,
    });
    return subscription;
  } catch (e) {
    console.error('Push subscription failed:', e);
    return null;
  }
}

export async function registerPushSubscription(
  subscription: PushSubscription,
  token: string
): Promise<void> {
  await fetch('/api/v1/notifications/push-subscribe', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(subscription.toJSON()),
  });
}

export async function unregisterPushSubscription(token: string): Promise<void> {
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (!sub) return;
    // Notify backend
    await fetch(
      `/api/v1/notifications/push-subscribe?endpoint=${encodeURIComponent(sub.endpoint)}`,
      {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      }
    );
    await sub.unsubscribe();
  } catch (e) {
    console.error('Unsubscribe failed:', e);
  }
}

export async function setupPushNotifications(token: string): Promise<boolean> {
  const permission = await requestPushPermission();
  if (permission !== 'granted') return false;
  const sub = await subscribeToPush();
  if (!sub) return false;
  await registerPushSubscription(sub, token);
  return true;
}

export function getPushPermissionStatus(): NotificationPermission | 'unsupported' {
  if (!('Notification' in window)) return 'unsupported';
  return Notification.permission;
}
