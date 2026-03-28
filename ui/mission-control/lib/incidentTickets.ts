import { cpFetchJsonSafe } from "./controlPlane";

export type OpenIncidentTicketInput = {
  title: string;
  severity?: "low" | "medium" | "high" | "critical";
  payload?: Record<string, unknown>;
};

export async function openIncidentTicket(input: OpenIncidentTicketInput): Promise<{
  ok: boolean;
  status: number;
  ticketKey: string | null;
  detail: string;
}> {
  const { response, payload } = await cpFetchJsonSafe("/v1/copilot/chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      action: {
        type: "open_incident_ticket",
        title: input.title,
        severity: input.severity || "high",
        payload: input.payload || {},
      },
      safe_mode: false,
    }),
  });

  const safePayload = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  const actionResult = safePayload.action_result && typeof safePayload.action_result === "object"
    ? safePayload.action_result as Record<string, unknown>
    : {};
  const ticketKey = typeof actionResult.ticket_key === "string"
    ? actionResult.ticket_key
    : typeof safePayload.ticket_key === "string"
      ? safePayload.ticket_key
      : null;
  const detail = typeof safePayload.reply === "string"
    ? safePayload.reply
    : typeof safePayload.detail === "string"
      ? safePayload.detail
      : response.ok
        ? "incident_opened"
        : `incident_open_failed_${response.status}`;

  return {
    ok: response.ok,
    status: response.status,
    ticketKey,
    detail,
  };
}

export async function closeIncidentTicket(ticketKey: string, resolutionNote: string): Promise<{
  ok: boolean;
  status: number;
  detail: string;
}> {
  const { response, payload } = await cpFetchJsonSafe(`/v1/incidents/${encodeURIComponent(ticketKey)}/close`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      resolution_note: resolutionNote,
    }),
  });

  const safePayload = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  const detail = typeof safePayload.detail === "string"
    ? safePayload.detail
    : typeof safePayload.status === "string"
      ? safePayload.status
      : response.ok
        ? "incident_closed"
        : `incident_close_failed_${response.status}`;

  return {
    ok: response.ok,
    status: response.status,
    detail,
  };
}

export async function getIncidentTicket(ticketKey: string): Promise<{
  ok: boolean;
  status: number;
  detail: string;
  ticketStatus: string | null;
  assignee: string | null;
}> {
  const { response, payload } = await cpFetchJsonSafe(`/v1/incidents/${encodeURIComponent(ticketKey)}`);
  const safePayload = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};

  return {
    ok: response.ok,
    status: response.status,
    detail: typeof safePayload.detail === "string"
      ? safePayload.detail
      : response.ok
        ? "incident_ticket_loaded"
        : `incident_ticket_lookup_failed_${response.status}`,
    ticketStatus: typeof safePayload.status === "string" ? safePayload.status : null,
    assignee: typeof safePayload.assignee === "string" ? safePayload.assignee : null,
  };
}