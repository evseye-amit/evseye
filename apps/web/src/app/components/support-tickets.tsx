"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { sessionFetch } from "../../lib/session-fetch";
import { ClientDataTable, type ClientColumn } from "./client-data-table";
import { ClientFormDialog } from "./client-form-dialog";

type TicketStatus = "OPEN" | "IN_PROGRESS" | "RESOLVED";
type Photo = { id: string; objectKey: string; mimeType: string; photoType: string };
type Reply = { id: string; body: string; createdAt: string; authorId: string; author?: { name: string; role: string } | null };
type Ticket = {
  id: string; subject: string; description: string; status: TicketStatus;
  riderId: string; rider?: { name: string; mobile: string };
  hub?: { name: string; code: string } | null;
  createdAt: string; lastActivityAt: string; resolvedAt: string | null;
  replies?: Reply[]; photos?: Photo[];
};
const statuses: TicketStatus[] = ["OPEN", "IN_PROGRESS", "RESOLVED"];
const statusLabel = (status: TicketStatus) => ({ OPEN: "Open", IN_PROGRESS: "In progress", RESOLVED: "Resolved" })[status];
const dateLabel = (date: string) => new Date(date).toLocaleString();
const ticketStatus = (status: TicketStatus) => <span className={`status support-ticket-status-${status.toLowerCase()}`}>{statusLabel(status)}</span>;
const columns: ClientColumn<Ticket>[] = [
  { key: "subject", label: "Subject", value: (row) => row.subject },
  { key: "rider", label: "Rider", value: (row) => row.rider?.name ?? "—" },
  { key: "mobile", label: "Mobile", value: (row) => row.rider?.mobile ?? "—" },
  { key: "hub", label: "Hub", value: (row) => row.hub?.name ?? "Unassigned" },
  { key: "status", label: "Status", value: (row) => statusLabel(row.status), render: (row) => ticketStatus(row.status) },
  { key: "activity", label: "Last activity", value: (row) => row.lastActivityAt, render: (row) => dateLabel(row.lastActivityAt) },
  { key: "created", label: "Created", value: (row) => row.createdAt, render: (row) => dateLabel(row.createdAt) },
];
async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await sessionFetch(`/api/v1/client/support/tickets${path}`, options);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error?.message ?? "Unable to process support ticket.");
  return body.data as T;
}

