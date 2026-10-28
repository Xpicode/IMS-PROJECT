import { json, readJson, route } from "@/lib/api/route";
import { createUser, listUsers } from "@/lib/users/service";
import type { CreateUserInput } from "@/lib/validation";

export const GET = route({ auth: true }, async ({ user }) => json({ data: await listUsers(user) }));

export const POST = route({ auth: true }, async ({ req, user, ctx }) =>
  json(await createUser(user, (await readJson(req)) as CreateUserInput, ctx), 201),
);
