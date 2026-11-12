import { useId, useState, type ComponentProps, type ReactNode } from "react";
import {
  Checkbox,
  Combobox,
  ComboboxButton,
  ComboboxInput,
  ComboboxOption,
  ComboboxOptions,
  Description,
  Field as HeadlessField,
  Label as HeadlessLabel,
  Radio,
  RadioGroup,
} from "@headlessui/react";
import { CheckIcon, ChevronUpDownIcon, ExclamationCircleIcon, UsersIcon } from "@heroicons/react/24/outline";

import type { IconComponent } from "~/components/ui";

/** Text input look shared by the public form (icon padding is added by the caller). */
export function inputClass(invalid?: boolean, withIcon = true) {
  return `block w-full min-h-12 rounded-lg border bg-white py-2.5 pr-3 text-[15px] text-slate-900 shadow-xs transition duration-150 placeholder:text-slate-400 focus:outline-none focus:ring-4 ${
    withIcon ? "pl-10" : "pl-3.5"
  } ${
    invalid
      ? "border-red-400 focus:border-red-500 focus:ring-red-500/15"
      : "border-slate-300 hover:border-slate-400 focus:border-brand focus:ring-brand/15"
  }`;
}

function RequiredMark() {
  return (
    <span className="ml-0.5 text-red-600" aria-hidden="true">
      *
    </span>
  );
}

export function FieldError({ id, children }: { id?: string; children?: ReactNode }) {
  if (!children) return null;
  return (
    <p id={id} className="mt-1.5 flex items-start gap-1.5 text-[13px] font-medium text-red-600">
      <ExclamationCircleIcon className="mt-px size-4 shrink-0" aria-hidden="true" />
      <span>{children}</span>
    </p>
  );
}

const labelCls = "mb-1.5 block text-sm font-medium text-slate-800";

