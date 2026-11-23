import { WorkflowEntrypoint } from "cloudflare:workers";
import type { WorkflowEvent, WorkflowStep } from "cloudflare:workers";

interface BackupWorkerEnv {
  DOCUMENTS: R2Bucket;
  BACKUPS: R2Bucket;
  BACKUP_PREFIX?: string;
  D1_BACKUP_API_TOKEN?: string;
  CLOUDFLARE_ACCOUNT_ID?: string;
  ORBIT_PRODUCTION_DATABASE_ID?: string;
}

interface D1ExportResponse {
  success?: boolean;
  result?: {
    at_bookmark?: string;
    signed_url?: string;
    filename?: string;
  };
}

export class OrbitBackupWorkflow extends WorkflowEntrypoint<BackupWorkerEnv> {
  async run(event: WorkflowEvent<unknown>, step: WorkflowStep) {
    const token = this.env.D1_BACKUP_API_TOKEN?.trim();
    const accountId = this.env.CLOUDFLARE_ACCOUNT_ID?.trim();
    const databaseId = this.env.ORBIT_PRODUCTION_DATABASE_ID?.trim();
    if (!token || !accountId || !databaseId) {
      const error = new Error("Backup worker is missing its D1 export credentials or identifiers.");
      console.error("ORBIT scheduled backup failed:", error.message);
      throw error;
    }

    const scheduledAt = event.schedule?.scheduledTime ?? event.timestamp.getTime();
    const backupId = `${new Date(scheduledAt).toISOString().replace(/[:.]/g, "-")}-${event.instanceId}`;
    const prefix = `${this.env.BACKUP_PREFIX ?? "daily"}/${backupId}`;
    const exportUrl = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/d1/database/${encodeURIComponent(databaseId)}/export`;
    const headers = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };

    try {
      const bookmark = await step.do("Start D1 export", async () => {
        const response = await fetch(exportUrl, {
          method: "POST",
          headers,
          body: JSON.stringify({ output_format: "polling" }),
        });
        const body = await response.json() as D1ExportResponse;
        if (!response.ok || body.success !== true || !body.result?.at_bookmark) {
          throw new Error(`D1 export could not be started (HTTP ${response.status}).`);
        }
        return body.result.at_bookmark;
      });

      await step.do("Save D1 export to R2", async () => {
        const response = await fetch(exportUrl, {
          method: "POST",
          headers,
          body: JSON.stringify({ current_bookmark: bookmark }),
        });
        const body = await response.json() as D1ExportResponse;
        if (!response.ok || body.success !== true || !body.result?.signed_url || !body.result.filename) {
          throw new Error(`D1 export is not ready (HTTP ${response.status}).`);
        }

        const dump = await fetch(body.result.signed_url);
        if (!dump.ok || !dump.body) throw new Error(`D1 export download failed (HTTP ${dump.status}).`);
        await this.env.BACKUPS.put(`${prefix}/database.sql`, dump.body, {
          httpMetadata: { contentType: "application/sql" },
          customMetadata: {
            sourceFilename: body.result.filename,
            d1Bookmark: bookmark,
            createdAt: new Date().toISOString(),
          },
        });
      });

      let cursor: string | undefined;
      let pageNumber = 0;
      let copiedDocuments = 0;
      do {
        const page = await step.do(`List generated documents ${pageNumber}`, async () => {
          const listed = await this.env.DOCUMENTS.list({
            limit: 100,
            ...(cursor ? { cursor } : {}),
          });
          const keys = listed.objects.map((object) => object.key);
          return listed.truncated
            ? { keys, truncated: true as const, cursor: listed.cursor }
            : { keys, truncated: false as const };
        });

        if (page.keys.length) {
          const copiedOnPage = await step.do(`Copy generated documents ${pageNumber}`, async () => {
            let copied = 0;
            for (const key of page.keys) {
              const source = await this.env.DOCUMENTS.get(key);
              if (!source) throw new Error("A generated document disappeared during backup.");
              const options: R2PutOptions = {};
              if (source.httpMetadata) options.httpMetadata = source.httpMetadata;
              if (source.customMetadata) options.customMetadata = source.customMetadata;
              await this.env.BACKUPS.put(`${prefix}/documents/${key}`, source.body, options);
              copied++;
            }
            return copied;
          });
          copiedDocuments += copiedOnPage;
        }

        if (page.truncated && !page.cursor) {
          throw new Error("Generated document listing was truncated without a continuation cursor.");
        }
        cursor = page.truncated ? page.cursor : undefined;
        pageNumber++;
      } while (cursor);

      console.info(`ORBIT backup ${backupId} completed; copied ${copiedDocuments} generated document(s).`);
      return { backupId, copiedDocuments };
    } catch (error) {
      console.error("ORBIT scheduled backup failed:", error instanceof Error ? error.message : String(error));
      throw error;
    }
  }
}

export default {
  fetch() {
    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<BackupWorkerEnv>;
