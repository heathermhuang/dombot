import { Fragment, useEffect, useState } from 'react';
import { Eye, EyeOff, Lock, LockOpen } from 'lucide-react';
import { toast } from 'sonner';
import { domainKey } from '../../../shared/account-key';
import { toAscii } from '../../../shared/domain-name';
import { ownershipByDomain } from '../../../shared/ownership';
import { isOpenAlert, resolvedIds } from '../../../shared/sync-diff';
import type { Domain, DomainOp } from '../../../shared/ipc';
import type { CatalogEntry } from '../../../shared/domain-catalog';
import { selectedRegistrarTargets } from '../../../shared/domain-catalog';
import { useAppStore } from '../../store/app';
import {
  AutoRenewSwitch,
  FolderCell,
  RenewalCell,
  LifecycleBadge,
} from '../../pages/Domains';
import { FlagToggle } from '../domains/FlagToggle';
import { NameserversCell } from '../domains/NameserversCell';
import { RowActionsMenu } from '../domains/RowActionsMenu';
import { BulkBar, type OwnershipAction } from '../domains/BulkBar';
import { PurchaseDialog } from '../domains/PurchaseDialog';
import { SaleDialog } from '../domains/SaleDialog';
import {
  DeleteDomainsDialog,
  DispositionDialog,
  MarkSoldDialog,
  RestoreOwnedDialog,
} from '../actions/OwnershipDialogs';
import { BulkActionDialog } from '../domains/BulkActionDialog';
import { AuthCodeDialog } from '../domains/AuthCodeDialog';
import { RenewDialog } from '../domains/RenewDialog';
import {
  UrlForwardingDialog,
  EmailForwardingDialog,
} from '../domains/ForwardingDialogs';
import { defaultBulkOp } from '../../lib/bulk';
import { domainsToCsv, csvFilename } from '../../lib/csv';

let forcedTick = 0;
const date = (value: Date | null) =>
  value
    ? new Date(value).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      })
    : '—';
