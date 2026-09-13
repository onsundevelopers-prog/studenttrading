"use client";

import { CircleAlert, LoaderCircle, RefreshCw, RotateCcw, Save } from "lucide-react";
import * as React from "react";
import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox, FieldGroup, Input, Select } from "@/components/ui/field";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTrigger,
} from "@/components/ui/overlays";
import {
  Notice,
  Panel,
  PanelBody,
  PanelHeader,
} from "@/components/ui/primitives";
import {
  refreshMarketNowAction,
  resetClassroomAction,
  setClassroomAssetsAction,
  updateClassSettingsAction,
} from "@/lib/actions/classroom";
import type { FormState } from "@/lib/actions/form-state";
import type { Asset, ClassSettings } from "@/lib/types";

/** `datetime-local` inputs need a local-time string, not an ISO timestamp. */
function toLocalInputValue(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

function Feedback({ state }: { state: FormState }) {
  if (!state?.message) return null;
  if (state.ok) {
    return (
      <div className="rounded-md border border-pos/35 bg-pos/8 px-3 py-2 text-[12px] leading-relaxed text-pos">
        {state.message}
      </div>
    );
  }
  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-md border border-neg/35 bg-neg/8 px-3 py-2"
    >
      <CircleAlert className="mt-[1px] size-3.5 shrink-0 text-neg" />
      <p className="text-[12px] leading-relaxed text-neg">{state.message}</p>
    </div>
  );
}

export function ClassSettingsForm({
  classroomId,
  settings,
  defaultStartingCapital,
}: {
  classroomId: string;
  settings: ClassSettings;
  defaultStartingCapital: number;
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    updateClassSettingsAction,
    null,
  );

  return (
    <Panel>
      <PanelHeader
        title="Trading rules"
        description="These apply to every student in the classroom, and are enforced on the server for every order."
      />
      <form action={formAction}>
        <PanelBody className="space-y-5">
          <input type="hidden" name="classroomId" value={classroomId} />

          <div className="space-y-3">
            <Checkbox
              name="tradingEnabled"
              value="on"
              label="Trading enabled"
              hint="Turn this off to pause the market for the whole class instantly."
              defaultChecked={settings.tradingEnabled}
            />
            <FieldGroup
              label="Message shown while paused"
              htmlFor="pausedReason"
              hint="Students see exactly this text when they try to trade."
            >
              <Input
                id="pausedReason"
                name="pausedReason"
                defaultValue={settings.pausedReason ?? ""}
                placeholder="Trading is paused while we review supply and demand."
                className="h-9"
              />
            </FieldGroup>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <FieldGroup
              label="Trading window opens"
              htmlFor="tradingOpensAt"
              hint="Optional. Leave blank for no restriction."
            >
              <Input
                id="tradingOpensAt"
                name="tradingOpensAt"
                type="datetime-local"
                defaultValue={toLocalInputValue(settings.tradingOpensAt)}
                className="h-9 num"
              />
            </FieldGroup>
            <FieldGroup
              label="Trading window closes"
              htmlFor="tradingClosesAt"
              hint="Optional. Orders after this time are rejected."
            >
              <Input
                id="tradingClosesAt"
                name="tradingClosesAt"
                type="datetime-local"
                defaultValue={toLocalInputValue(settings.tradingClosesAt)}
                className="h-9 num"
              />
            </FieldGroup>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <FieldGroup
              label="Order size limit"
              htmlFor="maxTradeValue"
              hint="Maximum virtual dollars in a single order."
            >
              <Input
                id="maxTradeValue"
                name="maxTradeValue"
                type="number"
                min={0}
                step="100"
                placeholder="No limit"
                defaultValue={settings.maxTradeValue ?? ""}
                className="h-9 num"
              />
            </FieldGroup>
            <FieldGroup
              label="Concentration limit"
              htmlFor="maxPositionPercent"
              hint="Maximum share of the portfolio in one asset, as a percentage."
            >
              <Input
                id="maxPositionPercent"
                name="maxPositionPercent"
                type="number"
                min={1}
                max={100}
                step="1"
                placeholder="No limit"
                defaultValue={settings.maxPositionPercent ?? ""}
                className="h-9 num"
              />
            </FieldGroup>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <FieldGroup
              label="Permitted assets"
              htmlFor="assetPolicy"
              hint="An allow-list restricts trading to the assets you select below."
            >
              <Select
                id="assetPolicy"
                name="assetPolicy"
                defaultValue={settings.assetPolicy}
              >
                <option value="all">Everything in the simulator</option>
                <option value="allowlist">Only the assets I allow</option>
              </Select>
            </FieldGroup>

            <div className="flex items-end pb-1">
              <Checkbox
                name="allowFractional"
                value="on"
                label="Allow fractional stock shares"
                hint="Crypto is always fractional. Uncheck to require whole shares of stock."
                defaultChecked={settings.allowFractional}
              />
            </div>
          </div>

          <Feedback state={state} />

          <div className="flex flex-wrap items-center gap-3 border-t border-hairline pt-4">
            <Button type="submit" variant="primary" size="md" disabled={pending}>
              {pending ? (
                <>
                  <LoaderCircle className="animate-spin" />
                  Saving…
                </>
              ) : (
                <>
                  <Save />
                  Save rules
                </>
              )}
            </Button>
            <p className="text-[11px] text-ink-tertiary">
              Class starting capital: ${defaultStartingCapital.toLocaleString("en-US")}
            </p>
          </div>
        </PanelBody>
      </form>
    </Panel>
  );
}

