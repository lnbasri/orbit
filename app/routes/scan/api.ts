import type { Route } from "./+types/api";
import {
  admitParticipants,
  checkinStats,
  gateState,
  lookupTicket,
  parseDenyReason,
  recordDeny,
  recordEscalation,
  undoCheckin,
} from "~/lib/checkin.server";
import { leadSummary, myTotals, scannerStats, teamOverview, touchScannerSession } from "~/lib/checkin-insights.server";
import { isReportedState } from "~/lib/scanner-presence";
import { saveSelfTest } from "~/lib/scanners.server";
import { json, requireScannerApi } from "~/lib/scanner-guard.server";

/**
 * JSON API of the check-in app (resource route, no UI). GET: health, stats. POST: lookup, admit, deny, undo, escalate, selftest.
 * Every call needs a live scanner session; POSTs must be same-origin. Responses are never cached.
 */
export async function loader({ request, params }: Route.LoaderArgs) {
  const ctx = await requireScannerApi(request);
  if (ctx instanceof Response) return ctx;
  const { env, scanner, event } = ctx;

  if (params.op === "health") {
    // `now` lets the self-test compare the phone's clock with the server (the server sets every check-in time).
    return json({ ok: true, now: new Date().toISOString(), role: scanner.role, gate: gateState(event, new Date()) });
  }
  if (params.op === "stats") {
    const s = await checkinStats(env.DB, event.id);
    return json({ expected: s.expected, inside: s.inside, gate: gateState(event, new Date()) });
  }
  if (params.op === "me") return json({ ok: true, stats: await scannerStats(env.DB, event.id, scanner.id) });
  if (params.op === "team") {
    // Team progress and phone status are for team leads only.
    if (scanner.role !== "lead") return json({ error: "forbidden" }, 403);
    return json({ ok: true, team: await teamOverview(env.DB, event, new Date()), now: new Date().toISOString() });
  }
  return json({ error: "not_found" }, 404);
}

async function body(request: Request): Promise<Record<string, unknown>> {
  try {
    const v = await request.json();
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

const str = (v: unknown, max = 200) => (typeof v === "string" ? v.slice(0, max) : "");

export async function action({ request, params }: Route.ActionArgs) {
  if (request.method !== "POST") return json({ error: "method" }, 405);
  const ctx = await requireScannerApi(request);
  if (ctx instanceof Response) return ctx;
  const { env, scanner, event } = ctx;
  const b = await body(request);

  switch (params.op) {
    case "pulse": {
      // Heartbeat every ~20 s: records this phone's state and returns the numbers the home screen shows.
      const state = isReportedState(b.state) ? b.state : "idle";
      await touchScannerSession(env.DB, scanner, state);
      const [stats, mine] = await Promise.all([checkinStats(env.DB, event.id), myTotals(env.DB, event.id, scanner.id)]);
      const lead = scanner.role === "lead" ? leadSummary(await teamOverview(env.DB, event, new Date())) : null;
      return json({ ok: true, expected: stats.expected, inside: stats.inside, gate: gateState(event, new Date()), mine, lead });
    }
    case "lookup": {
      const result = await lookupTicket(env.DB, event, scanner, str(b.code, 80));
      if ("rateLimited" in result) return json({ error: "rate_limited" }, 429);
      return json({ ok: true, result });
    }
    case "admit": {
      const ids = Array.isArray(b.participantIds) ? b.participantIds.map((x) => str(x, 64)) : [];
      const res = await admitParticipants(env.DB, event, scanner, {
        participantIds: ids,
        requestId: str(b.requestId, 64),
        override: b.override === true,
      });
      if (!res.ok) return json({ error: "bad_request" }, 400);
      return json({ ok: true, items: res.items });
    }
    case "deny": {
      await recordDeny(env.DB, event, scanner, {
        participantId: str(b.participantId, 64) || null,
        reason: parseDenyReason(b.reason),
        requestId: str(b.requestId, 64),
      });
      return json({ ok: true });
    }
    case "undo": {
      const res = await undoCheckin(env.DB, event, scanner, str(b.participantId, 64));
      return res.ok ? json({ ok: true }) : json({ ok: false, reason: res.reason }, 409);
    }
    case "escalate": {
      const level = Number(b.level);
      if (level !== 1 && level !== 2 && level !== 3) return json({ error: "bad_request" }, 400);
      await recordEscalation(env.DB, event, scanner, {
        level,
        participantId: str(b.participantId, 64) || null,
        reasonCode: str(b.reason, 40) || null,
      });
      return json({ ok: true });
    }
    case "selftest": {
      const raw = b.items && typeof b.items === "object" ? (b.items as Record<string, unknown>) : {};
      const items: Record<string, string> = {};
      for (const [k, v] of Object.entries(raw)) if (typeof v === "string") items[k] = v;
      const res = await saveSelfTest(env.DB, scanner.id, scanner.deviceLabel, {
        appVersion: str(b.appVersion, 40),
        passed: true,
        items,
      });
      return json({ ok: true, passed: res.passed });
    }
    default:
      return json({ error: "not_found" }, 404);
  }
}
