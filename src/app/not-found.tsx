import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Panel } from "@/components/ui/primitives";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-lg px-4 py-20">
      <Panel className="p-6">
        <p className="eyebrow">404</p>
        <h1 className="mt-3 text-headline font-medium text-ink">
          That page does not exist.
        </h1>
        <p className="mt-2 text-[13px] leading-relaxed text-ink-subtle">
          If you followed a link to a student or an investment, it may have been
          removed, or it may belong to a different classroom.
        </p>
        <div className="mt-5 flex gap-2">
          <Button asChild size="md" variant="primary">
            <Link href="/dashboard">Go to dashboard</Link>
          </Button>
        </div>
      </Panel>
    </div>
  );
}
