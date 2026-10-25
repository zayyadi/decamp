"use client";

import { useActionState } from "react";
import { signIn } from "@/app/admin/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ActionMessage } from "./action-message";

export function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(signIn, null);
  return (
    <form action={action} className="space-y-4" aria-busy={pending}>
      <input type="hidden" name="next" value={next} />
      <label className="grid gap-1.5 text-sm font-medium">
        Email
        <Input name="email" type="email" autoComplete="username" required className="bg-card" />
      </label>
      <label className="grid gap-1.5 text-sm font-medium">
        Password
        <Input name="password" type="password" autoComplete="current-password" required className="bg-card" />
      </label>
      <ActionMessage state={state} />
      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}
