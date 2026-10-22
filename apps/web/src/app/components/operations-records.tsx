"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ClientDataTable, type ClientColumn } from "./client-data-table";
import { ClientFormDialog } from "./client-form-dialog";
import { usePanelLoading } from "./panel-loading";
import { useTableViewState, defaultTablePreferences, isTablePreferences } from "./table-view-state";
import { formatDateTime } from "../../lib/presentation";
import { useLocale } from "./locale-provider";
import { readinessCellModel } from "./fleet-readiness-ui";

type Row = Record<string, unknown>;
type Kind = "fleets" | "riders" | "audit";
const related = (row: Row, key: string): Row => (row[key] && typeof row[key] === 'object' ? row[key] : {}) as Row;
const text = (value: unknown) => value === null || value === undefined || value === '' ? '—' : String(value);
const label = (value: unknown) => text(value).replaceAll('_', ' ').toLocaleLowerCase().replace(/(^|\s)\S/g, (c) => c.toLocaleUpperCase());
const fleetStatuses = ['IN_TRANSIT','PENDING_ACTIVATION','AVAILABLE','RESERVED','ALLOCATION_IN_PROGRESS','ALLOCATED','IN_USE','DEALLOCATION_IN_PROGRESS','INSPECTION_PENDING','MAINTENANCE','BROKEN','AWAITING_PARTS','OUT_OF_SERVICE'];
const riderStatuses = ['ONBOARDING','ACTIVE','INACTIVE','BLOCKED','EXITED'];
const sortKeys: Record<Kind, string[]> = { fleets: ['vehicleNumber','chassisNumber','status','createdAt'], riders: ['name','mobile','status','createdAt'], audit: ['action','entityType','createdAt'] };
const hubName = (row: Row) => related(row, 'currentHub').name ?? related(row, 'homeHub').name;
const allocation = (row: Row): Row => Array.isArray(row.allocations) ? (row.allocations[0] ?? {}) as Row : {};
const readinessCell = (row: Row) => {
  const model = readinessCellModel(row);
  if (model.state === "unavailable") return <div className="vehicle-readiness-cell"><span className="status status-unavailable">Unavailable</span><small>{model.guidance ?? "Readiness unavailable."}</small></div>;
  const blocked = model.state === "blocked";
  return <div className="vehicle-readiness-cell">
    <span className={`status ${blocked ? 'status-blocked' : 'status-ready'}`}>{blocked ? `Blocked${model.blockers.length ? ` · ${model.blockers.length} ${model.blockers.length === 1 ? 'reason' : 'reasons'}` : ''}` : 'Ready'}</span>
    {model.blockers.length > 0 && <ul className="vehicle-readiness-reasons">{model.blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}</ul>}
    {model.nextStep && <small><strong>Next:</strong> {model.nextStep}</small>}
    {model.guidance && <small>{model.guidance}</small>}
  </div>;
};

