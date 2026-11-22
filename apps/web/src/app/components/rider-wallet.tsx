"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ClientFormDialog } from "./client-form-dialog";
import { ClientDataTable } from "./client-data-table";
import { RiderRewardEarnings } from "./rider-earnings";
import { ledgerText } from "../../lib/ledger-presentation";
import { formatDateTime, formatMoney } from "../../lib/presentation";

type Request = (path: string) => Promise<unknown>;
type Rider = { id: string; name: string; mobile: string };
type Bucket = { totalBalance: string; heldBalance: string; availableBalance: string };
type Wallet = Bucket & { id: string; currency: string; status: string; cash: Bucket; rewards: Bucket; securityDepositBucket: Bucket };
type Deposit = { id: string; agreementId: string; depositType: string; code: string; currency: string; status: string; requiredAmount: string; paidAmount: string; refundedAmount: string; deductedAmount: string; forfeitedAmount: string; remainingAmount: string; pendingRefundAmount: string; transferredInAmount: string; transferredOutAmount: string };
type Balance = { wallets: Wallet[]; deposits?: Deposit[] };
type Breakdown = { status: 'AVAILABLE' | 'UNAVAILABLE'; items: { type: string; label: string; amount: string; period?: string }[] };
type Transaction = { breakdown?: Breakdown; id: string; transactionNumber: string; transactionType: string; status: string; currency: string; amount: string; description: string; referenceId: string | null; referenceType: string | null; createdAt: string; postedAt: string | null; movements: { bucket: string; amount: string }[] };
type Transactions = { items: Transaction[]; meta: { page: number; pageSize: number; total: number }; transactionTypes: string[]; transactionStatuses: string[] };
const label = (value: string) => ledgerText(value).toLowerCase().replaceAll('_', ' ').replace(/(^|\s)\S/g, character => character.toUpperCase());

