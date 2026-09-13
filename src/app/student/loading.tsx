import { Panel, Skeleton } from "@/components/ui/primitives";

export default function StudentLoading() {
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-2">
          <Skeleton className="h-7 w-48" />
          <Skeleton className="h-3.5 w-64" />
        </div>
        <Skeleton className="h-8 w-28" />
      </div>

      <Panel className="px-5 py-4">
        <div className="grid grid-cols-2 gap-x-6 gap-y-5 lg:grid-cols-3 xl:grid-cols-5">
          {Array.from({ length: 5 }).map((_, index) => (
            <div key={index} className="space-y-2.5">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-7 w-24" />
              <Skeleton className="h-3 w-28" />
            </div>
          ))}
        </div>
      </Panel>

      <div className="grid gap-5 xl:grid-cols-3">
        <div className="space-y-5 xl:col-span-2">
          <Panel className="p-4">
            <Skeleton className="h-48 w-full" />
          </Panel>
          <Panel className="space-y-3 p-4">
            {Array.from({ length: 5 }).map((_, index) => (
              <Skeleton key={index} className="h-7 w-full" />
            ))}
          </Panel>
        </div>
        <div className="space-y-5">
          <Panel className="space-y-3 p-4">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-3 w-40" />
          </Panel>
          <Skeleton className="h-40 w-full" />
        </div>
      </div>
    </div>
  );
}
