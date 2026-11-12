import { createContext } from "react-router";

/** Email of the authenticated committee member (set by the admin layout middleware). */
export const adminEmailContext = createContext<string>();
