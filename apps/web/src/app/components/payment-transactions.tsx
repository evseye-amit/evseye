"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { sessionFetch } from "../../lib/session-fetch";
import { ClientDataTable, type ClientColumn } from "./client-data-table";
import { ClientFormDialog } from "./client-form-dialog";

type Payment = { id: string; source: string; riderName: string; mobile: string; amount: string; currency: string; status: string; reference: string | null;
  paymentNumber: string | null; method: string; purpose: string; createdAt: string; submittedAt: string | null; submissionVersion: number; receiptCount: number; canReview: boolean;
  rejectionReason: string | null; rejectedAt: string | null; verifiedAt: string | null; verifiedById: string | null };
type Detail = Payment & { receipts: { id: string; mimeType: string; sizeBytes: number; uploadedAt: string }[];
  history: { id: string; action: string; actorId: string; actorName: string; createdAt: string; newData: { reason?: string; providerReference?: string; submissionVersion?: number } | null }[] };
const label = (value: string) => value.replaceAll("_", " ").toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
const date = (value: string | null) => value ? new Date(value).toLocaleString() : "—";
const money = (row: Payment) => new Intl.NumberFormat("en-IN", { style: "currency", currency: row.currency }).format(Number(row.amount));
async function api<T>(path: string, init?: RequestInit) {
  const response = await sessionFetch(`/api/v1/client/payment-transactions${path}`, init);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error?.message ?? body.message ?? "Unable to load payment transactions.");
  return body.data as T;
}
export function PaymentTransactions() {
  const [rows, setRows] = useState<Payment[]>([]), [total, setTotal] = useState(0);
  const [page, setPage] = useState(1), [limit, setLimit] = useState(25), [search, setSearch] = useState("");
  const [status, setStatus] = useState(""), [source, setSource] = useState(""), [from, setFrom] = useState(""), [to, setTo] = useState("");
  const [sort, setSort] = useState<{key: string; direction: "ascending" | "descending"}>({key:"createdAt",direction:"descending"});
  const [loading, setLoading] = useState(false), [busy, setBusy] = useState(false), [opening, setOpening] = useState("");
  const [error, setError] = useState(""), [dialogError, setDialogError] = useState(""), [notice, setNotice] = useState("");
  const [detail, setDetail] = useState<Detail | null>(null), [rejecting, setRejecting] = useState(false), [reason, setReason] = useState("");
  const [preview, setPreview] = useState<{url:string;name:string} | null>(null);
  const generation = useRef(0);
  const load = useCallback(async () => {
    const current = ++generation.current;
    setLoading(true); setError("");
    try {
      const q = new URLSearchParams({ page:String(page),limit:String(limit),search,sortBy:sort.key,sortDirection:sort.direction === "ascending" ? "asc" : "desc" });
      if(status) q.set("status",status); if(source) q.set("source",source);
      if(from) q.set("from",new Date(`${from}T00:00:00`).toISOString());
      if(to) q.set("to",new Date(`${to}T23:59:59.999`).toISOString());
      const result = await api<{items:Payment[];total:number}>(`?${q}`);
      if(current !== generation.current) return;
      const maxPage=Math.max(1,Math.ceil(result.total/limit));
      if(page>maxPage){setPage(maxPage);return;}
      setRows(result.items);setTotal(result.total);
    } catch(e){if(current === generation.current)setError(e instanceof Error ? e.message : "Unable to load payments.");}
    finally{if(current === generation.current)setLoading(false);}
  },[page,limit,search,status,source,from,to,sort]);
  useEffect(()=>{const requests=generation;const timer=setTimeout(()=>void load(),250);return ()=>{clearTimeout(timer);requests.current++;};},[load]);
  useEffect(()=>()=>{if(preview)URL.revokeObjectURL(preview.url);},[preview]);
  const open = async (row:Payment) => {
    setOpening(`${row.source}:${row.id}`);setError("");setDialogError("");
    try{setDetail(await api<Detail>(`/${row.source}/${row.id}`));setRejecting(false);setReason("");}
    catch(e){setError(e instanceof Error?e.message:"Unable to open payment.");}finally{setOpening("");}
  };
  const review = async (action:"approve"|"reject") => {
    if(!detail)return;
    setBusy(true);setDialogError("");
    try{
      const updated=await api<Detail>(`/${detail.source}/${detail.id}/${action}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({expectedVersion:detail.submissionVersion,...(action === "reject"?{reason:reason.trim()}:{})})});
      setDetail(updated);setRejecting(false);setReason("");setNotice(action === "approve"?"Payment approved.":"Payment rejected. The rider can correct and resubmit it.");void load();
    }catch(e){setDialogError(e instanceof Error?e.message:"Payment review failed.");}finally{setBusy(false);}
  };
  const viewReceipt=async(photo:Detail["receipts"][number])=>{
    if(!detail)return;setBusy(true);setDialogError("");
    try{
      const {url}=await api<{url:string}>(`/${detail.source}/${detail.id}/receipts/${photo.id}/download-url`);
      const response=await sessionFetch(url);if(!response.ok)throw new Error("Unable to open receipt image.");
      setPreview({url:URL.createObjectURL(await response.blob()),name:`payment-receipt-${photo.id}.${photo.mimeType === "image/jpeg"?"jpg":photo.mimeType === "image/png"?"png":"webp"}`});
    }catch(e){setDialogError(e instanceof Error?e.message:"Unable to open receipt.");}finally{setBusy(false);}
  };
  const columns:ClientColumn<Payment>[]=[
    {key:"riderName",label:"Rider",value:r=>r.riderName}, {key:"mobile",label:"Phone",value:r=>r.mobile},
    {key:"purpose",label:"Purpose",value:r=>label(r.purpose)}, {key:"source",label:"Source",value:r=>label(r.source)},
    {key:"amount",label:"Amount",value:r=>Number(r.amount),render:money}, {key:"method",label:"Method",value:r=>r.method},
    {key:"reference",label:"Reference",value:r=>r.reference??r.paymentNumber??"—"},
    {key:"status",label:"Status",value:r=>r.status,render:r=><span className={`status status-${r.status.toLowerCase()}`}>{label(r.status)}</span>},
    {key:"createdAt",label:"Date",value:r=>r.createdAt,render:r=>date(r.createdAt)},
  ];
  return <section className="client-manager-actions">
    <div className="client-page-intro"><p className="muted">Review submitted allocation payments and view receipt images for rider transactions.</p></div>
    <div className="payment-transaction-filters">
      <label>Status<select value={status} onChange={e=>{setStatus(e.target.value);setPage(1);}}><option value="">All statuses</option>{["PENDING","SUBMITTED","REJECTED","PAID","CONFIRMED","SUCCESS","SUCCEEDED","FAILED","CANCELLED","CREATED","CREATING","PROCESSING","UNKNOWN","EXPIRED","PARTIALLY_REFUNDED","REFUNDED"].map(s=><option key={s} value={s}>{label(s)}</option>)}</select></label>
      <label>Source<select value={source} onChange={e=>{setSource(e.target.value);setPage(1);}}><option value="">All sources</option>{["DEPLOYMENT","COLLECTION","AUTOPAY","RECEIVED"].map(s=><option key={s} value={s}>{label(s)}</option>)}</select></label>
      <label>From<input type="date" value={from} onChange={e=>{setFrom(e.target.value);setPage(1);}} /></label>
      <label>To<input type="date" value={to} min={from||undefined} onChange={e=>{setTo(e.target.value);setPage(1);}} /></label>
      <button type="button" className="secondary" disabled={loading} onClick={()=>void load()}>Refresh</button>
    </div>
    {error&&<p className="error" role="alert">{error}</p>}{notice&&<p className="notice" role="status">{notice}</p>}
    {loading&&<p className="muted" role="status">Loading transactions…</p>}
    <ClientDataTable rows={rows} columns={columns} getRowId={r=>`${r.source}:${r.id}`} emptyMessage="No payment transactions match these filters."
      server={{page,limit,total,search,sort,onSearch:value=>{setSearch(value);setPage(1);},onPage:setPage,onLimit:value=>{setLimit(value);setPage(1);},onSort:value=>{setSort(value);setPage(1);}}}
      actions={r=><button type="button" className="secondary table-action" disabled={Boolean(opening)} onClick={()=>void open(r)}>{opening===`${r.source}:${r.id}`?"Opening…":`${r.canReview?"Review":"View"} · ${r.receiptCount} receipt${r.receiptCount===1?"":"s"}`}</button>} />
    {detail&&<ClientFormDialog title="Payment transaction" wide busy={busy} error={dialogError} onClose={()=>{setDetail(null);setRejecting(false);}}>
      <div className="payment-transaction-summary"><div><strong>{detail.riderName}</strong><p>{detail.mobile}</p></div><strong>{money(detail)}</strong><span className={`status status-${detail.status.toLowerCase()}`}>{label(detail.status)}</span></div>
      <dl className="spares-revision-details"><div><dt>Purpose</dt><dd>{label(detail.purpose)}</dd></div><div><dt>Method</dt><dd>{detail.method}</dd></div><div><dt>Reference</dt><dd>{detail.reference??"—"}</dd></div><div><dt>Created</dt><dd>{date(detail.createdAt)}</dd></div><div><dt>Submitted</dt><dd>{date(detail.submittedAt)}</dd></div><div><dt>Verified</dt><dd>{date(detail.verifiedAt)}</dd></div></dl>
      {detail.rejectionReason&&<p className="error">Rejection reason: {detail.rejectionReason}</p>}
      <section><h3>Receipt images</h3>{detail.receipts.length?<div className="row-actions payment-receipt-actions">{detail.receipts.map((p,i)=><button key={p.id} type="button" className="secondary" title={date(p.uploadedAt)} disabled={busy} onClick={()=>void viewReceipt(p)}>View receipt {i+1}</button>)}</div>:<p className="muted">No receipt image uploaded.</p>}</section>
      {detail.canReview&&<section><p className="muted">Confirm the payment against your received funds before approving. Approval records the payment and advances the allocation payment step.</p>
        {rejecting?<form className="form-stack" onSubmit={e=>{e.preventDefault();void review("reject");}}><label>Rejection reason *<textarea required minLength={3} maxLength={1000} value={reason} onChange={e=>setReason(e.target.value)} /></label><div className="form-actions"><button type="button" className="secondary" disabled={busy} onClick={()=>setRejecting(false)}>Cancel</button><button type="submit" className="danger" disabled={busy||reason.trim().length<3}>{busy?"Rejecting…":"Reject payment"}</button></div></form>
          :<div className="form-actions"><button type="button" className="danger" disabled={busy} onClick={()=>setRejecting(true)}>Reject payment</button><button type="button" disabled={busy} onClick={()=>void review("approve")}>{busy?"Approving…":"Approve payment"}</button></div>}
      </section>}
      {!!detail.history.length&&<section><h3>Submission and review history</h3><div className="spares-revision-list">{detail.history.map(h=><article className="spares-revision-card" key={h.id}><strong>{label(h.action)}</strong><p className="muted">{date(h.createdAt)} · {h.actorName}</p>{h.newData?.providerReference&&<p>Reference: {h.newData.providerReference}</p>}{h.newData?.reason&&<p>Reason: {h.newData.reason}</p>}</article>)}</div></section>}
    </ClientFormDialog>}
    {preview&&<ClientFormDialog title="Payment receipt" wide onClose={()=>setPreview(null)}><div className="rider-document-preview">{/* Private images use a short-lived, fetched object URL. */}<img src={preview.url} alt="Payment transaction receipt" /></div><div className="form-actions"><a className="button secondary" href={preview.url} download={preview.name}>Download receipt</a></div></ClientFormDialog>}
  </section>;
}
