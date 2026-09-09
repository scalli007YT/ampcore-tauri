import { notifications } from "@mantine/notifications";

type NotificationProps = Parameters<typeof notifications.show>[0];

/** Notification id currently on screen for each rolling key. */
const activeByKey = new Map<string, string>();
let sequence = 0;

/**
 * Shows a notification that *replaces* the previous one for the same `key`,
 * restarting its auto-close timer — a single rolling confirmation rather than
 * a stack.
 *
 * Passing a stable `id` to `notifications.show()` does NOT do this, which is
 * the bug this exists to fix. Two behaviours in `@mantine/notifications@9.4.1`
 * combine against it:
 *
 * 1. `notifications.show()` **ignores** a notification whose id is already
 *    displayed — `notifications.store.mjs` returns the list unchanged on
 *    `notifications.some((n) => n.id === notification.id)`. So a repeat call
 *    is a silent no-op: the stale message stays and the new one is dropped.
 * 2. `notifications.update()` fixes the text but not the timer. The auto-close
 *    effect in `NotificationContainer.mjs` depends on
 *    `[autoCloseDuration, active, dismissed]` — not on the message — so an
 *    updated toast still closes relative to when the *first* one appeared.
 *
 * The list is keyed by `notification.id`, so the only way to get a genuinely
 * fresh notification (new mount, restarted timer) is a new id. This hides the
 * previous one and shows a new uniquely-identified one, which also gives the
 * user a visible swap rather than a silently mutating toast.
 *
 * `key` scopes the rolling behaviour: two different keys coexist and stack
 * normally. Only repeats of the same key replace each other.
 */
export function showRollingNotification(key: string, props: Omit<NotificationProps, "id" | "onClose">): void {
  // Hide first, then record: `hide` fires the old notification's `onClose`,
  // which clears the map entry. Doing it in the other order would let that
  // callback delete the entry we just wrote for the new toast.
  const previous = activeByKey.get(key);
  if (previous) {
    notifications.hide(previous);
  }

  const id = `${key}#${++sequence}`;
  activeByKey.set(key, id);
  notifications.show({
    ...props,
    id,
    onClose: () => {
      // Guard against a late auto-close from a superseded toast evicting the
      // entry belonging to a newer one.
      if (activeByKey.get(key) === id) {
        activeByKey.delete(key);
      }
    },
  });
}
