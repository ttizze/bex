import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, ModelSelection, ProviderInstanceId } from "@t3tools/contracts";
import {
  buildProviderAccountSwitchOptions,
  hasProviderAccount,
  modelForProviderAccountSwitch,
  type ProviderAccountSummary,
  type ProviderAccountSwitchOption,
} from "@t3tools/client-runtime/state/provider-accounts";
import { useCallback, useMemo, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { SymbolView } from "../../components/AppSymbol";
import { AppText as Text } from "../../components/AppText";
import { ProviderIcon } from "../../components/ProviderIcon";
import { cn } from "../../lib/cn";
import { buildModelOptions, type ModelOption } from "../../lib/modelOptions";
import { environmentServerConfigsAtom } from "../../state/server";
import { useBarColor } from "../usage/UsageLimitsSection";

export type ThreadSettingsAccounts = {
  /** The displayed instance's account first, then the driver's other accounts. */
  readonly options: ReadonlyArray<ProviderAccountSwitchOption>;
  /** The model option a switch to this account stages, or null when it cannot. */
  readonly optionFor: (instanceId: ProviderInstanceId) => ModelOption | null;
};

/**
 * Accounts for the thread settings picker. `displayedSelection` is the staged
 * or applied model the header describes; a locked thread keeps the applied
 * instance's driver and continuation group, as the web picker does.
 */
export function useThreadSettingsAccounts(input: {
  readonly environmentId: EnvironmentId | null;
  readonly displayedSelection: ModelSelection | null;
  readonly appliedInstanceId: ProviderInstanceId | undefined;
  readonly locked: boolean;
}): ThreadSettingsAccounts {
  const configs = useAtomValue(environmentServerConfigsAtom);
  const config = input.environmentId ? (configs.get(input.environmentId) ?? null) : null;
  const displayedInstanceId = input.displayedSelection?.instanceId;
  const currentModel = input.displayedSelection?.model ?? "";
  const options = useMemo(() => {
    const providers = config?.providers ?? [];
    const displayed = providers.find((provider) => provider.instanceId === displayedInstanceId);
    if (!displayed || !hasProviderAccount(displayed)) return [];
    const applied = providers.find((provider) => provider.instanceId === input.appliedInstanceId);
    return buildProviderAccountSwitchOptions({
      providers,
      activeInstanceId: displayed.instanceId,
      lock:
        input.locked && applied
          ? { driver: applied.driver, continuationGroupKey: applied.continuation?.groupKey ?? null }
          : null,
    });
  }, [config, displayedInstanceId, input.appliedInstanceId, input.locked]);
  const optionFor = useCallback(
    (instanceId: ProviderInstanceId) => {
      const target = config?.providers.find((provider) => provider.instanceId === instanceId);
      if (!target) return null;
      const model = modelForProviderAccountSwitch({
        driver: target.driver,
        models: target.models,
        currentModel,
      });
      return (
        buildModelOptions(config, null, instanceId).find(
          (option) => option.selection.model === model,
        ) ?? null
      );
    },
    [config, currentModel],
  );
  return useMemo(() => ({ options, optionFor }), [optionFor, options]);
}

/** The email hidden until tapped, as provider account rows elsewhere show it. */
function AccountName(props: { readonly account: ProviderAccountSummary }) {
  const [revealed, setRevealed] = useState(false);
  const email = props.account.email;
  if (!email) {
    return (
      <Text className="shrink text-sm font-t3-medium text-foreground" numberOfLines={1}>
        {props.account.label}
      </Text>
    );
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={revealed ? "Hide account email" : "Reveal account email"}
      className="shrink active:opacity-60"
      hitSlop={8}
      onPress={() => setRevealed((value) => !value)}
    >
      <Text className="text-sm font-t3-medium text-foreground" numberOfLines={1}>
        {revealed ? email : "••••••@••••••"}
      </Text>
    </Pressable>
  );
}

/** "Weekly remaining", the remaining-quota bar, and its percent; or why there is none. */
function WeeklyRemaining(props: { readonly account: ProviderAccountSummary }) {
  const color = useBarColor(props.account.driver);
  const remaining = props.account.weeklyRemainingPercent;
  if (remaining === null) {
    return (
      <Text className="text-xs text-foreground-muted" numberOfLines={1}>
        {props.account.notice}
      </Text>
    );
  }
  return (
    <View
      accessible
      accessibilityLabel={`Weekly remaining: ${remaining}%`}
      className="flex-row items-center gap-2"
    >
      <Text className="text-xs text-foreground-muted">Weekly remaining</Text>
      <View className="h-1.5 flex-1 flex-row overflow-hidden rounded-full bg-subtle">
        <View
          className="h-full rounded-full bg-foreground"
          style={[{ flex: remaining }, color ? { backgroundColor: color } : null]}
        />
        <View style={{ flex: 100 - remaining }} />
      </View>
      <Text className="text-xs font-t3-medium tabular-nums text-foreground">{remaining}%</Text>
    </View>
  );
}

/** Top of the model list: the account in use and its weekly quota. Tapping opens the switcher. */
export function ThreadSettingsAccountHeader(props: {
  readonly account: ProviderAccountSwitchOption;
  readonly onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityHint="Switch account"
      className="mx-4 mb-2 gap-1.5 rounded-2xl bg-grouped-card px-4 py-3 active:bg-subtle"
      onPress={props.onPress}
    >
      <View className="flex-row items-center gap-2">
        <ProviderIcon provider={props.account.driver} size={15} />
        <View className="min-w-0 flex-1 flex-row">
          <AccountName account={props.account} />
        </View>
        <SymbolView
          name="chevron.right"
          size={12}
          tintColorClassName="accent-icon-subtle"
          type="monochrome"
        />
      </View>
      <WeeklyRemaining account={props.account} />
    </Pressable>
  );
}

/** The driver's accounts; locked or unavailable ones stay listed with their reason. */
export function ThreadSettingsAccountList(props: {
  readonly options: ReadonlyArray<ProviderAccountSwitchOption>;
  readonly onSelect: (instanceId: ProviderInstanceId) => void;
}) {
  const insets = useSafeAreaInsets();
  return (
    <ScrollView
      className="flex-1 bg-sheet"
      contentContainerStyle={{
        paddingBottom: insets.bottom + 12,
        paddingHorizontal: 16,
        paddingTop: 16,
      }}
      contentInsetAdjustmentBehavior="automatic"
      showsVerticalScrollIndicator={false}
    >
      <View className="overflow-hidden rounded-2xl bg-grouped-card">
        {props.options.map((option, index) => {
          const disabled = option.disabledReason !== null;
          return (
            <Pressable
              key={option.instanceId}
              accessibilityRole="radio"
              accessibilityState={{ checked: option.isActive, disabled }}
              disabled={disabled}
              className={cn(
                "min-h-14 gap-1.5 bg-grouped-card px-4 py-3 active:bg-subtle",
                index < props.options.length - 1 && "border-b border-border-subtle",
                disabled && "opacity-50",
              )}
              onPress={() => props.onSelect(option.instanceId)}
            >
              <View className="flex-row items-center gap-2">
                <View className="min-w-0 flex-1 flex-row">
                  <AccountName account={option} />
                </View>
                {option.isActive ? (
                  <SymbolView
                    name="checkmark"
                    size={16}
                    tintColorClassName="accent-icon"
                    type="monochrome"
                    weight="semibold"
                  />
                ) : null}
              </View>
              {option.email ? (
                <Text className="text-xs text-foreground-muted" numberOfLines={1}>
                  {option.label}
                </Text>
              ) : null}
              <WeeklyRemaining account={option} />
              {option.disabledReason ? (
                <Text className="text-xs text-foreground-muted">{option.disabledReason}</Text>
              ) : null}
            </Pressable>
          );
        })}
      </View>
      {props.options.length === 1 ? (
        <Text className="px-1 pt-3 text-sm text-foreground-muted">
          No other accounts configured.
        </Text>
      ) : null}
    </ScrollView>
  );
}
