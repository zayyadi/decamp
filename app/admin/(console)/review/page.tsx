import type { Metadata } from "next";
import { Suspense } from "react";
import { AdminEmpty, AdminGate, AdminPage } from "@/components/admin/admin-shell";
import { ReviewCard, ReviewOptions } from "@/components/admin/review-card";
import { getReference } from "@/lib/queries/dashboard";
import { getMemberOptions, getMergeTargets, getReviewQueue } from "@/lib/queries/admin";

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

async function Queue() {
  const [queue, members, reference] = await Promise.all([getReviewQueue(), getMemberOptions(), getReference()]);
  const targets = await getMergeTargets([...new Set(queue.flatMap((q) => (q.legislator ? [q.legislator.id] : [])))]);
  return (
    <AdminPage
      title="Review queue"
      description="Events the agent was not sure enough to publish, highest score first. Approving publishes the defection and changes party counts; rejecting and merging change nothing public."
    >
      {queue.length === 0 ? (
        <AdminEmpty>Nothing to review. New items appear here when the agent routes them to review.</AdminEmpty>
      ) : (
        <ReviewOptions
          value={{ members, parties: reference.parties, states: reference.states.map((s) => s.name).filter((s) => s !== "FCT") }}
        >
          <p className="text-sm text-muted-foreground">
            {queue.length} item{queue.length === 1 ? "" : "s"} waiting
          </p>
          <div className="space-y-4">
            {queue.map((item) => (
              <ReviewCard key={item.id} item={item} targets={targets.filter((t) => t.legislator_id === item.legislator?.id)} />
            ))}
          </div>
        </ReviewOptions>
      )}
    </AdminPage>
  );
}
