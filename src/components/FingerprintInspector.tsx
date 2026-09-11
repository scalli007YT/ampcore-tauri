import { useEffect, useState } from "react";
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Code,
  CopyButton,
  Group,
  Loader,
  Modal,
  Stack,
  Table,
  Text,
  Tooltip,
} from "@mantine/core";
import { Fingerprint, RefreshCw } from "lucide-react";
import {
  commands,
  type AmpFingerprint,
  type ChannelFingerprint,
} from "../lib/bindings";
import { useIsCompact } from "../lib/breakpoints";

/** Which amp to fingerprint — a planned project assignment or a live device.
 * Both go through the same backend canonicalization (`data/fingerprint.rs`),
 * so their hashes are directly comparable. */
export type FingerprintTarget =
  | { kind: "project"; projectId: string; assignmentId: string }
  | { kind: "live"; deviceId: string };

function targetKey(target: FingerprintTarget | undefined): string | null {
  if (!target) return null;
  return target.kind === "project"
    ? `project:${target.projectId}:${target.assignmentId}`
    : `live:${target.deviceId}`;
}

/** Match/drift/none for the `_XXXX` hash carried in an output name. */
function EmbeddedHashBadge({ channel }: { channel: ChannelFingerprint }) {
  if (channel.embeddedHash === null) {
    return (
      <Badge color="gray" variant="light" size="sm">
        none
      </Badge>
    );
  }
  if (channel.embeddedHashMatches === null) {
    return (
      <Badge color="gray" variant="light" size="sm">
        unknown
      </Badge>
    );
  }
  return channel.embeddedHashMatches ? (
    <Badge color="green" variant="light" size="sm">
      match
    </Badge>
  ) : (
    <Badge color="red" variant="light" size="sm">
      drift
    </Badge>
  );
}

/** Tab-rail button plus modal showing an amp's fingerprint: amp hash,
 * per-channel speaker hashes and the full canonical JSON to copy. Read-only
 * groundwork for online/offline matching — nothing here writes. */
export function FingerprintInspector({
  target,
}: {
  target?: FingerprintTarget;
}) {
  const compact = useIsCompact();
  const [opened, setOpened] = useState(false);
  const [fingerprint, setFingerprint] = useState<AmpFingerprint | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const key = targetKey(target);

  useEffect(() => {
    if (!opened || !target) return;
    let cancelled = false;
    setLoading(true);
    const call =
      target.kind === "project"
        ? commands.fingerprintProjectAmp(target.projectId, target.assignmentId)
        : commands.fingerprintLiveDevice(target.deviceId);
    call.then((result) => {
      if (cancelled) return;
      setLoading(false);
      if (result.status === "ok") {
        setFingerprint(result.data);
        setError(null);
      } else {
        setFingerprint(null);
        setError(result.error.message);
      }
    });
    return () => {
      cancelled = true;
    };
    // `key` stands in for `target`, whose object identity changes every render.
  }, [opened, key, reloadToken]);

  const json = fingerprint ? JSON.stringify(fingerprint, null, 2) : "";

  return (
    <>
      <Tooltip label="Fingerprint" position="right" withArrow openDelay={300}>
        <ActionIcon
          variant="subtle"
          color="gray"
          size="lg"
          mt="xs"
          className="self-center"
          aria-label="Fingerprint"
          disabled={!target}
          onClick={() => setOpened(true)}
        >
          <Fingerprint size={18} />
        </ActionIcon>
      </Tooltip>

      <Modal
        opened={opened}
        onClose={() => setOpened(false)}
        title="Amp Fingerprint"
        size="xl"
        centered
        fullScreen={compact}
      >
        <Stack gap="sm" className="min-w-0">
          <Group justify="space-between" wrap="wrap" gap="xs">
            <Group gap="xs" wrap="wrap" className="min-w-0">
              <Text size="sm" c="dimmed">
                Amp hash
              </Text>
              <Code>{fingerprint?.ampHash ?? "—"}</Code>
              {fingerprint && (
                <Text size="sm" c="dimmed">
                  {fingerprint.identity.model ?? "unknown model"} ·{" "}
                  {fingerprint.identity.channelCount} ch · fw{" "}
                  {fingerprint.identity.firmwareFamily ?? "?"}
                </Text>
              )}
            </Group>
            <Group gap="xs">
              {loading && <Loader size="xs" />}
              <Button
                size="xs"
                variant="default"
                leftSection={<RefreshCw size={14} />}
                onClick={() => setReloadToken((t) => t + 1)}
              >
                Refresh
              </Button>
              <CopyButton value={json}>
                {({ copied, copy }) => (
                  <Button
                    size="xs"
                    color={copied ? "green" : undefined}
                    disabled={!fingerprint}
                    onClick={copy}
                  >
                    {copied ? "Copied" : "Copy JSON"}
                  </Button>
                )}
              </CopyButton>
            </Group>
          </Group>

          {error && (
            <Alert color="red" variant="light">
              {error}
            </Alert>
          )}

          {fingerprint && fingerprint.missing.length > 0 && (
            <Alert color="yellow" variant="light" title="Incomplete">
              <Stack gap={2}>
                {fingerprint.missing.map((reason) => (
                  <Text key={reason} size="sm">
                    {reason}
                  </Text>
                ))}
              </Stack>
            </Alert>
          )}

          {fingerprint && (
            <div className="min-w-0 overflow-x-auto">
              <Table striped withTableBorder miw={420}>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Out</Table.Th>
                    <Table.Th>Speaker hash</Table.Th>
                    <Table.Th>Output name</Table.Th>
                    <Table.Th>Name hash</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {fingerprint.channels.map((channel) => (
                    <Table.Tr key={channel.channelIndex}>
                      <Table.Td>{channel.label}</Table.Td>
                      <Table.Td>
                        <Code>{channel.speakerHash ?? "—"}</Code>
                      </Table.Td>
                      <Table.Td>{channel.outputName ?? "—"}</Table.Td>
                      <Table.Td>
                        <EmbeddedHashBadge channel={channel} />
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </div>
          )}

          {fingerprint && (
            <Code block className="max-h-[50vh] overflow-auto">
              {json}
            </Code>
          )}
        </Stack>
      </Modal>
    </>
  );
}
