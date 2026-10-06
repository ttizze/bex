import { describe, expect, it } from "vite-plus/test";

import { ProviderDriverKind, ProviderInstanceId } from "@t3tools/contracts";
import type { ProviderAccountSwitchOption } from "@t3tools/client-runtime/state/provider-accounts";

import type { ModelOption } from "../../lib/modelOptions";
import { isCommittableAccountSwitch } from "./thread-settings-account-state";

const claude = ProviderInstanceId.make("claude");
const work = ProviderInstanceId.make("claude_work");
const otherHome = ProviderInstanceId.make("claude_other_home");

function pending(instanceId: ProviderInstanceId, isUnavailable = false): ModelOption {
  return {
    key: `${instanceId}:claude-opus`,
    label: "Claude Opus",
    subtitle: "",
    providerKey: instanceId,
    providerLabel: "Claude",
    providerDriver: "claudeAgent",
    isDefault: false,
    isLegacy: false,
    ...(isUnavailable ? { isUnavailable } : {}),
    capabilities: null,
    selection: { instanceId, model: "claude-opus" },
  };
}

function account(
  instanceId: ProviderInstanceId,
  disabledReason: string | null = null,
): ProviderAccountSwitchOption {
  return {
    instanceId,
    driver: ProviderDriverKind.make("claudeAgent"),
    email: null,
    label: instanceId,
    weeklyRemainingPercent: null,
    notice: null,
    isActive: false,
    disabledReason,
  };
}

const accounts = [account(work), account(otherHome, "Can't continue this thread")];

describe("isCommittableAccountSwitch", () => {
  it("accepts a staged switch to another account the thread can continue on", () => {
    expect(
      isCommittableAccountSwitch({ pending: pending(work), appliedInstanceId: claude, accounts }),
    ).toBe(true);
  });

  it("leaves locked accounts, unavailable models and same-instance picks to the catalog check", () => {
    expect(
      isCommittableAccountSwitch({
        pending: pending(otherHome),
        appliedInstanceId: claude,
        accounts,
      }),
    ).toBe(false);
    expect(
      isCommittableAccountSwitch({
        pending: pending(work, true),
        appliedInstanceId: claude,
        accounts,
      }),
    ).toBe(false);
    expect(
      isCommittableAccountSwitch({
        pending: pending(work),
        appliedInstanceId: work,
        accounts,
      }),
    ).toBe(false);
  });
});