export function OperationsRecords({ kind, identityKey, refreshKey, request, actions }: {
  kind: Kind; identityKey: string; refreshKey: number;
  request: (path: string) => Promise<unknown>;
  actions: (row: Row) => ReactNode;
}) {
  const { t } = useLocale();
  const [view, setView, ready] = useTableViewState(`operations:${identityKey}:${kind}:v1`, defaultTablePreferences, isTablePreferences);
  const [result, setResult] = useState<{ items: Row[]; total: number; signature: string } | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const [hubs, setHubs] = useState<Row[]>([]);
  const [hubError, setHubError] = useState('');
  const [detail, setDetail] = useState<Row | null>(null);
  const [detailError, setDetailError] = useState('');
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailRequestId, setDetailRequestId] = useState<string | null>(null);
  const requestRef = useRef(request);
  useEffect(() => { requestRef.current = request; }, [request]);
  useEffect(() => {
    if (kind !== 'fleets') return;
    let active = true;
    void requestRef.current('/hubs').then((data) => { if (active) setHubs(data as Row[]); })
      .catch(() => { if (active) setHubError('Hub filters are unavailable. Use search or retry loading the list.'); });
    return () => { active = false; };
  }, [kind, retry]);
  const params = new URLSearchParams({ page: String(view.page), pageSize: String(view.limit) });
  if (view.search.trim()) params.set('search', view.search.trim());
  if (view.sort && sortKeys[kind].includes(view.sort.key)) {
    params.set('sortBy', view.sort.key); params.set('sortDirection', view.sort.direction === 'ascending' ? 'asc' : 'desc');
  }
  for (const key of kind === 'audit' ? ['action','entityType','from','to'] : kind === 'fleets' ? ['status','hubId'] : ['status']) {
    const value = view.filters[key]?.[0];
    if (value) params.set(key, key === 'from' ? `${value}T00:00:00.000Z` : key === 'to' ? `${value}T23:59:59.999Z` : value);
  }
  const signature = `${kind}?${params}`;
  const awaiting = !ready || loading || result?.signature !== signature;
  usePanelLoading((awaiting && !error) || detailLoading);
  useEffect(() => {
    if (!ready) return;
    let active = true;
    const timer = window.setTimeout(async () => {
      setLoading(true); setError('');
      try {
        const data = await requestRef.current(`/${kind === 'audit' ? 'audit-logs' : kind}?${signature.split('?')[1]}`) as { items: Row[]; meta: { total: number } };
        if (!active) return;
        const lastPage = Math.max(1, Math.ceil(data.meta.total / view.limit));
        if (view.page > lastPage) { setView((current) => ({ ...current, page: lastPage })); return; }
        setResult({ items: data.items, total: data.meta.total, signature });
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : 'Unable to load records.');
      } finally { if (active) setLoading(false); }
    }, 250);
    return () => { active = false; window.clearTimeout(timer); };
  }, [kind, signature, ready, refreshKey, retry, view.page, view.limit, setView]);
  const rows = result?.signature === signature ? result.items : [];
  const column = (key: string, title: string, value: (row: Row) => unknown): ClientColumn<Row> => ({ key, label: title, value: (row) => text(value(row)), sortable: sortKeys[kind].includes(key) });
  const statusColumn = (key: string, title: string, value: (row: Row) => unknown): ClientColumn<Row> => ({ ...column(key, title, value), render: (row) => <span className={`status status-${text(value(row)).toLocaleLowerCase().replaceAll('_','-')}`}>{t(label(value(row)))}</span> });
  const columns = kind === 'fleets' ? [
    column('vehicleNumber','Vehicle', (row) => row.vehicleNumber ?? row.fleetCode),
    column('chassisNumber','Chassis number', (row) => row.chassisNumber),
    column('oem','OEM / model', (row) => [related(row,'oem').displayName ?? related(row,'oem').code, row.modelName].filter(Boolean).join(' · ')),
    column('hub','Hub', hubName), statusColumn('status','Status', (row) => row.status),
    statusColumn('onboardingStatus','Onboarding', (row) => row.onboardingStatus),
    { key: 'vehicleReadiness', label: 'Vehicle readiness', value: (row: Row) => { const model = readinessCellModel(row); return model.state === 'ready' ? 'Ready' : model.state === 'blocked' ? 'Blocked' : 'Unavailable'; }, render: readinessCell, sortable: false },
  ] : kind === 'riders' ? [
    column('name','Rider', (row) => row.name), column('mobile','Mobile', (row) => row.mobile),
    statusColumn('status','Status', (row) => row.status), statusColumn('kycStatus','KYC', (row) => row.kycStatus),
    column('fleet','Fleet Number', (row) => related(allocation(row),'fleet').vehicleNumber ?? related(allocation(row),'fleet').fleetCode),
    column('workPartner','Work Partner', (row) => related(related(allocation(row),'mobileDeployment'),'clientWorkPartner').name ?? related(allocation(row),'mobileDeployment').workPartnerName),
    column('hub','Hub', (row) => hubName(related(allocation(row),'fleet'))),
  ] : [
    column('action','Action', (row) => label(row.action)),
    column('entityType','Entity type', (row) => label(row.entityType)),
    column('entity','Record', (row) => row.entityName ?? row.entityId),
    column('actor','Actor', (row) => row.actorName ?? (row.actorId ? 'Unknown actor' : 'System')),
    column('createdAt','When', (row) => formatDateTime(text(row.createdAt))),
  ];
  const setFilter = (key: string, value: string) => setView((current) => ({ ...current, page: 1, filters: { ...current.filters, [key]: value ? [value] : [] } }));
  const openDetail = async (row: Row) => {
    setDetail(row); setDetailError('');
    if (kind === 'audit') return;
    setDetailRequestId(String(row.id));
    setDetailLoading(true);
    try { setDetail(await requestRef.current(`/fleets/${row.id}`) as Row); }
    catch (cause) { setDetailError(cause instanceof Error ? cause.message : 'Unable to load fleet details.'); }
    finally { setDetailLoading(false); }
  };
  return <section className="operations-records" aria-label={`${kind} records`}>
    <div className="operations-record-filters">
      {kind === 'fleets' && <label>{t('Home or current hub')}<select value={view.filters.hubId?.[0] ?? ''} onChange={(e) => setFilter('hubId',e.target.value)}><option value="">{t('All hubs')}</option>{view.filters.hubId?.[0] && !hubs.some((hub) => hub.id === view.filters.hubId[0]) && <option value={view.filters.hubId[0]}>{t('Previously selected hub')}</option>}{hubs.map((hub) => <option key={String(hub.id)} value={String(hub.id)}>{text(hub.name)}</option>)}</select></label>}
      {kind !== 'audit' ? <label>{t('Status')}<select value={view.filters.status?.[0] ?? ''} onChange={(e) => setFilter('status', e.target.value)}><option value="">{t('All statuses')}</option>{(kind === 'fleets' ? fleetStatuses : riderStatuses).map((value) => <option key={value} value={value}>{t(label(value))}</option>)}</select></label> : <>
        <label>{t('Action')}<input type="search" maxLength={100} placeholder="e.g. RIDER_CREATED" value={view.filters.action?.[0] ?? ''} onChange={(e) => setFilter('action', e.target.value)} /></label>
        <label>{t('Entity type')}<input type="search" maxLength={100} placeholder="e.g. FLEET" value={view.filters.entityType?.[0] ?? ''} onChange={(e) => setFilter('entityType', e.target.value)} /></label>
        <label>{t('From (UTC)')}<input type="date" value={view.filters.from?.[0] ?? ''} max={view.filters.to?.[0]} onChange={(e) => setFilter('from', e.target.value)} /></label>
        <label>{t('To (UTC)')}<input type="date" value={view.filters.to?.[0] ?? ''} min={view.filters.from?.[0]} onChange={(e) => setFilter('to', e.target.value)} /></label>
      </>}
      <button type="button" className="secondary" onClick={() => setView({ ...defaultTablePreferences })}>{t('Reset filters')}</button>
    </div>
    {kind === 'audit' && <p className="muted">{t('Search by action, entity type, record ID, actor ID or actor name. Date filters use UTC.')}</p>}
    {hubError && <p className="muted" role="status">{t(hubError)} <button className="secondary" onClick={() => { setHubError(''); setRetry((value) => value + 1); }}>{t('Retry')}</button></p>}
    {error && <div role="alert" className="error"><p>{error}</p><button type="button" className="secondary" onClick={() => setRetry((value) => value + 1)}>{t('Retry')}</button></div>}
    <ClientDataTable rows={rows} columns={columns} getRowId={(row) => String(row.id)} loading={awaiting && !error}
      emptyMessage={error ? 'Unable to load records. Retry to continue.' : 'No records match this view.'}
      server={{ page: view.page, limit: view.limit, total: result?.signature === signature ? result.total : 0, search: view.search, sort: view.sort ?? undefined,
        onPage: (page) => setView((current) => ({ ...current, page })), onLimit: (limit) => setView((current) => ({ ...current, page: 1, limit })),
        onSearch: (search) => setView((current) => ({ ...current, page: 1, search: search.slice(0,200) })),
        onSort: (sort) => setView((current) => ({ ...current, page: 1, sort })), }}
      actions={(row) => awaiting || error ? <span>{t(error ? 'Actions unavailable until records reload.' : 'Loading current data…')}</span> : <>
        {kind !== 'riders' && <button className="secondary table-action" onClick={() => void openDetail(row)}>{t('View')}</button>}{actions(row)}
      </>} />
    {detail && <ClientFormDialog title={kind === 'audit' ? 'Audit details' : 'Fleet details'} heading={kind === 'audit' ? label(detail.action) : text(detail.vehicleNumber ?? detail.fleetCode)} wide busy={detailLoading} error={detailError} onClose={() => { setDetail(null); setDetailRequestId(null); }}>
      {detailLoading ? <p role="status">{t('Loading fleet details…')}</p> : kind === 'audit' ? <>
        <RecordFields fields={[
          ['Action', label(detail.action)], ['Entity type', label(detail.entityType)], ['Record', detail.entityName], ['Entity ID', detail.entityId],
          ['Actor', detail.actorName ?? (detail.actorId ? 'Unknown actor' : 'System')], ['Actor ID', detail.actorId], ['When', formatDateTime(text(detail.createdAt))], ['Request ID', detail.requestId],
        ]} />
        <h3>{t('Changes')}</h3><AuditChanges previous={detail.previousData} next={detail.newData} />
      </> : <>
        <h3>{t('Vehicle identity')}</h3><RecordFields fields={[
          ['Vehicle', detail.vehicleNumber], ['Fleet code', detail.fleetCode], ['Chassis number', detail.chassisNumber], ['OEM', related(detail,'oem').displayName ?? related(detail,'oem').code],
          ['Model', detail.modelName], ['Variant', detail.variantName], ['Colour', detail.colour],
        ]} />
        <h3>{t('Hub and status')}</h3><RecordFields fields={[
          ['Status', label(detail.status)], ['Onboarding status', label(detail.onboardingStatus)], ['Current hub', related(detail,'currentHub').name], ['Home hub', related(detail,'homeHub').name],
        ]} />
        <h3>{t('Installed components')}</h3><RecordFields fields={[
          ['Batteries', Array.isArray(detail.batteryHistory) ? detail.batteryHistory.map((entry: Row) => text(related(entry,'battery').serialNumber)).join(', ') : null],
          ['Controllers', Array.isArray(detail.controllerHistory) ? detail.controllerHistory.map((entry: Row) => text(related(entry,'controller').controllerNumber)).join(', ') : null],
        ]} />
        {detailError && detailRequestId && <button className="secondary" onClick={() => void openDetail({ id: detailRequestId })}>{t('Retry')}</button>}
      </>}
    </ClientFormDialog>}
  </section>;
}

