import { useEffect, useMemo, useState } from "react";
import {
  Box,
  Button,
  Center,
  Collapse,
  Group,
  Modal,
  Stack,
  Table,
  Text,
  TextInput,
  ThemeIcon,
  Tree,
  UnstyledButton,
  getTreeExpandedState,
  useTree,
  type RenderTreeNodePayload,
  type TreeNodeData,
} from "@mantine/core";
import { ChevronDown, ChevronRight, Server } from "lucide-react";
import { commands, type AmpModelCatalogEntry, type Project } from "../lib/bindings";
import { AMP_SPEC_SHEETS } from "../lib/ampSpecSheets";

interface AmpCatalogueModalProps {
  opened: boolean;
  onClose: () => void;
  projectId: string;
  ampModels: AmpModelCatalogEntry[];
  onProjectUpdate: (project: Project) => void;
}

function wattsOf(model: AmpModelCatalogEntry): number {
  return AMP_SPEC_SHEETS[model.model]?.watts8ohm ?? -1;
}

/** Maps every node value to its sibling values (same parent), so expanding
 * one node in a layer can collapse the rest of that layer. */
function buildSiblingMap(nodes: TreeNodeData[], map = new Map<string, string[]>()): Map<string, string[]> {
  const values = nodes.map((n) => n.value);
  for (const node of nodes) {
    map.set(node.value, values.filter((v) => v !== node.value));
    if (node.children) buildSiblingMap(node.children, map);
  }
  return map;
}

