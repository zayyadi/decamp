import type { Metadata } from "next";
import { Suspense } from "react";
import { AdminEmpty, AdminGate, AdminPage } from "@/components/admin/admin-shell";
import { ReviewCard, ReviewOptions } from "@/components/admin/review-card";
import { getReference } from "@/lib/queries/dashboard";
import { getBackfillQueue, getMemberOptions, getMergeTargets, getReviewQueue, type QueueItem } from "@/lib/queries/admin";

export const metadata: Metadata = { title: "Review queue" };

export default function ReviewPage() {
  return (
    <Suspense fallback={<div className="h-96 animate-pulse rounded-2xl bg-muted" aria-busy aria-label="Loading the review queue" />}>
      <AdminGate path="/admin/review">
        <Queue />
      </AdminGate>
    </Suspense>
  );
}

const waiting = (n: number) => `${n} item${n === 1 ? "" : "s"} waiting`;

async function Queue() {
  const [queue, backfill, members, reference] = await Promise.all([
    getReviewQueue(),
    getBackfillQueue(),
    getMemberOptions(),
    getReference(),
  ]);
  const all = [...queue, ...backfill];
  const targets = await getMergeTargets([...new Set(all.flatMap((q) => (q.legislator ? [q.legislator.id] : [])))]);
  const cards = (items: QueueItem[]) => (
    <div className="space-y-4">
      {items.map((item) => (
        <ReviewCard key={item.id} item={item} targets={targets.filter((t) => t.legislator_id === item.legislator?.id)} />
      ))}
    </div>
  );
  return (
    <AdminPage
      title="Review queue"
      description="Events the agent was not sure enough to publish, highest score first. Approving publishes the defection and changes party counts; rejecting and merging change nothing public."
    >
      {all.length === 0 ? (
        <AdminEmpty>Nothing to review. New items appear here when the agent routes them to review.</AdminEmpty>
      ) : (
        <ReviewOptions
          value={{ members, parties: reference.parties, states: reference.states.map((s) => s.name).filter((s) => s !== "FCT") }}
        >
          {queue.length ? (
            <>
              <p className="text-sm text-muted-foreground">{waiting(queue.length)}</p>
              {cards(queue)}
            </>
          ) : (
            <AdminEmpty>Nothing from the agent to review.</AdminEmpty>
          )}
          {backfill.length ? (
            <section className="space-y-4 border-t pt-6" aria-labelledby="backfill-heading">
              <div className="space-y-1">
                <h2 id="backfill-heading" className="font-heading text-xl font-bold">
                  State-assembly backfill
                </h2>
                <p className="text-sm text-muted-foreground">
                  Researched records since June 2023, oldest first. Check each source, add the member from the pre-filled
                  details, then approve. Approved records appear on their historical dates. {waiting(backfill.length)}.
                </p>
              </div>
              {cards(backfill)}
            </section>
          ) : null}
        </ReviewOptions>
      )}
    </AdminPage>
  );
}
