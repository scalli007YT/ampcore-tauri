import { useEffect, useState } from "react";
import { Button, Center, Group, Loader, Stack, Table, Text } from "@mantine/core";
import { SpeakerFormModal } from "./SpeakerFormModal";
import { commands, type SpeakerLibraryEntry_Serialize } from "../lib/bindings";

export function SpeakerLibraryView() {
  const [speakers, setSpeakers] = useState<SpeakerLibraryEntry_Serialize[] | null>(null);
  const [editEntry, setEditEntry] = useState<SpeakerLibraryEntry_Serialize | null>(null);

  useEffect(() => {
    loadSpeakers();
  }, []);

  async function loadSpeakers() {
    const result = await commands.speakerLibraryList();
    if (result.status === "ok") {
      setSpeakers(result.data);
    }
  }

  async function handleArchive(id: string) {
    const result = await commands.speakerLibraryArchive(id);
    if (result.status === "ok") {
      loadSpeakers();
    }
  }

  function handleSaved(entry: SpeakerLibraryEntry_Serialize) {
    setSpeakers((prev) => {
      if (!prev) return [entry];
      const exists = prev.some((s) => s.id === entry.id);
      return exists ? prev.map((s) => (s.id === entry.id ? entry : s)) : [...prev, entry];
    });
  }

  if (speakers === null) {
    return (
      <Center h="100%">
        <Loader size="sm" />
      </Center>
    );
  }

  const active = speakers.filter((s) => !s.archived);

  return (
    <Stack h="100%" p="md" gap="md">
      <Group justify="space-between">
        <Text fw={500} size="sm" c="dimmed">
          Speaker Library
        </Text>
      </Group>

      {active.length === 0 ? (
        <Center className="flex-1">
          <Text c="dimmed" size="sm">
            No speakers yet.
          </Text>
        </Center>
      ) : (
        <Table.ScrollContainer minWidth={480}>
          <Table highlightOnHover verticalSpacing="xs">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Brand</Table.Th>
                <Table.Th>Family</Table.Th>
                <Table.Th>Model</Table.Th>
                <Table.Th>Application</Table.Th>
                <Table.Th>Ways</Table.Th>
                <Table.Th />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {active.map((speaker) => (
                <Table.Tr key={speaker.id}>
                  <Table.Td>{speaker.brand}</Table.Td>
                  <Table.Td>
                    {speaker.family ?? <Text component="span" c="dimmed">—</Text>}
                  </Table.Td>
                  <Table.Td>{speaker.model}</Table.Td>
                  <Table.Td>
                    {speaker.application ?? <Text component="span" c="dimmed">—</Text>}
                  </Table.Td>
                  <Table.Td>
                    {speaker.ways.length > 0 ? (
                      speaker.ways.map((w) => w.label).join(", ")
                    ) : (
                      <Text component="span" c="dimmed">—</Text>
                    )}
                  </Table.Td>
                  <Table.Td>
                    <Group gap="xs" justify="flex-end">
                      <Button size="xs" variant="subtle" onClick={() => setEditEntry(speaker)}>
                        Edit
                      </Button>
                      <Button
                        size="xs"
                        variant="subtle"
                        color="red"
                        onClick={() => handleArchive(speaker.id)}
                      >
                        Archive
                      </Button>
                    </Group>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}

      <SpeakerFormModal
        opened={editEntry !== null}
        onClose={() => setEditEntry(null)}
        editEntry={editEntry}
        onSaved={handleSaved}
      />
    </Stack>
  );
}
