import Link from "next/link";
import { PageHeading } from "@/components/section-card";
import { buttonVariants } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center gap-6 px-4 py-16 sm:px-6">
      <PageHeading eyebrow="404" title={<>Nothing <span className="text-highlight italic">here</span></>}>
        This page doesn&apos;t exist, or the record isn&apos;t public.
      </PageHeading>
      <div className="flex gap-3">
        <Link href="/" className={buttonVariants()}>
          Overview
        </Link>
        <Link href="/legislators" className={buttonVariants({ variant: "outline" })}>
          Legislators
        </Link>
      </div>
    </main>
  );
}
