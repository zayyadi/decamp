import { parseArgs } from "node:util";
import { createServiceClient } from "@/lib/supabase/service";
import { loadLocalEnv } from "./lib/load-env";

// Grants or revokes the admin role (app_metadata.role, read by is_admin() and
// the admin pages). Create the user first in the Supabase dashboard
// (Authentication → Users). app_metadata can only be written with the
// service role, so users can't promote themselves.

const usage = `Usage:
  npm run admin -- --grant <email>
  npm run admin -- --revoke <email>
  npm run admin -- --list`;

async function findUser(db: ReturnType<typeof createServiceClient>, email: string) {
  for (let page = 1; ; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`could not list users: ${error.message}`);
    const user = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (user || data.users.length < 200) return user;
  }
}

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: { grant: { type: "string" }, revoke: { type: "string" }, list: { type: "boolean", default: false } },
  });
  const email = values.grant ?? values.revoke;
  if (!email && !values.list) {
    console.log(usage);
    return 1;
  }
  loadLocalEnv();
  const db = createServiceClient();

  if (values.list) {
    const { data, error } = await db.auth.admin.listUsers({ perPage: 1000 });
    if (error) throw new Error(`could not list users: ${error.message}`);
    const admins = data.users.filter((u) => u.app_metadata?.role === "admin");
    console.log(admins.length ? admins.map((u) => u.email).join("\n") : "no admins");
    return 0;
  }

  const user = await findUser(db, email!);
  if (!user) {
    console.error(`no user with email ${email}; create one in the Supabase dashboard (Authentication → Users) first`);
    return 1;
  }
  const app_metadata = { ...user.app_metadata };
  if (values.grant) app_metadata.role = "admin";
  else delete app_metadata.role;
  const { error } = await db.auth.admin.updateUserById(user.id, { app_metadata });
  if (error) throw new Error(`could not update ${email}: ${error.message}`);
  console.log(`${email}: admin ${values.grant ? "granted" : "revoked"}. The change applies at their next sign-in or token refresh.`);
  return 0;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  },
);