export function useRegistrarManagement({
  catalog,
  selected,
  visible,
  active,
  needsAllDetails,
  clearSelection,
}: {
  catalog: Map<string, CatalogEntry>;
  selected: Set<string>;
  visible: string[];
  active: boolean;
  needsAllDetails: boolean;
  clearSelection: () => void;
}) {
  const {
    folders,
    folderAssignments,
    pricing,
    portfolioRegistrarLabels,
    assignFolder,
    enrichVisible,
    loadAllDetail,
    bulk,
    domainEvents,
    restoreOwned,
  } = useAppStore();
  const refreshTick = useAppStore((s) => s.refreshTick);
  const [authFor, setAuthFor] = useState<Domain | null>(null);
  const [renewFor, setRenewFor] = useState<Domain | null>(null);
  const [urlFor, setUrlFor] = useState<Domain | null>(null);
  const [emailFor, setEmailFor] = useState<Domain | null>(null);
  const [purchaseFor, setPurchaseFor] = useState<Domain | null>(null);
  const [saleFor, setSaleFor] = useState<Domain | null>(null);
  const [markSoldFor, setMarkSoldFor] = useState<Domain | null>(null);
  const [ownershipDialog, setOwnershipDialog] = useState<{
    action: OwnershipAction;
    domains: Domain[];
  } | null>(null);
  const ownership = ownershipByDomain(domainEvents);
  const resolved = resolvedIds(domainEvents);
  const openRemoval = new Map(
    domainEvents
      .filter(
        (event) => event.type === 'removed' && isOpenAlert(event, resolved),
      )
      .map((event) => [event.domain, event.id]),
  );
  const ownershipItems = (domains: Domain[]) =>
    domains.map((domain) => ({
      domainName: domain.domainName,
      resolves: openRemoval.get(toAscii(domain.domainName)),
    }));
  const openOwnership = (action: OwnershipAction, domains: Domain[]) => {
    if (action === 'sold' && domains.length === 1) setMarkSoldFor(domains[0]);
    else setOwnershipDialog({ action, domains });
  };
  const [job, setJob] = useState<{
    op: DomainOp;
    targets: Domain[];
    id?: string;
  } | null>(null);
  const { targets, blocked } = selectedRegistrarTargets(catalog, selected);
  const visibleKey = visible
    .map((name) => {
      const target = catalog.get(name)?.target;
      return target ? domainKey(target) : '';
    })
    .join('|');
  useEffect(() => {
    if (!active) return;
    const force = refreshTick !== forcedTick;
    forcedTick = refreshTick;
    const domains = visible.flatMap((name) =>
      catalog.get(name)?.target ? [catalog.get(name)!.target!] : [],
    );
    if (domains.length) void enrichVisible(domains, force);
    // identity, not editorial changes, determines which provider records are fetched.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, visibleKey, refreshTick, enrichVisible]);
  const allTargetsKey = [...catalog.values()]
    .flatMap((entry) => (entry.target ? [domainKey(entry.target)] : []))
    .join('|');
  useEffect(() => {
    if (active && needsAllDetails)
      void loadAllDetail(
        [...catalog.values()].flatMap((entry) =>
          entry.target ? [entry.target] : [],
        ),
      );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, needsAllDetails, allTargetsKey, refreshTick, loadAllDetail]);
  const refresh = (domain: Domain) => {
    void enrichVisible([domain], true).then(() =>
      toast.success(`Refreshed ${domain.domainName}`),
    );
  };
  const exportRows = async (domains: Domain[]) => {
    try {
      const result = await window.api.saveTextFile(
        domainsToCsv(
          domains,
          portfolioRegistrarLabels,
          folders,
          folderAssignments,
        ),
        csvFilename(),
      );
      if (result.saved) toast.success(`Exported ${domains.length} domains`);
    } catch (error) {
      toast.error((error as Error).message);
    }
  };
  const toolbar = (
    <details
      className="registrar-bulk-details"
      hidden={!active || (!selected.size && bulk?.status !== 'running')}
      open={bulk?.status === 'running'}
    >
      <summary>Registrar bulk actions</summary>
      {active && blocked > 0 && (
        <div className="pf-alert" role="status">
          <span>
            {blocked} selected names have no single active registrar target.
            Registrar bulk actions are unavailable for this selection.
          </span>
          <button className="pf-text-button" onClick={clearSelection}>
            Clear selection
          </button>
        </div>
      )}
      {active && (
        <BulkBar
          domains={targets}
          archiveView={false}
          onOwnership={(action) => openOwnership(action, [...targets])}
          folders={folders}
          onClear={clearSelection}
          onRefresh={() => {
            void enrichVisible(targets, true).then(() =>
              toast.success(`Refreshed ${targets.length} domains`),
            );
          }}
          onExport={() => void exportRows(targets)}
          onAssignFolder={(id) => {
            void Promise.all(
              targets.map((target) => assignFolder(target.domainName, id)),
            ).then(() => toast.success('Folders updated.'));
          }}
          onKind={(kind) =>
            setJob({ op: defaultBulkOp(kind, targets), targets: [...targets] })
          }
          onViewJob={() => {
            if (bulk)
              setJob({ op: bulk.op, id: bulk.id, targets: [...targets] });
          }}
        />
      )}
    </details>
  );
  const cells = (entry: CatalogEntry | undefined) => {
    const d = entry?.target;
    if (!d)
      return (
        <>
          <td colSpan={9} className="pf-readonly-record">
            <span>{entry?.reason ?? 'No registrar record'}</span>
          </td>
          <td />
        </>
      );
    const key = domainKey(d);
    return (
      <Fragment key={key}>
        <td data-label="Registrar / account">
          <span className="pf-registrar-name">
            {portfolioRegistrarLabels[d.registrar] ?? d.registrar}
          </span>
          {d.accountLabel && d.accountLabel !== 'Default' && (
            <small className="pf-hint block">{d.accountLabel}</small>
          )}
        </td>
        <td className="pf-manage-folder" data-label="Folder">
          <FolderCell
            folders={folders}
            folderId={folderAssignments[toAscii(d.domainName)]}
            onAssign={(id) => void assignFolder(d.domainName, id)}
          />
        </td>
        <td className="pf-manage-date" data-label="Created">
          {date(d.createdDate)}
        </td>
        <td className="pf-manage-date" data-label="Expires">
          {date(d.expirationDate)}
          <LifecycleBadge status={d.status} />
        </td>
        <td data-label="Renewal">
          <RenewalCell
            info={pricing[key]}
            loading={Object.keys(pricing).length === 0}
          />
        </td>
        <td data-label="Auto renew">
          <AutoRenewSwitch domain={d} />
        </td>
        <td data-label="Privacy">
          <FlagToggle
            domain={d}
            kind="privacy"
            on={EyeOff}
            off={Eye}
            onLabel="privacy on"
            offLabel="privacy off"
          />
        </td>
        <td data-label="Lock">
          <FlagToggle
            domain={d}
            kind="lock"
            on={Lock}
            off={LockOpen}
            onLabel="locked"
            offLabel="unlocked"
          />
        </td>
        <td data-label="Nameservers">
          <NameserversCell domain={d} />
        </td>
        <td data-label="Registrar actions">
          <RowActionsMenu
            domain={d}
            folders={folders}
            folderId={folderAssignments[toAscii(d.domainName)]}
            onRefresh={() => refresh(d)}
            onUrlForwarding={() => setUrlFor(d)}
            onEmailForwarding={() => setEmailFor(d)}
            onAuthCode={() => setAuthFor(d)}
            onRenew={() => setRenewFor(d)}
            onEditPurchase={() => setPurchaseFor(d)}
            onEditSale={() => setSaleFor(d)}
            archive={ownership.get(toAscii(d.domainName))?.label ?? null}
            onMarkSold={() => openOwnership('sold', [d])}
            onMarkDropped={() => openOwnership('dropped', [d])}
            onMarkArchived={() => openOwnership('archived', [d])}
            onRestoreOwned={() => {
              void restoreOwned([d.domainName])
                .then(() =>
                  toast.success(`Moved ${d.domainName} back to Owned`),
                )
                .catch((error: Error) => toast.error(error.message));
            }}
            onDelete={() => openOwnership('delete', [d])}
            onAssignFolder={(id) => void assignFolder(d.domainName, id)}
          />
        </td>
      </Fragment>
    );
  };
  const dialogs = (
    <Fragment>
      {purchaseFor && (
        <PurchaseDialog
          domain={purchaseFor}
          onClose={() => setPurchaseFor(null)}
        />
      )}
      {saleFor && (
        <SaleDialog domain={saleFor} onClose={() => setSaleFor(null)} />
      )}
      {markSoldFor && (
        <SaleDialog
          domain={markSoldFor}
          mode="mark"
          resolves={openRemoval.get(toAscii(markSoldFor.domainName))}
          onSaved={clearSelection}
          onClose={() => setMarkSoldFor(null)}
        />
      )}
      {ownershipDialog &&
        (() => {
          const { action, domains } = ownershipDialog;
          const onClose = () => setOwnershipDialog(null);
          if (action === 'dropped' || action === 'archived')
            return (
              <DispositionDialog
                type={action}
                items={ownershipItems(domains)}
                onDone={clearSelection}
                onClose={onClose}
              />
            );
          if (action === 'sold')
            return (
              <MarkSoldDialog
                items={ownershipItems(domains)}
                onDone={clearSelection}
                onClose={onClose}
              />
            );
          if (action === 'restore')
            return (
              <RestoreOwnedDialog
                names={domains.map((domain) => domain.domainName)}
                restorable={
                  domains.filter((domain) => {
                    const label = ownership.get(
                      toAscii(domain.domainName),
                    )?.label;
                    return label != null && label !== 'removed';
                  }).length
                }
                onDone={clearSelection}
                onClose={onClose}
              />
            );
          return (
            <DeleteDomainsDialog
              domains={domains}
              onDone={clearSelection}
              onClose={onClose}
            />
          );
        })()}
      {authFor && (
        <AuthCodeDialog domain={authFor} onClose={() => setAuthFor(null)} />
      )}
      {renewFor && (
        <RenewDialog
          domain={renewFor}
          pricing={pricing[domainKey(renewFor)]}
          onClose={() => setRenewFor(null)}
        />
      )}
      {urlFor && (
        <UrlForwardingDialog domain={urlFor} onClose={() => setUrlFor(null)} />
      )}
      {emailFor && (
        <EmailForwardingDialog
          domain={emailFor}
          onClose={() => setEmailFor(null)}
        />
      )}
      {job && (
        <BulkActionDialog
          initialOp={job.op}
          domains={job.targets}
          jobId={job.id}
          onClose={() => setJob(null)}
        />
      )}
    </Fragment>
  );
  return { toolbar, cells, dialogs, exportRows };
}