export function AmpCatalogueModal({
  opened,
  onClose,
  projectId,
  ampModels,
  onProjectUpdate,
}: AmpCatalogueModalProps) {
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);
  const [specsExpanded, setSpecsExpanded] = useState(false);
  const [label, setLabel] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const active = useMemo(() => ampModels.filter((m) => !m.archived), [ampModels]);
  const modelById = useMemo(() => {
    const map = new Map<string, AmpModelCatalogEntry>();
    for (const m of active) map.set(m.id, m);
    return map;
  }, [active]);

  const regular = useMemo(() => active.filter((m) => !m.model.endsWith("D")), [active]);
  const dante = useMemo(() => active.filter((m) => m.model.endsWith("D")), [active]);

  const regularFourChannel = useMemo(
    () => regular.filter((m) => m.channelCount === 4).sort((a, b) => wattsOf(b) - wattsOf(a)),
    [regular],
  );
  const regularTwoChannel = useMemo(
    () => regular.filter((m) => m.channelCount === 2).sort((a, b) => wattsOf(b) - wattsOf(a)),
    [regular],
  );
  const danteFourChannel = useMemo(
    () => dante.filter((m) => m.channelCount === 4).sort((a, b) => wattsOf(b) - wattsOf(a)),
    [dante],
  );
  const danteTwoChannel = useMemo(
    () => dante.filter((m) => m.channelCount === 2).sort((a, b) => wattsOf(b) - wattsOf(a)),
    [dante],
  );

  const treeData: TreeNodeData[] = useMemo(
    () => [
      {
        label: "CVR",
        value: "cvr",
        children: [
          {
            label: "Regular",
            value: "regular",
            children: [
              {
                label: "4-Channel",
                value: "regular-4ch",
                children: regularFourChannel.map((m) => ({ label: m.model, value: m.id })),
              },
              {
                label: "2-Channel",
                value: "regular-2ch",
                children: regularTwoChannel.map((m) => ({ label: m.model, value: m.id })),
              },
            ],
          },
          {
            label: "Dante",
            value: "dante",
            children: [
              {
                label: "4-Channel",
                value: "dante-4ch",
                children: danteFourChannel.map((m) => ({ label: m.model, value: m.id })),
              },
              {
                label: "2-Channel",
                value: "dante-2ch",
                children: danteTwoChannel.map((m) => ({ label: m.model, value: m.id })),
              },
            ],
          },
        ],
      },
    ],
    [regularFourChannel, regularTwoChannel, danteFourChannel, danteTwoChannel],
  );

  const siblingMap = useMemo(() => buildSiblingMap(treeData), [treeData]);

  const [expandedState, setExpandedState] = useState<Record<string, boolean>>(() =>
    getTreeExpandedState(treeData, ["cvr", "regular", "regular-4ch"]),
  );

  function handleExpandedStateChange(newState: Record<string, boolean>) {
    const next = { ...newState };
    for (const value of Object.keys(newState)) {
      if (newState[value] && !expandedState[value]) {
        for (const sibling of siblingMap.get(value) ?? []) {
          next[sibling] = false;
        }
      }
    }
    setExpandedState(next);
  }

  const tree = useTree({
    expandedState,
    onExpandedStateChange: handleExpandedStateChange,
  });

  useEffect(() => {
    if (opened) {
      setSelectedModelId(null);
      setSpecsExpanded(false);
      setLabel("");
      setSubmitError(null);
      setExpandedState(getTreeExpandedState(treeData, ["cvr", "regular", "regular-4ch"]));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened]);

  const selectedModel = selectedModelId ? modelById.get(selectedModelId) ?? null : null;
  const selectedSpec = selectedModel ? AMP_SPEC_SHEETS[selectedModel.model] : undefined;

  async function handleAddAssignment() {
    if (!selectedModelId) return;
    setSubmitError(null);
    setSubmitting(true);
    const result = await commands.projectsAddAmpAssignment(projectId, label.trim() || null, selectedModelId);
    setSubmitting(false);
    if (result.status === "ok") {
      onProjectUpdate(result.data);
      onClose();
    } else {
      setSubmitError(result.error.message);
    }
  }

  function renderNode({ node, hasChildren, expanded, elementProps }: RenderTreeNodePayload) {
    if (!hasChildren) {
      const m = modelById.get(node.value);
      if (!m) return null;
      const spec = AMP_SPEC_SHEETS[m.model];
      const isSelected = m.id === selectedModelId;
      return (
        <div
          {...elementProps}
          onClick={(e) => {
            elementProps.onClick(e);
            setSelectedModelId(m.id);
            setSpecsExpanded(false);
            setSubmitError(null);
          }}
          style={{
            ...elementProps.style,
            cursor: "pointer",
            borderRadius: "var(--mantine-radius-xs)",
            padding: "4px var(--mantine-spacing-xs)",
            backgroundColor: isSelected ? "var(--mantine-color-amber-light)" : undefined,
          }}
        >
          <Group gap="xs" wrap="nowrap">
            <ThemeIcon variant="light" color="gray" size="lg">
              <Server size={18} />
            </ThemeIcon>
            <div>
              <Text size="sm">{m.model}</Text>
              <Text size="xs" c="dimmed">
                {spec ? `${spec.watts8ohm}W @ 8Ω` : null}
              </Text>
            </div>
          </Group>
        </div>
      );
    }

    return (
      <Group {...elementProps} gap={4} wrap="nowrap" style={{ ...elementProps.style, cursor: "pointer", padding: "4px 0" }}>
        <ChevronRight
          size={14}
          style={{ transform: expanded ? "rotate(90deg)" : undefined, transition: "transform 100ms" }}
        />
        <Text size="sm" fw={600}>
          {node.label}
        </Text>
      </Group>
    );
  }

  return (
    <Modal opened={opened} onClose={onClose} title="Add Amp" size="xl" centered>
      <Group align="stretch" wrap="nowrap" gap="md" style={{ minHeight: 420 }}>
        <Box w={260}>
          <Tree data={treeData} tree={tree} renderNode={renderNode} levelOffset="md" />
        </Box>

        <Box style={{ flex: 1, display: "flex", flexDirection: "column" }}>
          {selectedModel ? (
            <Stack style={{ flex: 1 }}>
              <Group gap="xs">
                <ThemeIcon variant="light" color="gray" size="xl">
                  <Server size={28} />
                </ThemeIcon>
                <div>
                  <Text fw={600}>
                    {selectedModel.brand} {selectedModel.model}
                  </Text>
                  <Text size="xs" c="dimmed">
                    {selectedModel.channelCount}-Channel
                  </Text>
                </div>
              </Group>

              {selectedSpec ? (
                <Stack gap={4}>
                  <Group justify="space-between">
                    <Text size="sm">Wattage @ 8Ω / channel</Text>
                    <Text size="sm" fw={600}>
                      {selectedSpec.watts8ohm}W
                    </Text>
                  </Group>

                  <UnstyledButton
                    onClick={() => setSpecsExpanded((v) => !v)}
                    style={{ display: "inline-flex", alignItems: "center", gap: 4, width: "fit-content" }}
                  >
                    <Text size="xs" c="dimmed">
                      {specsExpanded ? "Hide more specs" : "Show more specs"}
                    </Text>
                    <ChevronDown
                      size={12}
                      style={{
                        transform: specsExpanded ? "rotate(180deg)" : undefined,
                        transition: "transform 100ms",
                      }}
                    />
                  </UnstyledButton>

                  <Collapse expanded={specsExpanded}>
                    <Table mt={4}>
                      <Table.Tbody>
                        <Table.Tr>
                          <Table.Td>4Ω / channel</Table.Td>
                          <Table.Td>{selectedSpec.watts4ohm}W</Table.Td>
                        </Table.Tr>
                        <Table.Tr>
                          <Table.Td>2Ω / channel</Table.Td>
                          <Table.Td>{selectedSpec.watts2ohm}W</Table.Td>
                        </Table.Tr>
                        <Table.Tr>
                          <Table.Td>8Ω Bridge</Table.Td>
                          <Table.Td>{selectedSpec.wattsBridge8ohm}W</Table.Td>
                        </Table.Tr>
                        <Table.Tr>
                          <Table.Td>Default Gain</Table.Td>
                          <Table.Td>{selectedSpec.defaultGainDb}dB</Table.Td>
                        </Table.Tr>
                        <Table.Tr>
                          <Table.Td>Gain Range</Table.Td>
                          <Table.Td>
                            {selectedSpec.gainRangeDb[0]}–{selectedSpec.gainRangeDb[1]}dB
                          </Table.Td>
                        </Table.Tr>
                        <Table.Tr>
                          <Table.Td>Size (W×H×D)</Table.Td>
                          <Table.Td>{selectedSpec.sizeWxHxDmm}</Table.Td>
                        </Table.Tr>
                        <Table.Tr>
                          <Table.Td>Weight</Table.Td>
                          <Table.Td>{selectedSpec.weightKg}kg</Table.Td>
                        </Table.Tr>
                      </Table.Tbody>
                    </Table>
                  </Collapse>
                </Stack>
              ) : (
                <Text c="dimmed" size="sm">
                  No spec sheet available for this model.
                </Text>
              )}

              <Stack gap="xs" mt="auto">
                <TextInput
                  label="Label"
                  placeholder="Optional"
                  value={label}
                  onChange={(e) => setLabel(e.currentTarget.value)}
                />
                <Text size="xs" c="dimmed">
                  This slot isn't linked to a physical unit yet — that happens later via network
                  discovery, not manual entry.
                </Text>
                {submitError && (
                  <Text c="red" size="sm">
                    {submitError}
                  </Text>
                )}
                <Group justify="flex-end">
                  <Button loading={submitting} onClick={handleAddAssignment}>
                    Add
                  </Button>
                </Group>
              </Stack>
            </Stack>
          ) : (
            <Center style={{ flex: 1 }}>
              <Text c="dimmed">Select an amp model from the list</Text>
            </Center>
          )}
        </Box>
      </Group>
    </Modal>
  );
}