/** Labelled text input with a leading icon, hint and an explicit error line (wired up via aria-describedby). */
export function TextInputField({
  label,
  icon: Icon,
  hint,
  error,
  required = true,
  className = "",
  ...input
}: {
  label: string;
  icon: IconComponent;
  hint?: string;
  error?: string;
  className?: string;
} & Omit<ComponentProps<"input">, "className" | "id">) {
  const id = useId();
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  return (
    <div className={className}>
      <label htmlFor={id} className={labelCls}>
        {label}
        {required ? <RequiredMark /> : null}
      </label>
      <div className="group relative">
        <Icon
          className={`pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2 transition-colors ${
            error ? "text-red-400" : "text-slate-400 group-focus-within:text-brand"
          }`}
          aria-hidden="true"
        />
        <input
          id={id}
          required={required}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={inputClass(!!error)}
          {...input}
        />
      </div>
      {error ? (
        <FieldError id={`${id}-error`}>{error}</FieldError>
      ) : hint ? (
        <p id={`${id}-hint`} className="mt-1.5 text-[13px] text-slate-500">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export interface ChoiceOption {
  value: string;
  label: string;
  hint?: string;
  disabled?: boolean;
}

/**
 * Headless UI RadioGroup rendered as flat selectable tiles with a custom radio indicator.
 * Posts a hidden input named `name`. The label names the group for screen readers.
 */
export function ChoiceField({
  label,
  name,
  value,
  onChange,
  options,
  error,
  className = "",
}: {
  label: string;
  name: string;
  value: string;
  onChange: (value: string) => void;
  options: ChoiceOption[];
  error?: string;
  className?: string;
}) {
  return (
    <HeadlessField className={className}>
      <HeadlessLabel className={labelCls}>
        {label}
        <RequiredMark />
      </HeadlessLabel>
      <RadioGroup
        name={name}
        value={value}
        onChange={onChange}
        aria-invalid={error ? true : undefined}
        className="grid grid-cols-2 gap-2"
      >
        {options.map((o) => (
          <Radio
            key={o.value}
            value={o.value}
            disabled={o.disabled}
            className={`group flex min-h-12 cursor-pointer items-center gap-3 rounded-lg border bg-white px-3.5 py-2.5 shadow-xs transition duration-150 select-none hover:border-slate-400 data-checked:border-brand data-checked:bg-brand-50/70 data-checked:shadow-[inset_0_0_0_1px_var(--color-brand)] data-focus:outline-none data-focus:ring-4 data-focus:ring-brand/15 data-disabled:cursor-not-allowed data-disabled:border-slate-200 data-disabled:bg-slate-50 data-disabled:shadow-none data-disabled:hover:border-slate-200 ${
              error ? "border-red-400" : "border-slate-300"
            }`}
          >
            <span
              className="flex size-[18px] shrink-0 items-center justify-center rounded-full border border-slate-300 bg-white transition group-data-checked:border-brand group-data-checked:bg-brand group-data-disabled:border-slate-200 group-data-disabled:bg-slate-100"
              aria-hidden="true"
            >
              <span className="size-1.5 rounded-full bg-white opacity-0 transition group-data-checked:opacity-100" />
            </span>
            <span className="min-w-0 leading-tight">
              <span className="block text-[15px] font-medium text-slate-800 group-data-checked:text-brand-dark group-data-disabled:text-slate-400">
                {o.label}
              </span>
              {o.hint ? (
                <span className="mt-0.5 block text-xs text-slate-500 group-data-disabled:text-slate-400">{o.hint}</span>
              ) : null}
            </span>
          </Radio>
        ))}
      </RadioGroup>
      <FieldError>{error}</FieldError>
    </HeadlessField>
  );
}

/** Headless UI Checkbox with its label. Posts `name=on` when checked (nothing when unchecked). */
export function CheckField({
  name,
  checked,
  onChange,
  invalid,
  required,
  description,
  children,
}: {
  name: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  invalid?: boolean;
  required?: boolean;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <HeadlessField className="flex items-start gap-3">
      <Checkbox
        name={name}
        value="on"
        checked={checked}
        onChange={onChange}
        aria-invalid={invalid ? true : undefined}
        className={`group mt-0.5 flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-[5px] border bg-white shadow-xs transition focus:outline-none data-checked:border-brand data-checked:bg-brand data-focus:ring-4 data-focus:ring-brand/20 ${
          invalid ? "border-red-500" : "border-slate-400"
        }`}
      >
        <CheckIcon
          strokeWidth={3}
          className="size-3.5 text-white opacity-0 transition group-data-checked:opacity-100"
          aria-hidden="true"
        />
      </Checkbox>
      <div className="min-w-0">
        <HeadlessLabel className="cursor-pointer text-sm leading-relaxed text-slate-700 select-none">
          {children}
          {required ? <RequiredMark /> : null}
        </HeadlessLabel>
        {description ? <Description className="mt-0.5 text-[13px] text-slate-500">{description}</Description> : null}
      </div>
    </HeadlessField>
  );
}

/** Number-of-participants Combobox (1…max). Opens on focus; typing filters the list. */
export function CountCombobox({
  label,
  value,
  max,
  onChange,
  error,
  hint,
}: {
  label: string;
  value: number;
  max: number;
  onChange: (n: number) => void;
  error?: string;
  hint?: string;
}) {
  const [query, setQuery] = useState("");
  const all = Array.from({ length: max }, (_, i) => i + 1);
  const digits = query.replace(/\D/g, "");
  const shown = digits ? all.filter((n) => String(n).includes(digits)) : all;

  return (
    <Combobox
      value={value}
      onChange={(n: number | null) => {
        if (n) onChange(n);
      }}
      onClose={() => setQuery("")}
      immediate
    >
      <HeadlessField>
        <HeadlessLabel className={labelCls}>
          {label}
          <RequiredMark />
        </HeadlessLabel>
        <div className="group relative">
          <UsersIcon
            className="pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2 text-slate-400 transition-colors group-focus-within:text-brand"
            aria-hidden="true"
          />
          <ComboboxInput
            className={`${inputClass(!!error)} pr-11`}
            inputMode="numeric"
            autoComplete="off"
            displayValue={(n: number) => `${n} orang`}
            onChange={(e) => setQuery(e.target.value)}
          />
          <ComboboxButton
            aria-label="Pilih jumlah peserta"
            className="absolute inset-y-0 right-0 flex items-center rounded-r-lg px-3 text-slate-400 hover:text-brand focus:outline-none"
          >
            <ChevronUpDownIcon className="size-5" aria-hidden="true" />
          </ComboboxButton>
        </div>
        <ComboboxOptions
          anchor="bottom start"
          transition
          className="z-30 w-(--input-width) rounded-lg border border-slate-200 bg-white p-1 shadow-lg shadow-slate-900/10 [--anchor-gap:6px] [--anchor-max-height:22rem] transition duration-100 ease-out empty:invisible focus:outline-none data-closed:-translate-y-1 data-closed:opacity-0"
        >
          {shown.map((n) => (
            <ComboboxOption
              key={n}
              value={n}
              className="group flex cursor-pointer items-center justify-between rounded-md px-3 py-2.5 text-[15px] text-slate-700 select-none data-focus:bg-brand-50 data-focus:text-brand-dark data-selected:font-semibold data-selected:text-brand"
            >
              {n} orang
              <CheckIcon className="invisible size-4 text-brand group-data-selected:visible" aria-hidden="true" />
            </ComboboxOption>
          ))}
        </ComboboxOptions>
        {error ? (
          <FieldError>{error}</FieldError>
        ) : hint ? (
          <Description className="mt-1.5 text-[13px] text-slate-500">{hint}</Description>
        ) : null}
      </HeadlessField>
    </Combobox>
  );
}
