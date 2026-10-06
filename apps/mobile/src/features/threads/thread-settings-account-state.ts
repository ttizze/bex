import type { ProviderAccountSwitchOption } from "@t3tools/client-runtime/state/provider-accounts";
import type { ProviderInstanceId } from "@t3tools/contracts";

import type { ModelOption } from "../../lib/modelOptions";

/**
 * Whether a staged model is an account switch Save may apply. A locked
 * thread's catalog lists only its own instance, so a switch to another
 * account of the same continuation group is checked against the switcher
 * instead of the catalog.
 */
export function isCommittableAccountSwitch(input: {
  readonly pending: ModelOption;
  readonly appliedInstanceId: ProviderInstanceId | undefined;
  readonly accounts: ReadonlyArray<ProviderAccountSwitchOption>;
}): boolean {
  const instanceId = input.pending.selection.instanceId;
  return (
    input.pending.isUnavailable !== true &&
    instanceId !== input.appliedInstanceId &&
    input.accounts.some(
      (account) => account.instanceId === instanceId && account.disabledReason === null,
    )
  );
}