export function SupportTickets() {
  const [rows, setRows] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [openingId, setOpeningId] = useState("");
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [status, setStatus] = useState<TicketStatus>("OPEN");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [dialogError, setDialogError] = useState("");
  const [notice, setNotice] = useState("");
  const [preview, setPreview] = useState<{ url: string; mimeType: string; name: string } | null>(null);
  const [attachmentBusy, setAttachmentBusy] = useState("");
  const openSequence = useRef(0);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const tickets: Ticket[] = [];
        let cursor: string | null = null;
        const seen = new Set<string>();
        do {
          const query: URLSearchParams = new URLSearchParams({ limit: "100", ...(cursor ? { cursor } : {}) });
          const page: { items: Ticket[]; nextCursor: string | null } = await request<{ items: Ticket[]; nextCursor: string | null }>(`?${query}`);
          tickets.push(...page.items);
          cursor = page.nextCursor;
          if (!active) return;
          if (cursor && seen.has(cursor)) throw new Error("Unable to finish loading tickets. Please refresh.");
          if (cursor) seen.add(cursor);
        } while (cursor);
        if (active) setRows([...new Map(tickets.map((row) => [row.id, row])).values()]);
      } catch (cause) { if (active) setError(cause instanceof Error ? cause.message : "Unable to load support tickets."); }
      finally { if (active) setLoading(false); }
    }
    void load();
    return () => { active = false; openSequence.current += 1; };
  }, []);

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview.url); }, [preview]);

  async function open(row: Ticket) {
    const sequence = ++openSequence.current;
    setOpeningId(row.id); setError(""); setNotice("");
    try {
      const detail = await request<Ticket>(`/${row.id}`);
      if (sequence !== openSequence.current) return;
      setTicket(detail); setStatus(detail.status); setMessage(""); setDialogError(""); setPreview(null);
    } catch (cause) { if (sequence === openSequence.current) setError(cause instanceof Error ? cause.message : "Unable to open ticket."); }
    finally { if (sequence === openSequence.current) setOpeningId(""); }
  }

  function updateRow(updated: Ticket) {
    setTicket(updated);
    setRows((current) => current.map((row) => row.id === updated.id ? { ...row, ...updated } : row));
  }

  async function saveStatus(event: FormEvent) {
    event.preventDefault();
    if (!ticket || busy) return;
    setBusy(true); setDialogError(""); setNotice("");
    try {
      const updated = await request<Ticket>(`/${ticket.id}/status`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) });
      updateRow({ ...ticket, ...updated });
      setNotice("Ticket status updated.");
    } catch (cause) { setDialogError(cause instanceof Error ? cause.message : "Unable to update status."); }
    finally { setBusy(false); }
  }

  async function reply(event: FormEvent) {
    event.preventDefault();
    if (!ticket || busy || !message.trim()) return;
    setBusy(true); setDialogError(""); setNotice("");
    try {
      const result = await request<{ reply: Reply; status: TicketStatus }>(`/${ticket.id}/replies`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: message.trim() }),
      });
      // Apply the successful reply before refreshing details so a failed refresh
      // cannot encourage sending the same message twice.
      updateRow({ ...ticket, status: result.status, lastActivityAt: result.reply.createdAt, replies: [...(ticket.replies ?? []), result.reply] });
      setStatus(result.status); setMessage(""); setNotice("Reply sent.");
      try { const latest = await request<Ticket>(`/${ticket.id}`); updateRow(latest); setStatus(latest.status); }
      catch { setDialogError("Reply sent, but the latest conversation could not be loaded. Close and reopen the ticket to refresh it."); }
    } catch (cause) { setDialogError(cause instanceof Error ? cause.message : "Unable to send reply."); }
    finally { setBusy(false); }
  }

  async function openAttachment(photo: Photo) {
    if (!ticket || attachmentBusy) return;
    const sequence = openSequence.current;
    setAttachmentBusy(photo.id); setDialogError("");
    try {
      const { url } = await request<{ url: string }>(`/${ticket.id}/attachments/${photo.id}/download-url`);
      const response = await globalThis.fetch(url, { credentials: "omit" });
      if (!response.ok) throw new Error("Unable to load attachment.");
      const blob = new Blob([await response.arrayBuffer()], { type: photo.mimeType });
      if (sequence !== openSequence.current) return;
      setPreview({ url: URL.createObjectURL(blob), mimeType: photo.mimeType, name: photo.objectKey.split("/").pop() ?? "attachment" });
    } catch (cause) { setDialogError(cause instanceof Error ? cause.message : "Unable to open attachment."); }
    finally { setAttachmentBusy(""); }
  }

  function close() {
    if (busy || attachmentBusy) return;
    setTicket(null); setPreview(null); setDialogError("");
  }

  return <>
    <section className="client-page-intro client-review-intro">
      <p className="muted">View rider requests, follow the conversation, and track their resolution.</p>
      <div className="client-review-counts">{statuses.map((value) => <span key={value}><strong>{rows.filter((row) => row.status === value).length}</strong> {statusLabel(value)}</span>)}</div>
    </section>
    {error && <p className="error" role="alert">{error}</p>}
    {notice && <p className="notice" role="status">{notice}</p>}
    {loading ? <p className="muted">Loading support tickets…</p> : <ClientDataTable rows={rows} columns={columns} getRowId={(row) => row.id} emptyMessage="No support tickets have been raised."
      actions={(row) => <button type="button" className="secondary table-action" disabled={Boolean(openingId)} onClick={() => void open(row)}>{openingId === row.id ? "Opening…" : "Open ticket"}</button>} />}
    {ticket && <ClientFormDialog title="Support ticket" wide busy={busy || Boolean(attachmentBusy)} error={dialogError} onClose={close} heading={<>{ticket.subject}</>}>
      <div className="support-ticket-heading"><div><p className="eyebrow">SUPPORT TICKET</p></div>{ticketStatus(ticket.status)}</div>
      <p className="muted">{ticket.rider?.name ?? "Rider"} · {ticket.rider?.mobile ?? ""} · {ticket.hub?.name ?? "Unassigned hub"}</p>
      <p className="muted support-ticket-id">Ticket ID: {ticket.id} · Raised {dateLabel(ticket.createdAt)}{ticket.resolvedAt ? ` · Resolved ${dateLabel(ticket.resolvedAt)}` : ""}</p>
      <section className="support-ticket-conversation" aria-label="Ticket conversation"><h3>Conversation</h3>
        {ticket.replies?.length ? ticket.replies.map((entry) => <article className="support-ticket-message" key={entry.id}>
          <header><strong>{entry.author?.name ?? (entry.authorId === ticket.replies?.[0]?.authorId ? ticket.rider?.name ?? "Rider" : "Support staff")}</strong><time dateTime={entry.createdAt}>{dateLabel(entry.createdAt)}</time></header>
          <p>{entry.body}</p>
        </article>) : <article className="support-ticket-message"><p>{ticket.description}</p></article>}
      </section>
      {!!ticket.photos?.length && <section className="support-ticket-attachments"><h3>Attachments</h3>{ticket.photos.map((photo) => <button type="button" className="secondary" key={photo.id} disabled={Boolean(attachmentBusy) || busy} onClick={() => void openAttachment(photo)}>{attachmentBusy === photo.id ? "Opening…" : photo.objectKey.split("/").pop() ?? photo.photoType}</button>)}</section>}
      {preview && <section aria-label="Attachment preview"><h3>{preview.name}</h3><div className="rider-document-preview">{preview.mimeType.startsWith("image/") ? <img src={preview.url} alt="Support ticket attachment" /> : preview.mimeType === "application/pdf" ? <iframe src={preview.url} title="Support ticket PDF attachment" /> : <p>Preview unavailable for this file type.</p>}</div><a href={preview.url} download={preview.name}>Download attachment</a></section>}
      <form className="form-stack" onSubmit={reply}><label>Reply<textarea required maxLength={10000} value={message} disabled={busy} onChange={(event) => setMessage(event.target.value)} placeholder="Write a reply to the rider…" /></label><div className="form-actions"><button disabled={busy || !message.trim()}>{busy ? "Saving…" : "Send reply"}</button></div></form>
      <form className="support-ticket-status-form" onSubmit={saveStatus}><label>Status<select value={status} disabled={busy} onChange={(event) => setStatus(event.target.value as TicketStatus)}>{statuses.map((value) => <option key={value} value={value}>{statusLabel(value)}</option>)}</select></label><button disabled={busy || status === ticket.status}>Update status</button></form>
      {notice && <p className="notice" role="status">{notice}</p>}
      <div className="form-actions"><button type="button" className="secondary" disabled={busy || Boolean(attachmentBusy)} onClick={close}>Close ticket</button></div>
    </ClientFormDialog>}
  </>;
}
