import { type RouteConfig, index, layout, prefix, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),

  ...prefix("admin", [
    route("login", "routes/admin/login.tsx"),
    route("logout", "routes/admin/logout.tsx"),
    route("auth/google", "routes/admin/auth-google.tsx"),
    route("auth/google/callback", "routes/admin/auth-google-callback.tsx"),
    layout("routes/admin/layout.tsx", [
      index("routes/admin/dashboard.tsx"),
      route("members", "routes/admin/members.tsx"),
      route("members/new", "routes/admin/member-new.tsx"),
      route("members/:id", "routes/admin/member.tsx"),
      route("households", "routes/admin/households.tsx"),
      route("households/:id", "routes/admin/household-detail.tsx"),
      route("groups", "routes/admin/groups.tsx"),
      route("admins", "routes/admin/admins.tsx"),
    ]),
  ]),
] satisfies RouteConfig;
