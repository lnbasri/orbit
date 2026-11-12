import { type RouteConfig, index, layout, prefix, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("e/:slug", "routes/register.tsx"),

  ...prefix("admin", [
    layout("routes/admin/layout.tsx", [
      index("routes/admin/dashboard.tsx"),
      route("registrations", "routes/admin/registrations.tsx"),
      route("registrations/:id", "routes/admin/registration-detail.tsx"),
      route("admins", "routes/admin/admins.tsx"),
      route("settings", "routes/admin/settings.tsx"),
      route("export", "routes/admin/export.tsx"),
      route("outbox", "routes/admin/outbox.tsx"),
      route("outbox/:id/html", "routes/admin/outbox-html.tsx"),
    ]),
  ]),
] satisfies RouteConfig;
