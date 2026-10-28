import { NoAccess } from "@/components/common/no-access";
import { UsersList } from "@/components/admin/users-list";
import { pageAccess } from "@/lib/auth/page";
import { listUsers } from "@/lib/users/service";
import { listLocations } from "@/lib/locations/service";

export const metadata = { title: "Users" };

export default async function UsersPage() {
  const { user, allowed } = await pageAccess("settings.manage");
  if (!allowed) return <NoAccess what="Users" />;
  const [users, locations] = await Promise.all([listUsers(user), listLocations(user, { includeInactive: true })]);
  return (
    <UsersList
      meId={user.id}
      users={users}
      locations={locations.map((l) => ({ id: l.id, code: l.code, name: l.name, isActive: l.isActive }))}
    />
  );
}
