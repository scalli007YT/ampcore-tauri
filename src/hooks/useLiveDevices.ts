import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { commands, type DiscoveredDevice } from "../lib/bindings";

export function useLiveDevices() {
  const [devices, setDevices] = useState<DiscoveredDevice[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;

    (async () => {
      unlisten = await listen<DiscoveredDevice[]>("live_device:updated", (event) => {
        setDevices(event.payload);
      });
      const initial = await commands.liveControlListDevices();
      if (!cancelled && initial.status === "ok") setDevices(initial.data);
      await commands.liveControlStart(); // idempotent no-op if already running
      if (!cancelled) setReady(true);
    })();

    return () => {
      cancelled = true;
      unlisten?.();
      // Deliberately NOT calling a stop command here — discovery should keep
      // running in the background across view switches within a session,
      // not restart from zero every time the user tabs back into Live Control.
    };
  }, []);

  return { devices, ready };
}