function useWalletResource<T>(path: string | null, request: Request) {
  const ref = useRef(request);
  useEffect(() => { ref.current = request; }, [request]);
  const [state, setState] = useState<{ path: string; data?: T; error?: string } | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!path) return;
    let active = true;
    const timer = window.setTimeout(async () => {
      try {
        const data = await ref.current(path) as T;
        if (active) setState({ path, data });
      } catch (cause) {
        if (active) setState({ path, error: cause instanceof Error ? ledgerText(cause.message) : 'Unable to load ledger data.' });
      }
    }, 100);
    return () => { active = false; window.clearTimeout(timer); };
  }, [path, retry]);
  const current = state?.path === path ? state : null;
  return { data: current?.data, lastData: state?.data, error: current?.error, loading: Boolean(path) && !current,
    reload: () => { setState(null); setRetry(value => value + 1); } };
}
function WalletError({ error, reload }: { error?: string; reload: () => void }) {
  return error ? <div className="error" role="alert"><p>{error}</p><button type="button" className="secondary" onClick={reload}>Retry</button></div> : null;
}
function WalletBalance({ riderId, request }: { riderId: string; request: Request }) {
  const resource = useWalletResource<Balance>(`/riders/${riderId}/wallet`, request);
  return <>
    <div className="form-actions"><button type="button" className="secondary" onClick={resource.reload} disabled={resource.loading}>Refresh balance</button></div>
    <WalletError error={resource.error} reload={resource.reload} />
    {resource.loading && <p role="status">Loading ledger balance…</p>}
    {resource.data?.wallets.length === 0 && <p className="muted">No ledger exists for this rider yet.</p>}
    {resource.data?.wallets.map(wallet => <section className="action-card rider-wallet-balance" key={wallet.id}>
      <h3>{wallet.currency} ledger <span className="status">{label(wallet.status)}</span></h3>
      <dl className="rider-wallet-totals">
        <div><dt>Total balance</dt><dd>{formatMoney(wallet.totalBalance, wallet.currency)}</dd></div>
        <div><dt>Held balance</dt><dd>{formatMoney(wallet.heldBalance, wallet.currency)}</dd></div>
        <div><dt>Available balance</dt><dd>{formatMoney(wallet.availableBalance, wallet.currency)}</dd></div>
      </dl>
      <p className="muted">Total balance includes cash and rewards. Available balance reflects holds and ledger policy limits. The security deposit is shown separately.</p>
      <ClientDataTable rows={[{ name: 'Cash', ...wallet.cash }, { name: 'Rewards', ...wallet.rewards }, ...(Number(wallet.securityDepositBucket.totalBalance) !== 0 ? [{ name: 'Ledger-held security deposit', ...wallet.securityDepositBucket }] : [])]}
        getRowId={row => row.name} searchable={false} pagination={false} filterable={false} sortable={false}
        columns={[
          { key: 'bucket', label: 'Bucket', value: row => row.name },
          { key: 'balance', label: 'Balance', value: row => row.totalBalance, render: row => formatMoney(row.totalBalance, wallet.currency) },
          { key: 'held', label: 'Held', value: row => row.heldBalance, render: row => formatMoney(row.heldBalance, wallet.currency) },
          { key: 'available', label: 'Available', value: row => row.availableBalance, render: row => formatMoney(row.availableBalance, wallet.currency) },
        ]} />
    </section>)}
    {resource.data && <section className="action-card">
      <h3>Security deposits</h3>
      <p className="muted">Deposits paid for rental agreements are held separately from the available ledger balance. Refunds and deductions update the remaining deposit.</p>
      <ClientDataTable rows={resource.data.deposits ?? []} getRowId={row => row.id} searchable={false} filterable={false} pagination={false} sortable={false}
        emptyMessage="No agreement security deposits recorded for this rider."
        columns={[
          { key: 'deposit', label: 'Deposit', value: row => `${label(row.depositType)} · ${row.code}` },
          { key: 'status', label: 'Status', value: row => row.status === 'HELD' ? 'Paid · Held' : row.status === 'PARTIALLY_COLLECTED' ? 'Partially paid' : label(row.status) },
          { key: 'paid', label: 'Paid', value: row => row.paidAmount, render: row => formatMoney(row.paidAmount, row.currency) },
          { key: 'deducted', label: 'Deducted', value: row => row.deductedAmount, render: row => formatMoney(row.deductedAmount, row.currency) },
          { key: 'refunded', label: 'Refunded', value: row => row.refundedAmount, render: row => formatMoney(row.refundedAmount, row.currency) },
          { key: 'remaining', label: 'Remaining held', value: row => row.remainingAmount, render: row => formatMoney(row.remainingAmount, row.currency) },
          { key: 'details', label: 'Details', value: row => `${row.pendingRefundAmount} ${row.forfeitedAmount} ${row.transferredInAmount} ${row.transferredOutAmount}`, render: row => <>
            {Number(row.pendingRefundAmount) > 0 && <div>Refund pending: {formatMoney(row.pendingRefundAmount, row.currency)}</div>}
            {Number(row.forfeitedAmount) > 0 && <div>Forfeited: {formatMoney(row.forfeitedAmount, row.currency)}</div>}
            {Number(row.transferredInAmount) > 0 && <div>Transferred in: {formatMoney(row.transferredInAmount, row.currency)}</div>}
            {Number(row.transferredOutAmount) > 0 && <div>Transferred out: {formatMoney(row.transferredOutAmount, row.currency)}</div>}
          </> },
        ]} />
    </section>}
  </>;
}
function WalletTransactions({ riderId, request }: { riderId: string; request: Request }) {
  const [page, setPage] = useState(1), [pageSize, setPageSize] = useState(10);
  const [from, setFrom] = useState(''), [to, setTo] = useState(''), [type, setType] = useState(''), [status, setStatus] = useState('');
  const invalid = Boolean(from && to && from > to);
  const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize), ...(from ? { from } : {}), ...(to ? { to } : {}), ...(type ? { type } : {}), ...(status ? { status } : {}) });
  // Keep invalid ranges local; do not send an invalid date-filter request.
  const path = invalid ? null : `/riders/${riderId}/wallet/transactions?${params}`;
  const resource = useWalletResource<Transactions>(path, request);
  const options = resource.data ?? resource.lastData;
  return <>
    <p className="muted">All transactions, including deployment payments, top-ups, rewards, deductions and reversals. Deployment payments were paid externally and do not change the ledger balance. Date filters use the transaction creation date.</p>
    <div className="client-filter-bar">
      <label>From (UTC)<input type="date" value={from} max={to || undefined} onChange={event => { setFrom(event.target.value); setPage(1); }} /></label>
      <label>To (UTC)<input type="date" value={to} min={from || undefined} onChange={event => { setTo(event.target.value); setPage(1); }} /></label>
      <label>Type<select value={type} onChange={event => { setType(event.target.value); setPage(1); }}><option value="">All types</option>{type && !options?.transactionTypes.includes(type) && <option value={type}>{label(type)}</option>}{options?.transactionTypes.map(value => <option key={value} value={value}>{label(value)}</option>)}</select></label>
      <label>Status<select value={status} onChange={event => { setStatus(event.target.value); setPage(1); }}><option value="">All statuses</option>{status && !options?.transactionStatuses.includes(status) && <option value={status}>{label(status)}</option>}{options?.transactionStatuses.map(value => <option key={value} value={value}>{label(value)}</option>)}</select></label>
      <button type="button" className="secondary" onClick={() => { setFrom(''); setTo(''); setType(''); setStatus(''); setPage(1); }}>Clear filters</button>
    </div>
    {invalid ? <p className="error" role="alert">From date must not be after To date.</p> : <>
      <WalletError error={resource.error} reload={resource.reload} />
      {resource.loading && <p role="status">Loading transactions…</p>}
      <ClientDataTable rows={resource.data?.items ?? []} getRowId={row => row.id} loading={resource.loading} searchable={false} filterable={false} sortable={false}
        columns={[
          { key: 'date', label: 'Created', value: row => row.createdAt, render: row => formatDateTime(row.createdAt) },
          { key: 'type', label: 'Type', value: row => label(row.transactionType) },
          { key: 'status', label: 'Status', value: row => label(row.status) },
          { key: 'description', label: 'Description', value: row => ledgerText(row.description), render: row => <>
            <div>{ledgerText(row.description)}</div>
            {row.referenceType === 'DEPLOYMENT_PAYMENT' && (row.breakdown?.status === 'AVAILABLE' ? <details>
              <summary>Payment breakdown</summary>
              <dl>{row.breakdown.items.map((item, index) => <div key={`${item.type}-${index}`}><dt>{item.label}{item.period ? ` · ${label(item.period)}` : ''}</dt><dd>{formatMoney(item.amount, row.currency)}</dd></div>)}</dl>
              <small>Components of this payment; not additional charges.</small>
            </details> : <small className="muted">Breakdown unavailable for this historical payment.</small>)}
          </> },
          { key: 'amount', label: 'Amount', value: row => row.amount, render: row => formatMoney(row.amount, row.currency) },
          { key: 'movement', label: 'Balance movement', value: row => row.movements.map(item => `${item.bucket} ${item.amount}`).join(' · '), render: row => <>{row.movements.length ? row.movements.map(item => <div key={item.bucket}>{label(item.bucket)}: {Number(item.amount) > 0 ? '+' : ''}{formatMoney(item.amount, row.currency)}</div>) : ['DEPLOYMENT_PAYMENT', 'RIDER_DEPOSIT_REFUND'].includes(row.referenceType ?? '') ? 'No balance change' : '—'}</> },
          { key: 'reference', label: 'Reference', value: row => row.transactionNumber, render: row => <>{row.transactionNumber}{row.referenceId && <small className="muted rider-wallet-reference">{row.referenceType ? label(row.referenceType) : null} · {row.referenceId}</small>}</> },
        ]}
        server={{ page, limit: pageSize, total: resource.data?.meta.total ?? 0, search: '', onSearch: () => {}, onPage: setPage, onLimit: value => { setPageSize(value); setPage(1); } }}
        emptyMessage={resource.error ? 'Unable to load transactions. Retry to continue.' : 'No transactions match this view.'} />
    </>}
  </>;
}
const tabs = [['balance', 'Balance'], ['transactions', 'Transactions'], ['rewards', 'Reward Earnings']] as const;
type Tab = typeof tabs[number][0];
export function RiderWalletDialog({ rider, request, onClose }: { rider: Rider; request: Request; onClose: () => void }) {
  const id = useId();
  const [active, setActive] = useState<Tab>('balance');
  const [visited, setVisited] = useState<Tab[]>(['balance']);
  const select = (tab: Tab) => { setActive(tab); setVisited(current => current.includes(tab) ? current : [...current, tab]); };
  return <ClientFormDialog title="Rider ledger" heading={<>Ledger · {rider.name}</>} wide formsOnly onClose={onClose}>
    <p className="muted">{rider.mobile}</p>
    <div className="rider-wallet-tabs" role="tablist" aria-label="Rider ledger">
      {tabs.map(([tab, title], index) => <button type="button" role="tab" key={tab} id={`${id}-${tab}-tab`} aria-selected={active === tab} aria-controls={`${id}-${tab}-panel`} tabIndex={active === tab ? 0 : -1} className={active === tab ? '' : 'secondary'} onClick={() => select(tab)} onKeyDown={event => {
        const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : null;
        if (next === null) return;
        event.preventDefault(); select(tabs[next][0]); document.getElementById(`${id}-${tabs[next][0]}-tab`)?.focus();
      }}>{title}</button>)}
    </div>
    {tabs.map(([tab]) => <section role="tabpanel" key={tab} id={`${id}-${tab}-panel`} aria-labelledby={`${id}-${tab}-tab`} hidden={active !== tab} className="rider-wallet-panel">
      {visited.includes(tab) && (tab === 'balance' ? <WalletBalance riderId={rider.id} request={request} /> : tab === 'transactions' ? <WalletTransactions riderId={rider.id} request={request} /> : <RiderRewardEarnings rider={rider} request={request} />)}
    </section>)}
  </ClientFormDialog>;
}
