import { Menu, MenuButton, MenuItem, MenuItems, MenuSeparator } from "@headlessui/react";
import {
  ArrowRightStartOnRectangleIcon,
  Bars3Icon,
  CheckIcon,
  UserCircleIcon,
  WrenchScrewdriverIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import { Form, Link, NavLink, useLocation } from "react-router";

import type { IconComponent } from "~/components/ui";

export interface AdminNavItem {
  to: string;
  label: string;
  icon: IconComponent;
  /** Only active on an exact match (the dashboard index). */
  end: boolean;
}

function isActive(item: AdminNavItem, pathname: string) {
  const path = pathname.replace(/\/+$/, "") || "/";
  return item.end ? path === item.to : path === item.to || path.startsWith(`${item.to}/`);
}

/**
 * Admin top bar. Below lg: logo, title and a dropdown menu (Headless UI Menu) holding the navigation and account.
 * From lg: one row with logo, title, inline tabs and the account chip.
 */
const LOGOUT_FORM = "admin-logout";

export function AdminHeader({
  items,
  email,
  dev,
  canLogout,
}: {
  items: AdminNavItem[];
  email: string;
  dev: boolean;
  /** False for the local development bypass (there is no session to end). */
  canLogout: boolean;
}) {
  const { pathname } = useLocation();
  const current = items.find((i) => isActive(i, pathname)) ?? items[0];

  return (
    <header className="sticky top-0 z-40 border-b border-slate-200/80 bg-white/80 backdrop-blur-md">
      {canLogout ? <Form id={LOGOUT_FORM} method="post" action="/admin/logout" className="hidden" /> : null}
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-3 px-4 sm:px-6 lg:gap-6">
        <Link
          to="/admin"
          aria-label="Dashboard Panitia – beranda"
          className="flex shrink-0 items-center gap-3 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-4"
        >
          <img src="/logo-ppme.png" alt="PPME Den Haag" width={135} height={70} className="h-8 w-auto sm:h-9" />
          <span className="h-6 w-px bg-slate-200 lg:hidden xl:block" aria-hidden="true" />
          <span className="text-sm font-semibold whitespace-nowrap text-slate-900 lg:hidden xl:inline">
            Dashboard Panitia
          </span>
        </Link>

        {/* lg+: inline tabs, the active one underlined flush with the bottom border */}
        <nav aria-label="Navigasi admin" className="hidden h-full items-stretch gap-1 lg:flex">
          {items.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive: active }) =>
                `group -mb-px inline-flex items-center gap-2 border-b-2 px-3 text-sm font-medium whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-inset ${
                  active
                    ? "border-brand text-brand-dark"
                    : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-800"
                }`
              }
            >
              {({ isActive: active }) => (
                <>
                  <Icon
                    className={`size-4 ${active ? "text-brand" : "text-slate-400 group-hover:text-slate-500"}`}
                    aria-hidden="true"
                  />
                  {label}
                </>
              )}
            </NavLink>
          ))}
        </nav>

        {/* lg+: account */}
        <div className="ml-auto hidden min-w-0 items-center gap-2 lg:flex">
          {dev ? <DevBadge /> : null}
          <span
            className="flex min-w-0 items-center gap-2 rounded-lg border border-slate-200/80 bg-white/80 px-2.5 py-1.5 text-xs text-slate-600"
            title={email}
          >
            <UserCircleIcon className="size-4 shrink-0 text-slate-400" aria-hidden="true" />
            <span className="max-w-44 truncate xl:max-w-64">{email}</span>
          </span>
          {canLogout ? (
            <button
              type="submit"
              form={LOGOUT_FORM}
              title="Keluar"
              className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg border border-slate-200/80 bg-white/80 text-slate-500 transition hover:border-red-200 hover:bg-red-50 hover:text-red-700 focus-visible:ring-2 focus-visible:ring-brand focus-visible:outline-none"
            >
              <ArrowRightStartOnRectangleIcon className="size-4" aria-hidden="true" />
              <span className="sr-only">Keluar</span>
            </button>
          ) : null}
        </div>

        {/* below lg: dropdown menu */}
        <Menu as="div" className="ml-auto lg:hidden">
          <MenuButton
            aria-label={`Menu navigasi (halaman: ${current.label})`}
            className="group relative inline-flex size-11 items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-600 shadow-xs transition hover:border-slate-400 hover:text-slate-900 focus:outline-none data-active:bg-slate-50 data-focus:ring-4 data-focus:ring-brand/15 data-open:border-brand data-open:bg-brand-50 data-open:text-brand"
          >
            <Bars3Icon
              className="size-6 transition duration-150 group-data-open:scale-75 group-data-open:opacity-0"
              aria-hidden="true"
            />
            <XMarkIcon
              className="absolute size-6 scale-75 opacity-0 transition duration-150 group-data-open:scale-100 group-data-open:opacity-100"
              aria-hidden="true"
            />
          </MenuButton>
          <MenuItems
            anchor="bottom end"
            transition
            modal={false}
            className="z-50 w-[min(20rem,calc(100vw-2rem))] origin-top-right rounded-lg border border-slate-200 bg-white p-1 shadow-xl shadow-slate-900/10 [--anchor-gap:8px] transition duration-150 ease-out focus:outline-none data-closed:-translate-y-1 data-closed:opacity-0"
          >
            <div className="flex items-start gap-2.5 px-3 pt-2.5 pb-3">
              <UserCircleIcon className="size-8 shrink-0 text-slate-300" aria-hidden="true" />
              <div className="min-w-0">
                <div className="text-[11px] font-semibold tracking-[0.12em] text-slate-500 uppercase">Masuk sebagai</div>
                <div className="text-sm font-medium break-all text-slate-900">{email}</div>
                {dev ? <DevBadge className="mt-1.5" /> : null}
              </div>
            </div>
            <MenuSeparator className="mx-1 mb-1 h-px bg-slate-100" />
            {items.map((item) => {
              const active = item === current;
              const Icon = item.icon;
              return (
                <MenuItem key={item.to}>
                  <Link
                    to={item.to}
                    aria-current={active ? "page" : undefined}
                    className={`flex min-h-11 items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors data-focus:bg-slate-50 ${
                      active ? "bg-brand-50 text-brand-dark data-focus:bg-brand-50" : "text-slate-700"
                    }`}
                  >
                    <Icon className={`size-5 ${active ? "text-brand" : "text-slate-400"}`} aria-hidden="true" />
                    <span className="flex-1">{item.label}</span>
                    {active ? <CheckIcon className="size-4 text-brand" aria-hidden="true" /> : null}
                  </Link>
                </MenuItem>
              );
            })}
            {canLogout ? (
              <>
                <MenuSeparator className="mx-1 my-1 h-px bg-slate-100" />
                <MenuItem>
                  <button
                    type="submit"
                    form={LOGOUT_FORM}
                    className="flex min-h-11 w-full items-center gap-3 rounded-md px-3 text-left text-sm font-medium text-slate-700 transition-colors data-focus:bg-red-50 data-focus:text-red-700"
                  >
                    <ArrowRightStartOnRectangleIcon className="size-5 text-slate-400" aria-hidden="true" />
                    Keluar
                  </button>
                </MenuItem>
              </>
            ) : null}
          </MenuItems>
        </Menu>
      </div>
    </header>
  );
}

function DevBadge({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-md bg-amber-50 px-2 py-1 text-xs font-medium whitespace-nowrap text-amber-800 ring-1 ring-amber-600/20 ring-inset ${className}`}
    >
      <WrenchScrewdriverIcon className="size-3.5" aria-hidden="true" />
      Mode lokal
    </span>
  );
}