function RecordFields({ fields }: { fields: [string, unknown][] }) {
  const { t } = useLocale();
  return <dl className="operations-record-fields">{fields.map(([name,value]) => <div key={name}><dt>{t(name)}</dt><dd>{text(value)}</dd></div>)}</dl>;
}
function AuditChanges({ previous, next }: { previous: unknown; next: unknown }) {
  const { t } = useLocale();
  const before = previous && typeof previous === 'object' && !Array.isArray(previous) ? previous as Row : {};
  const after = next && typeof next === 'object' && !Array.isArray(next) ? next as Row : {};
  const keys = [...new Set([...Object.keys(before),...Object.keys(after)])];
  const display = (value: unknown) => value === undefined ? '—' : typeof value === 'object' ? JSON.stringify(value, null, 2) : text(value);
  return keys.length ? <div className="sa-table-wrap"><table><thead><tr><th>{t('Field')}</th><th>{t('Before')}</th><th>{t('After')}</th></tr></thead><tbody>{keys.map((key) => <tr key={key}><td>{label(key.replace(/([a-z])([A-Z])/g,'$1 $2'))}</td><td><pre className="operations-change-value">{display(before[key])}</pre></td><td><pre className="operations-change-value">{display(after[key])}</pre></td></tr>)}</tbody></table></div> : <p className="muted">{t('No change details were recorded for this event.')}</p>;
}

export function OperationsTable({ tab, identityKey, refreshKey, request, ...props }: React.ComponentProps<typeof ClientDataTable<Row>> & {
  tab: string; identityKey: string; refreshKey: number; request: (path: string) => Promise<unknown>;
}) {
  return tab === 'fleets' || tab === 'riders' || tab === 'audit'
    ? <OperationsRecords key={`${identityKey}:${tab}`} kind={tab} identityKey={identityKey} refreshKey={refreshKey} request={request} actions={props.actions ?? (() => null)} />
    : <ClientDataTable {...props} stateKey={`operations:${identityKey}:${tab}:v1`} />;
}
