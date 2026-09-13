"use client";

import { CircleCheck, Copy } from "lucide-react";
import * as React from "react";

import { Panel, PanelBody, PanelHeader } from "@/components/ui/primitives";

export function JoinCodeCard({ code }: { code: string }) {
  const [copied, setCopied] = React.useState(false);

  return (
    <Panel>
      <PanelHeader
        title="Class code"
        description="Identifies this classroom. Share it with students or with another teacher."
      />
      <PanelBody className="flex items-center gap-3">
        <code className="num flex-1 rounded-md border border-hairline bg-surface-2 px-3 py-2 font-mono text-[15px] tracking-[0.16em] text-ink">
          {code}
        </code>
        <button
          type="button"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(code);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            } catch {
              setCopied(false);
            }
          }}
          className="grid size-9 place-items-center rounded-md border border-hairline bg-surface-2 text-ink-subtle transition-colors hover:border-hairline-strong hover:text-ink"
          aria-label="Copy class code"
        >
          {copied ? (
            <CircleCheck className="size-4 text-pos" />
          ) : (
            <Copy className="size-4" />
          )}
        </button>
      </PanelBody>
    </Panel>
  );
}
