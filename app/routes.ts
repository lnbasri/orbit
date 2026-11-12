import { type RouteConfig, index, layout, prefix, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("e/:slug", "routes/register.tsx"),

  ...prefix("admin", [
    // Login/logout and the Google callback sit outside the protected layout.
    route("login", "routes/admin/login.tsx"),
    route("logout", "routes/admin/logout.tsx"),
    route("auth/google", "routes/admin/auth-google.tsx"),
    route("auth/google/callback", "routes/admin/auth-google-callback.tsx"),
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
