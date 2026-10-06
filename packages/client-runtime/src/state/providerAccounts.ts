/**
 * The account a composer's provider instance runs on, and the other accounts
 * of the same driver it could switch to. Shared by the web and mobile model
 * pickers so both name the account, read its weekly allowance, and decide
 * which switches a thread can take the same way.
 *
 * @module providerAccounts
 */
import {
  DEFAULT_MODEL_BY_PROVIDER,
  type ProviderDriverKind,
  type ProviderInstanceId,
  type ServerProvider,
  type ServerProviderUsageLimits,
  type ServerProviderUsageWindow,
} from "@t3tools/contracts";
import { limitsNotice, remainingPercent } from "@t3tools/shared/usageLimits";

import { resolveProviderInstanceDisplayName } from "./providerInstanceDisplay.ts";

/**
 * The account-wide weekly window. Providers list it before any model-scoped
 * weekly window (Claude's `Weekly · <model>`), so the first one is the
 * allowance every model on the account draws from.
 */
export function weeklyUsageWindow(
  limits: ServerProviderUsageLimits | undefined,
): ServerProviderUsageWindow | null {
  return limits?.windows.find((window) => window.kind === "weekly") ?? null;
}

export interface ProviderAccountSummary {
  readonly instanceId: ProviderInstanceId;
  readonly driver: ProviderDriverKind;
  /** The signed-in address. Clients redact it like other account emails. */
  readonly email: string | null;
  /** Instance name and plan, for the account line when there is no email. */
  readonly label: string;
  /** Weekly quota left, 0..100, or null when the account reports no weekly window. */
  readonly weeklyRemainingPercent: number | null;
  /** Why there is no weekly bar; null whenever `weeklyRemainingPercent` is set. */
  readonly notice: string | null;
}

export function summarizeProviderAccount(provider: ServerProvider): ProviderAccountSummary {
  const displayName = resolveProviderInstanceDisplayName(provider);
  const plan = provider.auth.label?.trim();
  const weekly = weeklyUsageWindow(provider.usageLimits);
  const notice = weekly
    ? null
    : provider.usageLimits
      ? (limitsNotice(provider.usageLimits) ?? "No weekly limit reported.")
      : "Usage unavailable.";
  return {
    instanceId: provider.instanceId,
    driver: provider.driver,
    email: provider.auth.email?.trim() || null,
    label: plan && plan !== displayName ? `${displayName} · ${plan}` : displayName,
    weeklyRemainingPercent: weekly ? remainingPercent(weekly) : null,
    notice,
  };
}

/** Whether the instance is signed in to an account a user would recognize. */
export function hasProviderAccount(provider: ServerProvider): boolean {
  return Boolean(provider.auth.email?.trim()) || provider.auth.status === "authenticated";
}

/**
 * What a started thread can continue on: its driver and, when the driver
 * keeps history per account home, that home's continuation group. Null when
 * the thread is free to move anywhere.
 */
export interface ProviderAccountLock {
  readonly driver: ProviderDriverKind;
  readonly continuationGroupKey: string | null;
}

/** The picker's locked-provider rule: same driver, and same group when one is set. */
export function canContinueOnProvider(
  provider: Pick<ServerProvider, "driver" | "continuation">,
  lock: ProviderAccountLock | null,
): boolean {
  if (lock === null) return true;
  if (provider.driver !== lock.driver) return false;
  if (!lock.continuationGroupKey) return true;
  return provider.continuation?.groupKey === lock.continuationGroupKey;
}

export interface ProviderAccountSwitchOption extends ProviderAccountSummary {
  readonly isActive: boolean;
  /** Short reason the account cannot be picked, or null when it can. */
  readonly disabledReason: string | null;
}

export const ACCOUNT_SWITCH_LOCKED_REASON = "Can't continue this thread";
export const ACCOUNT_SWITCH_UNAVAILABLE_REASON = "Not available";

/**
 * The active account first, then every other enabled instance of the same
 * driver that is signed in. Accounts a thread cannot continue on, or that
 * cannot start a turn right now, stay listed with the reason they are off.
 */
export function buildProviderAccountSwitchOptions(input: {
  readonly providers: ReadonlyArray<ServerProvider>;
  readonly activeInstanceId: ProviderInstanceId;
  readonly lock: ProviderAccountLock | null;
}): ReadonlyArray<ProviderAccountSwitchOption> {
  const active = input.providers.find((provider) => provider.instanceId === input.activeInstanceId);
  if (!active) return [];
  const others = input.providers.filter(
    (provider) =>
      provider.instanceId !== active.instanceId &&
      provider.driver === active.driver &&
      provider.enabled &&
      hasProviderAccount(provider),
  );
  return [
    { ...summarizeProviderAccount(active), isActive: true, disabledReason: null },
    ...others.map((provider) => ({
      ...summarizeProviderAccount(provider),
      isActive: false,
      disabledReason: !canContinueOnProvider(provider, input.lock)
        ? ACCOUNT_SWITCH_LOCKED_REASON
        : provider.status !== "ready" ||
            !provider.installed ||
            provider.availability === "unavailable"
          ? ACCOUNT_SWITCH_UNAVAILABLE_REASON
          : null,
    })),
  ];
}

/**
 * The model to use after switching accounts: the current one when the target
 * offers it, else the target's own default, so a switch never pairs an
 * instance with a model it does not serve.
 */
export function modelForProviderAccountSwitch(input: {
  readonly driver: ProviderDriverKind;
  readonly models: ReadonlyArray<{
    readonly slug: string;
    readonly isDefault?: boolean | undefined;
    readonly isCustom?: boolean | undefined;
    readonly isUnavailable?: boolean | undefined;
  }>;
  readonly currentModel: string;
}): string | null {
  const available = input.models.filter((model) => model.isUnavailable !== true);
  if (available.some((model) => model.slug === input.currentModel)) return input.currentModel;
  return (
    available.find((model) => model.isDefault && !model.isCustom)?.slug ??
    available.find((model) => !model.isCustom)?.slug ??
    available[0]?.slug ??
    DEFAULT_MODEL_BY_PROVIDER[input.driver] ??
    null
  );
}
