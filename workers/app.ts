import { createRequestHandler } from "react-router";
import { emailConfig, type AppEnv } from "../app/lib/config.server";
import { runDeadlineJob } from "../app/lib/jobs.server";

const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE,
);

export default {
  async fetch(request) {
    return requestHandler(request);
  },

  // Cron Trigger (*/5 * * * *): expire unpaid registrations, send reminders, retry emails.
  async scheduled(_controller, env, ctx) {
    const appEnv = env as unknown as AppEnv;
    ctx.waitUntil(
      runDeadlineJob(appEnv.DB, emailConfig(appEnv)).then((report) =>
        console.log("deadline job", JSON.stringify(report)),
      ),
    );
  },
} satisfies ExportedHandler<Env>;
