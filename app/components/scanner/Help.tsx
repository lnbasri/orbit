import { Dialog, DialogBackdrop, DialogPanel } from "@headlessui/react";
import { LifebuoyIcon, PhoneIcon, ShieldCheckIcon, UserGroupIcon, BuildingOffice2Icon, XMarkIcon } from "@heroicons/react/24/outline";
import { useState } from "react";

import type { EscalationContact } from "~/lib/scanners.server";
import type { TextKey } from "~/lib/scanner-i18n";
import { useT } from "./lang";

const LEVELS = [
  { level: 1 as const, title: "level1" as TextKey, hint: "level1Hint" as TextKey, icon: ShieldCheckIcon },
  { level: 2 as const, title: "level2" as TextKey, hint: "level2Hint" as TextKey, icon: UserGroupIcon },
  { level: 3 as const, title: "level3" as TextKey, hint: "level3Hint" as TextKey, icon: BuildingOffice2Icon },
];

/** Escalation ladder: security, panitia, bestuur. Opening a level records the escalation and shows who to call. */
export function HelpSheet({
  open,
  onClose,
  contacts,
  onEscalate,
}: {
  open: boolean;
  onClose: () => void;
  contacts: Pick<EscalationContact, "id" | "level" | "name" | "role_label" | "phone" | "note">[];
  onEscalate: (level: 1 | 2 | 3) => void;
}) {
  const T = useT();
  const [opened, setOpened] = useState<Set<number>>(new Set());

  function openLevel(level: 1 | 2 | 3) {
    if (opened.has(level)) return;
    setOpened(new Set(opened).add(level));
    onEscalate(level);
  }

  return (
    <Dialog open={open} onClose={onClose} className="relative z-50">
      <DialogBackdrop transition className="fixed inset-0 bg-slate-950/50 transition-opacity duration-200 data-[closed]:opacity-0" />
      <div className="fixed inset-0 flex items-end justify-center">
        <DialogPanel
          transition
          className="max-h-[88dvh] w-full max-w-md overflow-y-auto border border-slate-200 bg-white shadow-xl transition duration-200 data-[closed]:translate-y-6 data-[closed]:opacity-0"
        >
          <div className="sticky top-0 flex items-center justify-between gap-3 border-b border-slate-200 bg-white px-5 py-3">
            <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900">
              <LifebuoyIcon className="size-5 text-brand" aria-hidden="true" />
              {T("helpTitle")}
            </h2>
            <button type="button" onClick={onClose} aria-label={T("close")} className="flex size-10 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand">
              <XMarkIcon className="size-5" aria-hidden="true" />
            </button>
          </div>
          <div className="space-y-5 px-5 py-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
            <p className="text-sm leading-relaxed text-slate-600">{T("helpIntro")}</p>
            <ol className="space-y-3">
              {LEVELS.map(({ level, title, hint, icon: Icon }, i) => {
                const list = contacts.filter((c) => c.level === level);
                const shown = opened.has(level);
                return (
                  <li key={level} className="border border-slate-200">
                    <button
                      type="button"
                      onClick={() => openLevel(level)}
                      aria-expanded={shown}
                      className="flex w-full items-start gap-3 px-4 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand"
                    >
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-md border border-brand-200 bg-brand-50 text-sm font-semibold text-brand">{i + 1}</span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2 font-semibold text-slate-900">
                          <Icon className="size-4 text-brand" aria-hidden="true" />
                          {T(title)}
                        </span>
                        <span className="mt-0.5 block text-sm leading-snug text-slate-500">{T(hint)}</span>
                      </span>
                    </button>
                    {shown ? (
                      <div className="space-y-2 border-t border-slate-200 bg-slate-50/70 px-4 py-3">
                        {list.length === 0 ? (
                          <p className="text-sm text-slate-500">{T("noContacts")}</p>
                        ) : (
                          list.map((c) => (
                            <a
                              key={c.id}
                              href={`tel:${c.phone}`}
                              className="flex min-h-12 items-center gap-3 border border-slate-200 bg-white px-3 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                            >
                              <PhoneIcon className="size-5 shrink-0 text-brand" aria-hidden="true" />
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-[15px] font-semibold text-slate-900">{c.name}</span>
                                <span className="block truncate text-xs text-slate-500">{[c.role_label, c.phone].filter(Boolean).join(" · ")}</span>
                              </span>
                            </a>
                          ))
                        )}
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ol>
            <p className="border-l-2 border-red-600 bg-red-50/70 px-4 py-3 text-sm font-medium text-red-900">{T("unsafe")}</p>
            <p className="text-xs leading-relaxed text-slate-500">{T("supportFooter")}</p>
          </div>
        </DialogPanel>
      </div>
    </Dialog>
  );
}
