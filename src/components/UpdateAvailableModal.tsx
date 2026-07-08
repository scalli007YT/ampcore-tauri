import { Button, Group, Modal, Stack, Text } from "@mantine/core";
import type { Update } from "@tauri-apps/plugin-updater";

interface UpdateAvailableModalProps {
  update: Update | null;
  installing: boolean;
  onInstall: () => void;
  onAbort: () => void;
  onDisable: () => void;
}

export function UpdateAvailableModal({
  update,
  installing,
  onInstall,
  onAbort,
  onDisable,
}: UpdateAvailableModalProps) {
  return (
    <Modal
      opened={update !== null}
      onClose={onAbort}
      title="Update Available"
      centered
      closeOnClickOutside={!installing}
      closeOnEscape={!installing}
      withCloseButton={!installing}
    >
      <Stack gap="md">
        <Text size="sm">
          Version {update?.version} is available — you're currently on{" "}
          {update?.currentVersion}.
        </Text>
        <Group justify="space-between">
          <Button variant="subtle" color="gray" onClick={onDisable} disabled={installing}>
            Disable update checks
          </Button>
          <Group gap="xs">
            <Button variant="default" onClick={onAbort} disabled={installing}>
              Not now
            </Button>
            <Button onClick={onInstall} loading={installing}>
              Install now
            </Button>
          </Group>
        </Group>
      </Stack>
    </Modal>
  );
}
