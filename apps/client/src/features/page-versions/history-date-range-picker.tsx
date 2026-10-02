import { useState } from "react";
import { Button, Group, Popover, Stack, Text, TextInput } from "@mantine/core";
import { DatePicker } from "@mantine/dates";
import { IconCalendar } from "@tabler/icons-react";
import "dayjs/locale/zh-cn";
import {
  calendarRange,
  datePresets,
  dateRangeLabel,
  emptyDateRange,
  presetDateRange,
  validateDateRange,
  validDateText,
} from "./history-date-range";
import type { HistoryDateRange } from "./history-date-range";
import classes from "./history-workspace.module.css";

export function HistoryDateRangePicker({
  value,
  onApply,
}: {
  value: HistoryDateRange;
  onApply: (range: HistoryDateRange) => void;
}) {
  const [opened, setOpened] = useState(false);
  return (
    <Popover
      opened={opened}
      onChange={setOpened}
      width={310}
      position="bottom-end"
      floatingStrategy="fixed"
      preventPositionChangeWhenVisible={false}
      middlewares={{ flip: true, shift: { padding: 12, crossAxis: true } }}
      shadow="sm"
      trapFocus
      returnFocus
      withinPortal
    >
      <Popover.Target>
        <Button
          variant="default"
          size="xs"
          fullWidth
          justify="flex-start"
          leftSection={<IconCalendar size={15} />}
          aria-label="日期范围"
          onClick={() => setOpened(!opened)}
        >
          {dateRangeLabel(value)}
        </Button>
      </Popover.Target>
      <Popover.Dropdown
        className={classes.datePopover}
        aria-label="日期范围选择"
      >
        {opened && (
          <DateRangeDraft
            initial={value}
            onCancel={() => setOpened(false)}
            onApply={(range) => {
              onApply(range);
              setOpened(false);
            }}
          />
        )}
      </Popover.Dropdown>
    </Popover>
  );
}
function DateRangeDraft({
  initial,
  onApply,
  onCancel,
}: {
  initial: HistoryDateRange;
  onApply: (value: HistoryDateRange) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<HistoryDateRange>(initial);
  const [month, setMonth] = useState(
    initial.from || presetDateRange("今天").from,
  );
  const checked = validateDateRange(draft);
  const change = (key: "from" | "until", text: string) => {
    setDraft((old) => ({ ...old, [key]: text }));
    const date = validDateText(text);
    if (date) setMonth(date);
  };
  return (
    <Stack
      gap="xs"
      data-testid="history-date-draft"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          onCancel();
        }
      }}
    >
      <Text size="sm" fw={500}>
        选择日期范围
      </Text>
      <Group grow gap="xs" align="flex-start">
        <TextInput
          size="xs"
          label="开始日期"
          placeholder="年-月-日"
          value={draft.from}
          autoComplete="off"
          onChange={(e) => change("from", e.currentTarget.value)}
          aria-invalid={!!draft.from && !validDateText(draft.from)}
        />
        <TextInput
          size="xs"
          label="结束日期"
          placeholder="年-月-日"
          value={draft.until}
          autoComplete="off"
          onChange={(e) => change("until", e.currentTarget.value)}
          aria-invalid={!!draft.until && !validDateText(draft.until)}
        />
      </Group>
      <DatePicker
        type="range"
        allowSingleDateInRange
        locale="zh-cn"
        size="sm"
        fullWidth
        value={calendarRange(draft)}
        date={month}
        onDateChange={setMonth}
        onChange={(value) =>
          setDraft({ from: value[0] || "", until: value[1] || "" })
        }
        getDayProps={(day) => ({ "aria-label": `日期 ${day}` })}
        ariaLabels={{
          nextMonth: "下个月",
          previousMonth: "上个月",
          monthLevelControl: "选择月份",
          yearLevelControl: "选择年份",
        }}
      />
      <Group gap={4}>
        {datePresets.map((preset) => (
          <Button
            key={preset}
            data-date-preset={preset}
            variant="subtle"
            color="gray"
            size="compact-xs"
            onClick={() => {
              const range = presetDateRange(preset);
              setDraft(range);
              setMonth(range.from);
            }}
          >
            {preset}
          </Button>
        ))}
      </Group>
      <Text
        size="xs"
        c={checked.valid ? "dimmed" : "red"}
        aria-live="polite"
        data-testid="date-range-message"
      >
        {checked.valid ? "按本机时区，包含结束日期全天" : checked.message}
      </Text>
      <Group justify="space-between" gap="xs">
        <Button
          size="compact-xs"
          color="gray"
          variant="subtle"
          onClick={() => setDraft({ ...emptyDateRange })}
        >
          清除日期
        </Button>
        <Group gap={6}>
          <Button size="xs" variant="default" onClick={onCancel}>
            取消
          </Button>
          <Button
            size="xs"
            disabled={!checked.valid}
            onClick={() => {
              if (checked.valid) onApply(checked.value);
            }}
          >
            应用
          </Button>
        </Group>
      </Group>
    </Stack>
  );
}
