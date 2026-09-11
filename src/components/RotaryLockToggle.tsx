import { useState } from "react";
import { ActionIcon, Tooltip } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { Lock, LockOpen } from "lucide-react";
import { commands } from "../lib/bindings";

/** Front-panel knob lock (FC=17), same toggle as the reference web app: red
 * padlock when locked, green when unlocked. Reads the amp's own state from
 * FC=27 (`rotaryLocked`), so the icon follows the hardware, not the click.
 * Has no effect on what this app may edit. */
export function RotaryLockToggle({
  deviceId,
  rotaryLocked,
}: {
  /** Online network amp to control; `undefined` renders the toggle disabled. */
  deviceId?: string;
  rotaryLocked: boolean | null | undefined;
}) {
  const [pending, setPending] = useState(false);
  const known = deviceId !== undefined && typeof rotaryLocked === "boolean";

  async function toggle() {
    if (!known) return;
    setPending(true);
    const result = await commands.liveControlSetRotaryLock(deviceId, !rotaryLocked);
    setPending(false);
    if (result.status === "error") {
      notifications.show({ color: "red", title: "Front panel lock failed", message: result.error.message });
    }
  }

  const label = !known ? "Front panel lock unavailable" : rotaryLocked ? "Unlock front panel" : "Lock front panel";

  return (
    <Tooltip label={label} position="right" withArrow openDelay={300}>
      <ActionIcon
        variant="subtle"
        color={!known ? "gray" : rotaryLocked ? "red" : "green"}
        size="lg"
        mt="xs"
        className="self-center"
        aria-label={label}
        disabled={!known}
        loading={pending}
        onClick={toggle}
      >
        {rotaryLocked ? <Lock size={18} /> : <LockOpen size={18} />}
      </ActionIcon>
    </Tooltip>
  );
}
