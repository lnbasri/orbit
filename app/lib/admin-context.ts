import { createContext } from "react-router";
import type { AdminAccessSnapshot } from "./admin-access";

/** Email of the authenticated committee member (set by the admin layout middleware). */
export const adminEmailContext = createContext<string>();

/** How they signed in: "pin", "google", or "dev" (local bypass, no logout). */
export const adminAuthMethodContext = createContext<string>();

/** Server-computed module and sensitive-action permissions for this request. */
export const adminAccessContext = createContext<AdminAccessSnapshot>();
