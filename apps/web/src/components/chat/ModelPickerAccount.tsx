import type { ProviderDriverKind, ProviderInstanceId } from "@t3tools/contracts";
import {
  buildProviderAccountSwitchOptions,
  hasProviderAccount,
  modelForProviderAccountSwitch,
  type ProviderAccountSummary,
} from "@t3tools/client-runtime/state/provider-accounts";
import { CheckIcon, ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";

import { cn } from "~/lib/utils";
import type { ProviderInstanceEntry } from "../../providerInstances";
import { RedactedSensitiveText } from "../settings/RedactedSensitiveText";
import { barColor } from "../usage/UsageLimits";
import { ProviderInstanceIcon } from "./ProviderInstanceIcon";
import type { ModelEsque } from "./providerIconUtils";

/** Email blurred until clicked, like other account labels; otherwise the instance and plan. */
function AccountName({ account }: { readonly account: ProviderAccountSummary }) {
  return account.email ? (
    <RedactedSensitiveText
      key={account.email}
      value={account.email}
      ariaLabel="Toggle account email visibility"
      revealTooltip="Click to reveal account"
      hideTooltip="Click to hide account"
      className="pointer-events-auto relative z-10 max-w-full truncate font-sans text-xs leading-normal"
    />
  ) : (
    <span className="truncate text-xs text-foreground">{account.label}</span>
  );
}

/** "Weekly remaining", the remaining-quota bar, and its percent; or why there is none. */
function WeeklyRemaining({ account }: { readonly account: ProviderAccountSummary }) {
  const remaining = account.weeklyRemainingPercent;
  if (remaining === null) {
    return <span className="truncate text-xs text-muted-foreground">{account.notice}</span>;
  }
  return (
    <span className="flex min-w-0 items-center gap-2 text-xs">
      <span className="shrink-0 text-muted-foreground">Weekly remaining</span>
      <span
        role="img"
        aria-label={`Weekly remaining: ${remaining}%`}
        className="relative h-1.5 min-w-8 flex-1 overflow-hidden rounded-full bg-muted"
      >
        {remaining > 0 ? (
          <span
            className="absolute inset-y-0 left-0 rounded-full"
            style={{ width: `${remaining}%`, backgroundColor: barColor(account.driver) }}
          />
        ) : null}
      </span>
      <span className="shrink-0 font-medium text-foreground tabular-nums">{remaining}%</span>
    </span>
  );
}

function lockFor(
  lockedProvider: ProviderDriverKind | null,
  lockedContinuationGroupKey: string | null,
) {
  return lockedProvider === null
    ? null
    : { driver: lockedProvider, continuationGroupKey: lockedContinuationGroupKey };
}

/**
 * The composer picker's account header and switcher. Above the model list it
 * names the selected instance's account and its weekly quota; clicking it
 * swaps the model list for the driver's other accounts. Instances without an
 * account (no sign-in) render the model list alone.
 */
export function ModelPickerAccountPanel(props: {
  readonly activeEntry: ProviderInstanceEntry | null;
  readonly model: string;
  readonly instanceEntries: ReadonlyArray<ProviderInstanceEntry>;
  readonly modelOptionsByInstance: ReadonlyMap<ProviderInstanceId, ReadonlyArray<ModelEsque>>;
  readonly lockedProvider: ProviderDriverKind | null;
  readonly lockedContinuationGroupKey: string | null;
  readonly onInstanceModelChange: (instanceId: ProviderInstanceId, model: string) => void;
  /** The model list shown beneath the header. */
  readonly children: ReactNode;
}) {
  const [switching, setSwitching] = useState(false);
  const { activeEntry, instanceEntries, lockedProvider, lockedContinuationGroupKey } = props;
  const options = useMemo(
    () =>
      activeEntry && hasProviderAccount(activeEntry.snapshot)
        ? buildProviderAccountSwitchOptions({
            // Settings decide `enabled` before the next probe catches up.
            providers: instanceEntries.map((entry) =>
              entry.enabled === entry.snapshot.enabled
                ? entry.snapshot
                : { ...entry.snapshot, enabled: entry.enabled },
            ),
            activeInstanceId: activeEntry.instanceId,
            lock: lockFor(lockedProvider, lockedContinuationGroupKey),
          })
        : [],
    [activeEntry, instanceEntries, lockedContinuationGroupKey, lockedProvider],
  );
  const active = options[0];
  if (!active) return props.children;

  if (!switching) {
    return (
      <>
        <div className="relative flex w-full min-w-0 flex-col gap-1 border-b border-border/70 px-3 py-2 hover:bg-accent/50">
          <button
            type="button"
            aria-label="Switch account"
            className="absolute inset-0 cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
            onClick={() => setSwitching(true)}
          />
          <span className="pointer-events-none flex min-w-0 items-center gap-2">
            <span className="flex min-w-0 flex-1">
              <AccountName account={active} />
            </span>
            <ChevronRightIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
          </span>
          <span className="pointer-events-none">
            <WeeklyRemaining account={active} />
          </span>
        </div>
        {props.children}
      </>
    );
  }

  const entryById = new Map(instanceEntries.map((entry) => [entry.instanceId, entry]));
  const select = (instanceId: ProviderInstanceId) => {
    const target = entryById.get(instanceId);
    if (!target) return;
    if (instanceId === active.instanceId) {
      setSwitching(false);
      return;
    }
    const targetOptions = props.modelOptionsByInstance.get(instanceId);
    const model = modelForProviderAccountSwitch({
      driver: target.driverKind,
      models: targetOptions ?? target.models,
      currentModel: props.model,
    });
    if (!model) return;
    setSwitching(false);
    props.onInstanceModelChange(instanceId, model);
  };

  return (
    <div
      className="flex max-h-86.5 w-screen max-w-90 flex-col overflow-y-auto overscroll-y-contain bg-muted/40 py-1"
      data-model-picker-content="true"
    >
      <button
        type="button"
        className="mx-1 flex items-center gap-1 rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
        onClick={() => setSwitching(false)}
      >
        <ChevronLeftIcon aria-hidden className="size-4" />
        Models
      </button>
      {options.map((option) => {
        const entry = entryById.get(option.instanceId);
        const disabled = option.disabledReason !== null;
        return (
          <div
            key={option.instanceId}
            className={cn(
              "relative mx-1 flex min-w-0 items-start gap-2 rounded-md px-2 py-2",
              disabled ? "opacity-60" : "hover:bg-accent",
            )}
          >
            <button
              type="button"
              disabled={disabled}
              aria-label={`Switch to ${option.label}`}
              aria-current={option.isActive ? "true" : undefined}
              className="absolute inset-0 cursor-pointer rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed"
              onClick={() => select(option.instanceId)}
            />
            {entry ? (
              <ProviderInstanceIcon
                driverKind={entry.driverKind}
                displayName={entry.displayName}
                accentColor={entry.accentColor}
                showBadge
                className="pointer-events-none mt-0.5 size-4 shrink-0"
                iconClassName="size-4"
              />
            ) : null}
            <span className="pointer-events-none flex min-w-0 flex-1 flex-col gap-1">
              <span className="flex min-w-0 items-center gap-2">
                <span className="flex min-w-0 flex-1">
                  <AccountName account={option} />
                </span>
                {option.isActive ? (
                  <CheckIcon aria-hidden className="size-3.5 shrink-0 text-foreground" />
                ) : null}
              </span>
              {option.email ? (
                <span className="truncate text-2xs text-muted-foreground">{option.label}</span>
              ) : null}
              <WeeklyRemaining account={option} />
              {option.disabledReason ? (
                <span className="text-2xs text-muted-foreground">{option.disabledReason}</span>
              ) : null}
            </span>
          </div>
        );
      })}
      {options.length === 1 ? (
        <p className="px-3 py-2 text-xs text-muted-foreground">No other accounts configured.</p>
      ) : null}
    </div>
  );
}
