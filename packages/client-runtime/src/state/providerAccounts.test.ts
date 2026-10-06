import {
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
  type ServerProviderUsageLimits,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  ACCOUNT_SWITCH_LOCKED_REASON,
  ACCOUNT_SWITCH_UNAVAILABLE_REASON,
  buildProviderAccountSwitchOptions,
  canContinueOnProvider,
  modelForProviderAccountSwitch,
  summarizeProviderAccount,
  weeklyUsageWindow,
} from "./providerAccounts.ts";

const claude = ProviderDriverKind.make("claudeAgent");
const codex = ProviderDriverKind.make("codex");

function limits(windows: ServerProviderUsageLimits["windows"]): ServerProviderUsageLimits {
  return { checkedAt: "2026-10-07T00:00:00.000Z", windows };
}

const session = { id: "five_hour", kind: "session", label: "Session", usedPercent: 50 } as const;
const weekly = { id: "seven_day", kind: "weekly", label: "Weekly", usedPercent: 3 } as const;
const scopedWeekly = {
  id: "seven_day_fable",
  kind: "weekly",
  label: "Weekly · Fable",
  usedPercent: 90,
} as const;

function provider(instanceId: string, overrides: Partial<ServerProvider> = {}): ServerProvider {
  return {
    instanceId: ProviderInstanceId.make(instanceId),
    driver: claude,
    enabled: true,
    installed: true,
    version: null,
    status: "ready",
    auth: { status: "authenticated", email: `${instanceId}@example.com` },
    checkedAt: "2026-10-07T00:00:00.000Z",
    models: [],
    slashCommands: [],
    skills: [],
    ...overrides,
  };
}

describe("weeklyUsageWindow", () => {
  it("picks the account-wide weekly window ahead of a model-scoped one", () => {
    expect(weeklyUsageWindow(limits([session, weekly, scopedWeekly]))).toBe(weekly);
  });

  it("is null without usage or without a weekly window", () => {
    expect(weeklyUsageWindow(undefined)).toBeNull();
    expect(weeklyUsageWindow(limits([session]))).toBeNull();
  });
});

describe("summarizeProviderAccount", () => {
  it("reports the email and the weekly quota left", () => {
    expect(
      summarizeProviderAccount(provider("claude", { usageLimits: limits([session, weekly]) })),
    ).toMatchObject({ email: "claude@example.com", weeklyRemainingPercent: 97, notice: null });
  });

  it("falls back to the instance name and plan when there is no email", () => {
    const summary = summarizeProviderAccount(
      provider("claude_work", {
        auth: { status: "authenticated", label: "Claude Max Subscription" },
      }),
    );
    expect(summary.email).toBeNull();
    expect(summary.label).toBe("Claude Work · Claude Max Subscription");
  });

  it("explains a missing bar with the shared limits notice", () => {
    expect(summarizeProviderAccount(provider("claude")).notice).toBe("Usage unavailable.");
    expect(
      summarizeProviderAccount(
        provider("claude", {
          usageLimits: { ...limits([]), unavailable: { reason: "unsupported" } },
        }),
      ).notice,
    ).toBe("This account has no subscription limits.");
    expect(
      summarizeProviderAccount(provider("claude", { usageLimits: limits([session]) })).notice,
    ).toBe("No weekly limit reported.");
  });
});

describe("canContinueOnProvider", () => {
  const home = { groupKey: "home-a" };
  it("allows anything without a lock", () => {
    expect(canContinueOnProvider(provider("codex", { driver: codex }), null)).toBe(true);
  });

  it("requires the locked driver and, when set, the same continuation group", () => {
    const lock = { driver: claude, continuationGroupKey: "home-a" };
    expect(canContinueOnProvider(provider("a", { continuation: home }), lock)).toBe(true);
    expect(
      canContinueOnProvider(provider("b", { continuation: { groupKey: "home-b" } }), lock),
    ).toBe(false);
    expect(canContinueOnProvider(provider("c", { driver: codex, continuation: home }), lock)).toBe(
      false,
    );
    expect(
      canContinueOnProvider(provider("d"), { driver: claude, continuationGroupKey: null }),
    ).toBe(true);
  });
});

describe("buildProviderAccountSwitchOptions", () => {
  const providers = [
    provider("claude", { continuation: { groupKey: "home-a" } }),
    provider("codex", { driver: codex }),
    provider("claude_work", { continuation: { groupKey: "home-a" } }),
    provider("claude_other_home", { continuation: { groupKey: "home-b" } }),
    provider("claude_signed_out", { auth: { status: "unauthenticated" } }),
    provider("claude_disabled", { enabled: false }),
    provider("claude_erroring", { status: "error", continuation: { groupKey: "home-a" } }),
  ];

  it("lists the active account first, then signed-in accounts of the same driver", () => {
    const options = buildProviderAccountSwitchOptions({
      providers,
      activeInstanceId: ProviderInstanceId.make("claude"),
      lock: null,
    });
    expect(options.map((option) => [option.instanceId, option.disabledReason])).toEqual([
      ["claude", null],
      ["claude_work", null],
      ["claude_other_home", null],
      ["claude_erroring", ACCOUNT_SWITCH_UNAVAILABLE_REASON],
    ]);
    expect(options[0]?.isActive).toBe(true);
  });

  it("disables accounts a locked thread cannot continue on", () => {
    const options = buildProviderAccountSwitchOptions({
      providers,
      activeInstanceId: ProviderInstanceId.make("claude"),
      lock: { driver: claude, continuationGroupKey: "home-a" },
    });
    expect(
      options.find((option) => option.instanceId === "claude_other_home")?.disabledReason,
    ).toBe(ACCOUNT_SWITCH_LOCKED_REASON);
    expect(options.find((option) => option.instanceId === "claude_work")?.disabledReason).toBe(
      null,
    );
  });

  it("is empty when the active instance is missing", () => {
    expect(
      buildProviderAccountSwitchOptions({
        providers,
        activeInstanceId: ProviderInstanceId.make("gone"),
        lock: null,
      }),
    ).toEqual([]);
  });
});

describe("modelForProviderAccountSwitch", () => {
  const models = [
    { slug: "custom", isCustom: true },
    { slug: "claude-sonnet", isDefault: true },
    { slug: "claude-opus" },
    { slug: "claude-gone", isUnavailable: true },
  ];

  it("keeps the current model when the target offers it", () => {
    expect(
      modelForProviderAccountSwitch({ driver: claude, models, currentModel: "claude-opus" }),
    ).toBe("claude-opus");
  });

  it("uses the target's default otherwise, never an unavailable model", () => {
    expect(
      modelForProviderAccountSwitch({ driver: claude, models, currentModel: "claude-gone" }),
    ).toBe("claude-sonnet");
    expect(
      modelForProviderAccountSwitch({
        driver: claude,
        models: [{ slug: "custom", isCustom: true }, { slug: "claude-opus" }],
        currentModel: "x",
      }),
    ).toBe("claude-opus");
  });

  it("falls back to the driver default when the target lists no models", () => {
    expect(
      modelForProviderAccountSwitch({ driver: codex, models: [], currentModel: "x" }),
    ).toBeTruthy();
  });
});
