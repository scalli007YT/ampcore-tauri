import { NumberInput, type NumberInputProps } from "@mantine/core";
import { useEffect, useRef, useState } from "react";

type CommitNumberInputProps = Omit<NumberInputProps, "value" | "onChange" | "onFocus" | "onBlur" | "onKeyDown"> & {
  value: number;
  /** Called once per committed edit, never per keystroke. */
  onCommit: (value: number) => void;
};

/**
 * A `NumberInput` that reports its value on **commit** (blur or Enter) rather
 * than on every keystroke.
 *
 * Mantine's `NumberInput` has no `onChangeEnd`, so a bare `onChange` fires once
 * per character: typing `1000` into a frequency field produces four separate
 * writes (1, 10, 100, 1000), and a held stepper produces one per repeat. On the
 * live path each of those is a UDP packet that the backend's write queue can
 * only retire one ACK round trip at a time, and each one extends the window in
 * which background polling is suspended (see `WriteRegistry::has_pending`).
 *
 * This mirrors the discipline `EqEditor`'s graph drag already uses — preview
 * locally, commit once — and the vendor app's own approach of disabling the
 * page during a transaction so it cannot emit a burst at all.
 *
 * Escape reverts to the last upstream value without committing.
 */
export function CommitNumberInput({ value, onCommit, ...rest }: CommitNumberInputProps) {
  const [draft, setDraft] = useState<string | number>(value);
  const focused = useRef(false);
  const cancelled = useRef(false);

  // Re-sync from upstream only while the field is NOT being edited. Without
  // this guard the ~200ms config poll would overwrite whatever the user is
  // halfway through typing.
  useEffect(() => {
    if (!focused.current) setDraft(value);
  }, [value]);

  const commit = () => {
    const next = typeof draft === "number" ? draft : Number.parseFloat(draft);
    if (Number.isFinite(next) && next !== value) onCommit(next);
    else setDraft(value);
  };

  return (
    <NumberInput
      {...rest}
      value={draft}
      onChange={setDraft}
      onFocus={() => {
        focused.current = true;
      }}
      onBlur={() => {
        focused.current = false;
        if (cancelled.current) {
          cancelled.current = false;
          setDraft(value);
          return;
        }
        commit();
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.currentTarget.blur();
        } else if (event.key === "Escape") {
          cancelled.current = true;
          event.currentTarget.blur();
        }
      }}
    />
  );
}
