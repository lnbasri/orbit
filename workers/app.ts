import { createRequestHandler } from "react-router";
import { createApprovalReminders } from "../app/lib/approvals.server";
import { emailConfig, emailDeliveryReady } from "../app/lib/config.server";
import { processEmailQueue } from "../app/lib/email.server";

const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE,
);

export default {
  async fetch(request) {
    return requestHandler(request);
  },
  async scheduled(_controller, env, context) {
    const work: Promise<unknown>[] = [createApprovalReminders(env.DB)];
    if (emailDeliveryReady(env)) {
      work.push(processEmailQueue(env.DB, emailConfig(env), true));
    }
    context.waitUntil(
      Promise.all(work).catch((error: unknown) => {
        console.error("ORBIT scheduled task failed:", error instanceof Error ? error.message : String(error));
        throw error;
      }),
    );
  },
} satisfies ExportedHandler<Env>;
