import {
  Field,
  Input,
  Label,
  Listbox,
  ListboxButton,
  ListboxOption,
  ListboxOptions,
} from "@headlessui/react";
import { CheckIcon, ChevronUpDownIcon } from "@heroicons/react/24/outline";
import type { ComponentProps } from "react";

import type { IconComponent } from "~/components/ui";

/** Shared look for text inputs in the admin area (matches the public form). */
export const inputClass =
  "block w-full min-h-11 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-xs transition duration-150 placeholder:text-slate-400 hover:border-slate-400 focus:border-brand focus:outline-none focus:ring-4 focus:ring-brand/15";

/** Headless UI Input with its label wired up (set `hideLabel` for a screen-reader-only label). */
export function TextField({
  label,
  hideLabel = false,
  icon: Icon,
  className = "",
  ...props
}: { label: string; hideLabel?: boolean; icon?: IconComponent; className?: string } & Omit<
  ComponentProps<"input">,
  "className"
>) {
  return (
    <Field className={className}>
      <Label className={hideLabel ? "sr-only" : "mb-1.5 block text-sm font-medium text-slate-700"}>{label}</Label>
      <div className="group relative">
        {Icon ? (
          <Icon
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400 transition-colors group-focus-within:text-brand"
            aria-hidden="true"
          />
        ) : null}
        <Input className={`${inputClass} ${Icon ? "pl-9" : ""}`} {...props} />
      </div>
    </Field>
  );
}

export interface SelectOption {
  value: string;
  label: string;
}

/**
 * Headless UI Listbox: the styled replacement for a native <select>. Posts a hidden input named `name`,
 * so it works inside a plain GET/POST form. The first option is treated as "no filter" and the button
 * is highlighted when anything else is chosen.
 */
export function ListboxSelect({
  name,
  label,
  value,
  onChange,
  options,
}: {
  name: string;
  /** Accessible name (not shown). */
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
}) {
  const selected = options.find((o) => o.value === value) ?? options[0];
  const filtered = value !== options[0].value;
  return (
    <Listbox name={name} value={value} onChange={onChange}>
      <ListboxButton
        aria-label={label}
        className={`flex min-h-11 w-full items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left text-sm shadow-xs transition duration-150 focus:outline-none data-focus:ring-4 data-focus:ring-brand/15 data-open:border-brand ${
          filtered
            ? "border-brand/60 bg-brand-50 font-medium text-brand-dark"
            : "border-slate-300 bg-white text-slate-700 hover:border-slate-400"
        }`}
      >
        <span className="truncate">{selected.label}</span>
        <ChevronUpDownIcon className={`size-4 shrink-0 ${filtered ? "text-brand" : "text-slate-400"}`} aria-hidden="true" />
      </ListboxButton>
      <ListboxOptions
        anchor="bottom start"
        transition
        className="z-30 w-(--button-width) min-w-52 rounded-lg border border-slate-200 bg-white p-1 shadow-lg shadow-slate-900/10 [--anchor-gap:6px] transition duration-100 ease-out focus:outline-none data-closed:-translate-y-1 data-closed:opacity-0"
      >
        {options.map((o) => (
          <ListboxOption
            key={o.value}
            value={o.value}
            className="group flex cursor-pointer items-center justify-between gap-2 rounded-md px-3 py-2 text-sm text-slate-700 select-none data-focus:bg-brand-50 data-focus:text-brand-dark data-selected:font-semibold data-selected:text-brand"
          >
            {o.label}
            <CheckIcon className="invisible size-4 shrink-0 text-brand group-data-selected:visible" aria-hidden="true" />
          </ListboxOption>
        ))}
      </ListboxOptions>
    </Listbox>
  );
}
