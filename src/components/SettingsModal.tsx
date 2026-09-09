import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";
import {
  Badge,
  Button,
  Group,
  Modal,
  SegmentedControl,
  Stack,
  Switch,
  Text,
  useMantineColorScheme,
} from "@mantine/core";
import { getAutoUpdateChecksEnabled, setAutoUpdateChecksEnabled } from "../lib/preferences";

interface SettingsModalProps {
  opened: boolean;
  onClose: () => void;
}

type VersionStatus = "dev" | "checking" | "update-available" | "up-to-date" | "check-failed";

const STATUS_COLOR: Record<VersionStatus, string> = {
  dev: "red",
  checking: "gray",
  "update-available": "orange",
  "up-to-date": "green",
  "check-failed": "gray",
};

export function SettingsModal({ opened, onClose }: SettingsModalProps) {
  const { colorScheme, setColorScheme } = useMantineColorScheme();
  const [version, setVersion] = useState("");
  const [status, setStatus] = useState<VersionStatus>("checking");
  const [pendingUpdate, setPendingUpdate] = useState<Update | null>(null);
  const [installing, setInstalling] = useState(false);
  const [autoUpdateChecks, setAutoUpdateChecks] = useState(true);

  useEffect(() => {
    if (opened) {
      setAutoUpdateChecks(getAutoUpdateChecksEnabled());
    }
  }, [opened]);

  useEffect(() => {
    if (!opened) return;

    getVersion().then(setVersion);

    if (import.meta.env.DEV) {
      setStatus("dev");
      return;
    }

    setStatus("checking");
    setPendingUpdate(null);
    check()
      .then((update) => {
        if (update) {
          setPendingUpdate(update);
          setStatus("update-available");
        } else {
          setStatus("up-to-date");
        }
      })
      .catch((e) => {
        console.error("Update check failed", e);
        setStatus("check-failed");
      });
  }, [opened]);

  async function handleInstallUpdate() {
    if (!pendingUpdate) return;
    setInstalling(true);
    try {
      await pendingUpdate.downloadAndInstall();
      await relaunch();
    } catch (e) {
      console.error("Update install failed", e);
      setInstalling(false);
    }
  }

  const statusLabel =
    status === "dev"
      ? "development build"
      : status === "checking"
        ? "checking…"
        : status === "update-available"
          ? `update available: ${pendingUpdate?.version ?? ""}`
          : status === "up-to-date"
            ? "up to date"
            : "check failed";

  return (
    <Modal opened={opened} onClose={onClose} title="App Settings" centered>
      <Stack gap="sm">
        <Group justify="space-between" wrap="wrap" gap="xs">
          <Text size="sm">Color mode</Text>
          <SegmentedControl
            size="xs"
            value={colorScheme}
            onChange={(value) => setColorScheme(value as "light" | "dark" | "auto")}
            data={[
              { label: "Light", value: "light" },
              { label: "Dark", value: "dark" },
              { label: "Auto", value: "auto" },
            ]}
          />
        </Group>

        <Group justify="space-between" wrap="wrap" gap="xs">
          <Text size="sm">Check for updates on startup</Text>
          <Switch
            checked={autoUpdateChecks}
            onChange={(e) => {
              const enabled = e.currentTarget.checked;
              setAutoUpdateChecks(enabled);
              setAutoUpdateChecksEnabled(enabled);
            }}
          />
        </Group>

        <Group justify="space-between" wrap="wrap" gap="xs">
          <Text size="sm">Version</Text>
          <Group gap="xs" wrap="wrap">
            <Badge color={STATUS_COLOR[status]} variant="light">
              {version ? `${version} — ${statusLabel}` : statusLabel}
            </Badge>
            {status === "update-available" && (
              <Button size="xs" loading={installing} onClick={handleInstallUpdate}>
                Update now
              </Button>
            )}
          </Group>
        </Group>
      </Stack>
    </Modal>
  );
}