export function AssetAllowlistForm({
  classroomId,
  assets,
  selectedIds,
}: {
  classroomId: string;
  assets: Asset[];
  selectedIds: string[];
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    setClassroomAssetsAction,
    null,
  );
  const selected = React.useMemo(() => new Set(selectedIds), [selectedIds]);
  const [filter, setFilter] = React.useState("");

  const visible = React.useMemo(() => {
    const query = filter.trim().toLowerCase();
    if (!query) return assets;
    return assets.filter(
      (asset) =>
        asset.symbol.toLowerCase().includes(query) ||
        asset.displaySymbol.toLowerCase().includes(query) ||
        asset.name.toLowerCase().includes(query),
    );
  }, [assets, filter]);

  return (
    <Panel>
      <PanelHeader
        title="Permitted assets"
        description="Only applied when the permitted-assets rule above is set to an allow-list."
      />
      <form action={formAction}>
        <PanelBody className="space-y-3">
          <input type="hidden" name="classroomId" value={classroomId} />

          <Input
            type="search"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="Filter by ticker or name"
            aria-label="Filter assets"
            className="h-9"
          />

          <div className="max-h-[360px] overflow-y-auto rounded-md border border-hairline">
            <ul className="divide-y divide-hairline">
              {visible.map((asset) => (
                <li key={asset.id} className="px-3 py-2">
                  <label className="flex cursor-pointer items-center gap-3">
                    <input
                      type="checkbox"
                      name="assetIds"
                      value={asset.id}
                      defaultChecked={selected.has(asset.id)}
                      className="size-4 shrink-0 cursor-pointer appearance-none rounded-[4px] border border-hairline-strong bg-surface-1 checked:border-brand checked:bg-brand"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block font-mono text-[12px] text-ink">
                        {asset.displaySymbol}
                      </span>
                      <span className="block truncate text-[12px] text-ink-tertiary">
                        {asset.name}
                      </span>
                    </span>
                    <span className="shrink-0 text-[11px] text-ink-tertiary">
                      {asset.assetType === "crypto" ? "Crypto" : "Stock"}
                    </span>
                  </label>
                </li>
              ))}
              {visible.length === 0 ? (
                <li className="px-3 py-4 text-[12px] text-ink-tertiary">
                  No assets match that filter.
                </li>
              ) : null}
            </ul>
          </div>

          <Feedback state={state} />

          <div className="flex items-center justify-between gap-3">
            <p className="text-[11px] text-ink-tertiary">
              {selectedIds.length === 0
                ? "Nothing selected — with an allow-list active, no asset can be traded."
                : `${selectedIds.length} asset${selectedIds.length === 1 ? "" : "s"} currently permitted.`}
            </p>
            <Button type="submit" variant="primary" size="md" disabled={pending}>
              {pending ? (
                <>
                  <LoaderCircle className="animate-spin" />
                  Saving…
                </>
              ) : (
                <>
                  <Save />
                  Save allow-list
                </>
              )}
            </Button>
          </div>
        </PanelBody>
      </form>
    </Panel>
  );
}

export function RefreshMarketButton({ classroomId }: { classroomId: string }) {
  return (
    <form action={refreshMarketNowAction}>
      <input type="hidden" name="classroomId" value={classroomId} />
      <Button type="submit" size="sm" variant="secondary">
        <RefreshCw />
        Refresh prices
      </Button>
    </form>
  );
}

export function ResetClassroomDialog({
  classroomId,
  defaultStartingCapital,
  studentCount,
}: {
  classroomId: string;
  defaultStartingCapital: number;
  studentCount: number;
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    resetClassroomAction,
    null,
  );

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="danger" size="md">
          <RotateCcw />
          Reset simulation
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader
          title="Reset the whole simulation"
          description={`This deletes every trade, position and snapshot for all ${studentCount} students in this classroom and returns each of them to their starting capital. It cannot be undone.`}
        />
        <form action={formAction} className="space-y-3">
          <input type="hidden" name="classroomId" value={classroomId} />
          <Notice tone="neg">
            Export your results first if you need to keep a record of this
            simulation.
          </Notice>
          <FieldGroup
            label="Starting capital for the new simulation"
            htmlFor="resetStartingCapital"
            hint="Leave blank to keep each student's existing starting capital."
          >
            <Input
              id="resetStartingCapital"
              name="startingCapital"
              type="number"
              min={0}
              step="100"
              placeholder={String(defaultStartingCapital)}
              className="h-9 num"
            />
          </FieldGroup>
          <Feedback state={state} />
          <div className="flex justify-end gap-2">
            <DialogClose asChild>
              <Button type="button" variant="ghost" size="md" disabled={pending}>
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" variant="dangerSolid" size="md" disabled={pending}>
              {pending ? (
                <>
                  <LoaderCircle className="animate-spin" />
                  Resetting…
                </>
              ) : (
                "Reset everything"
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
