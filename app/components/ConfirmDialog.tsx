import { Description, Dialog, DialogBackdrop, DialogPanel, DialogTitle } from "@headlessui/react";
import { CheckIcon, ExclamationTriangleIcon, InformationCircleIcon, XMarkIcon } from "@heroicons/react/24/outline";
import type { ReactNode } from "react";

import { buttonClass, type IconComponent } from "~/components/ui";

export type { IconComponent };

/** info = blue (normal confirmation), danger = red (destructive or hard to undo). */
export type DialogTone = "info" | "danger";

export interface ConfirmConfig {
  title: string;
  description: ReactNode;
  confirmLabel?: string;
  tone?: DialogTone;
  /** Overrides the default icon for the tone. */
  icon?: IconComponent;
}

const TONES: Record<DialogTone, { tile: string; rule: string; variant: "primary" | "danger"; icon: IconComponent }> = {
  info: {
    tile: "border-brand-200 bg-brand-50 text-brand",
    rule: "bg-brand",
    variant: "primary",
    icon: InformationCircleIcon,
  },
  danger: {
    tile: "border-red-200 bg-red-50 text-red-600",
    rule: "bg-red-600",
    variant: "danger",
    icon: ExclamationTriangleIcon,
  },
};

/**
 * Confirmation modal (replaces the browser's window.confirm). Mobile: slides up from the bottom with
 * stacked full-width buttons; desktop: centred panel with buttons on the right. Escape / backdrop = cancel.
 */
export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = "Ya, lanjutkan",
  tone = "info",
  icon,
}: ConfirmConfig & { open: boolean; onClose: () => void; onConfirm: () => void }) {
  const t = TONES[tone];
  const Icon = icon ?? t.icon;
  return (
    <Dialog open={open} onClose={onClose} className="relative z-50">
      <DialogBackdrop
        transition
        className="fixed inset-0 bg-slate-950/40 backdrop-blur-[2px] transition duration-150 ease-out data-closed:opacity-0"
      />
      <div className="fixed inset-0 flex items-end justify-center p-3 sm:items-center sm:p-4">
        <DialogPanel
          transition
          className="w-full max-w-md overflow-hidden rounded-lg border border-slate-200 bg-white shadow-2xl shadow-slate-950/20 transition duration-150 ease-out data-closed:translate-y-4 data-closed:opacity-0 sm:data-closed:translate-y-0 sm:data-closed:scale-[0.97]"
        >
          <div className={`h-1 ${t.rule}`} aria-hidden="true" />
          <div className="flex gap-4 p-5 sm:p-6">
            <div className={`flex size-10 shrink-0 items-center justify-center rounded-lg border ${t.tile}`}>
              <Icon className="size-5" aria-hidden="true" />
            </div>
            <div className="min-w-0 pt-0.5">
              <DialogTitle className="text-base font-semibold text-slate-900">{title}</DialogTitle>
              <Description className="mt-1.5 text-sm leading-relaxed text-slate-600">{description}</Description>
            </div>
          </div>
          <div className="flex flex-col-reverse gap-2 border-t border-slate-200/80 bg-slate-50/80 px-5 py-4 sm:flex-row sm:justify-end sm:px-6">
            <button type="button" onClick={onClose} className={buttonClass("secondary", "md", "sm:min-h-10")}>
              <XMarkIcon className="size-4" aria-hidden="true" />
              Batal
            </button>
            <button type="button" onClick={onConfirm} className={buttonClass(t.variant, "md", "sm:min-h-10")}>
              <CheckIcon className="size-4" aria-hidden="true" />
              {confirmLabel}
            </button>
          </div>
        </DialogPanel>
      </div>
    </Dialog>
  );
}
