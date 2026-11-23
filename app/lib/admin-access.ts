export const ADMIN_ACCESS_ROLES = [
  {
    id: "MEMBERSHIP",
    label: "Membership",
    description: "Members, households, groups, and the organisation overview.",
    modules: ["overview", "members", "households", "groups"],
    capabilities: [],
  },
  {
    id: "FINANCE",
    label: "Finance",
    description: "Contribution records and payments.",
    modules: ["contributions"],
    capabilities: [],
  },
  {
    id: "COMMUNICATIONS",
    label: "Communications",
    description: "Consent-based communications, recipient lists, and templates.",
    modules: ["communications"],
    capabilities: [],
  },
  {
    id: "DOCUMENT_PREPARER",
    label: "Document preparer",
    description: "Prepare templates and generate documents; cannot approve them.",
    modules: ["documents"],
    capabilities: [],
  },
  {
    id: "APPROVER",
    label: "Approver",
    description: "Review and decide assigned document and communication requests.",
    modules: ["approvals"],
    capabilities: ["approvals.decide"],
  },
  {
    id: "PRIVACY",
    label: "Privacy",
    description: "Manage the privacy request register.",
    modules: ["privacy"],
    capabilities: [],
  },
] as const;

export const ADMIN_CAPABILITY_OPTIONS = [
  { id: "members.export", label: "Export member data (CSV/Excel)" },
  { id: "members.import", label: "Import members from CSV" },
  { id: "communications.export", label: "Export communication recipients" },
  { id: "documents.download", label: "Download approved PDFs" },
  { id: "privacy.export", label: "Prepare personal-data export packages" },
] as const;

export type AdminAccessRole = (typeof ADMIN_ACCESS_ROLES)[number]["id"];
export type AdminCapability =
  | (typeof ADMIN_CAPABILITY_OPTIONS)[number]["id"]
  | "approvals.decide";
export type AdminModule =
  | "overview"
  | "members"
  | "households"
  | "groups"
  | "contributions"
  | "communications"
  | "documents"
  | "approvals"
  | "privacy";

export interface AdminAccessSnapshot {
  role: "SUPER_ADMIN" | "ADMIN" | "dev";
  roles: AdminAccessRole[];
  modules: AdminModule[];
  capabilities: AdminCapability[];
  departments: string[];
  isLegacy: boolean;
}

export type AdminRouteAccess =
  | { kind: "module"; key: AdminModule }
  | { kind: "capability"; key: AdminCapability }
  | { kind: "super-admin" };

export const ALL_ADMIN_MODULES: AdminModule[] = [
  "overview",
  "members",
  "households",
  "groups",
  "contributions",
  "communications",
  "documents",
  "approvals",
  "privacy",
];

export const ALL_ADMIN_CAPABILITIES: AdminCapability[] = [
  "approvals.decide",
  ...ADMIN_CAPABILITY_OPTIONS.map((item) => item.id),
];

export function hasAdminModule(access: AdminAccessSnapshot, module: AdminModule): boolean {
  return access.modules.includes(module);
}

export function hasAdminCapability(access: AdminAccessSnapshot, capability: AdminCapability): boolean {
  return access.capabilities.includes(capability);
}

export function hasAdminRouteAccess(access: AdminAccessSnapshot, route: AdminRouteAccess): boolean {
  if (route.kind === "super-admin") return access.role === "SUPER_ADMIN" || access.role === "dev";
  if (route.kind === "module") return hasAdminModule(access, route.key);
  return hasAdminCapability(access, route.key);
}

export function getAdminRouteAccess(path: string): AdminRouteAccess | null {
  const normalizedPath = path.replace(/\/+$/, "") || "/";
  if (normalizedPath === "/admin") return { kind: "module", key: "overview" };
  if (/^\/admin\/members(?:\/(?:new|[A-Za-z0-9_-]+))?$/.test(normalizedPath)) {
    return { kind: "module", key: "members" };
  }
  if (/^\/admin\/households(?:\/[A-Za-z0-9_-]+)?$/.test(normalizedPath)) {
    return { kind: "module", key: "households" };
  }
  if (normalizedPath === "/admin/groups") return { kind: "module", key: "groups" };
  if (normalizedPath === "/admin/contributions") return { kind: "module", key: "contributions" };
  if (normalizedPath === "/admin/communications") return { kind: "module", key: "communications" };
  if (normalizedPath === "/admin/privacy") return { kind: "module", key: "privacy" };
  if (normalizedPath === "/admin/approvals") return { kind: "module", key: "approvals" };
  if (/^\/admin\/documents\/[A-Za-z0-9_-]+\/download$/.test(normalizedPath)) {
    return { kind: "capability", key: "documents.download" };
  }
  if (normalizedPath === "/admin/documents") return { kind: "module", key: "documents" };
  if (normalizedPath === "/admin/admins") return { kind: "super-admin" };
  return null;
}

export function defaultAdminPath(access: AdminAccessSnapshot): string {
  if (hasAdminModule(access, "overview")) return "/admin";
  const destinations: [AdminModule, string][] = [
    ["members", "/admin/members"],
    ["contributions", "/admin/contributions"],
    ["communications", "/admin/communications"],
    ["documents", "/admin/documents"],
    ["approvals", "/admin/approvals"],
    ["privacy", "/admin/privacy"],
  ];
  return destinations.find(([module]) => hasAdminModule(access, module))?.[1] ?? "/admin";
}
