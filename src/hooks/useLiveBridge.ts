import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { commands, type DeviceBridge, type DeviceBridgeSnapshot } from "../lib/bindings";

/** Keyed by `DiscoveredDevice.id`. Mirrors `useLivePresets`'s store/listen
 * halves, but with no `refresh()`: FC=50 is polled continuously by the
 * driver (see `live/cvr/driver.rs`'s bridge tick), so this hook only seeds
 * from the current snapshot on mount and then follows `live_bridge:updated`.
 *
 * Bridge state deliberately does not ride along on FC=27 — see
 * `live/cvr/bridge.rs` for why reading it out of the sync trailer produces
 * wrong values on 1.1.8. */
export function useLiveBridge(deviceId: string | undefined) {
  const [bridgeById, setBridgeById] = useState<Record<string, DeviceBridgeSnapshot>>({});

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;

    (async () => {
      unlisten = await listen<DeviceBridge>("live_bridge:updated", (event) => {
        setBridgeById((prev) => ({ ...prev, [event.payload.deviceId]: event.payload.bridge }));
      });
      const initial = await commands.liveControlGetBridge();
      if (!cancelled && initial.status === "ok") {
        setBridgeById(Object.fromEntries(initial.data.map((d) => [d.deviceId, d.bridge])));
      }
    })();

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  return deviceId ? bridgeById[deviceId] : undefined;
}
