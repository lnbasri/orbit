import { createContext } from "react-router";

/** Email of the authenticated committee member (set by the admin layout middleware). */
export const adminEmailContext = createContext<string>();

/** How they signed in: "pin", "google", or "dev" (local bypass, no logout). */
export const adminAuthMethodContext = createContext<string>();

/** Administrator role: SUPER_ADMIN or ADMIN. */
export const adminRoleContext = createContext<"SUPER_ADMIN" | "ADMIN" | "dev">();
