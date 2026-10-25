import { createHash, randomBytes } from "node:crypto";
import { db, usersTable, userCompaniesTable, auditLogsTable } from "@workspace/db";
import { sql } from "drizzle-orm";
import { FinancialRequestError } from "./financial-transaction";
import { lockApprovalAuthorityWrite } from "./approval-authority";
import { teamRows, teamWrite, teamPeople, teamAudit, teamOwner, teamPolicy, previewTeamPerson } from "./team-store";
import { hashAccountPassword, newAccountPasswordError, verifyAccountPassword } from "./account-password";
import type { DbOrTx } from "./journal-posting";

const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");
function manualDevelopmentOnly() {
  if (process.env.NODE_ENV === "production") throw new FinancialRequestError("قناة تسليم الدعوات الموثوقة لم تجهز؛ التفعيل اليدوي تطويري فقط", 503);
}
export async function issueTeamInvitation(companyId: number, actorId: number, personId: number, revision: number) {
  manualDevelopmentOnly();
  return teamWrite(companyId, actorId, async tx => {
    const [person] = await teamPeople(companyId, tx, personId);
    if (!person || person.revision !== revision) throw new FinancialRequestError("السجل غير متاح أو تغير؛ أعد تحميله", 409);
    if (person.status !== "pending" || !person.email || person.userId) {
      throw new FinancialRequestError("التفعيل بالبريد لحساب معلق غير مربوط بهوية فقط؛ POS بلا بريد يحتاج جهازًا موثوقًا", 409);
    }
    await previewTeamPerson(companyId, person, tx, personId);
    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
    await tx.execute(sql`UPDATE team_invitations SET revoked_at=now() WHERE company_id=${companyId}
      AND employee_id=${personId} AND used_at IS NULL AND revoked_at IS NULL`);
    await tx.execute(sql`INSERT INTO team_invitations(company_id,employee_id,revision,token_hash,recipient_email,expires_at,created_by)
      VALUES(${companyId},${personId},${revision},${tokenHash(token)},${person.email},${expiresAt.toISOString()},${actorId})`);
    await teamAudit(tx, companyId, actorId, "team.invitation.issue", { personId, revision, expiresAt, deliveryMode: "manual-development" });
    return { activationToken: token, expiresAt: expiresAt.toISOString(), deliveryMode: "manual-development" };
  });
}
type Invitation = { id: number; company_id: number; employee_id: number; revision: number;
  recipient_email: string; created_by: number; name: string; companyName: string };
async function validInvitation(token: string, connection: DbOrTx = db) {
  const [invite] = await teamRows<Invitation>(connection, sql`
    SELECT i.id,i.company_id,i.employee_id,i.revision,i.recipient_email,i.created_by,
      e.name_ar AS name,c.name AS "companyName"
    FROM team_invitations i JOIN employee_access a ON a.employee_id=i.employee_id AND a.company_id=i.company_id
    JOIN employees e ON e.id=a.employee_id AND e.company_id=a.company_id
    JOIN companies c ON c.id=i.company_id AND c.is_active
    WHERE i.token_hash=${tokenHash(token)} AND i.used_at IS NULL AND i.revoked_at IS NULL AND i.expires_at>clock_timestamp()
      AND a.status='pending' AND a.user_id IS NULL AND a.revision=i.revision AND lower(e.email)=i.recipient_email`);
  if (!invite) throw new FinancialRequestError("الدعوة غير متاحة أو انتهت أو تغيرت صلاحياتها", 409);
  return invite;
}
export async function inspectTeamInvitation(token: string) {
  manualDevelopmentOnly();
  const invite = await validInvitation(token);
  await teamOwner(invite.company_id, invite.created_by);
  return { name: invite.name, email: invite.recipient_email, companyName: invite.companyName };
}
export async function acceptTeamInvitation(token: string, password: string, authenticatedUserId?: number) {
  manualDevelopmentOnly();
  // Locator only; every claim, authority, revision and email is re-read
  // under the same writer fence/company lock as person management.
  const locator = await validInvitation(token);
  const newHash = !newAccountPasswordError(password) ? await hashAccountPassword(password) : null;
  return db.transaction(async tx => {
    await lockApprovalAuthorityWrite(tx);
    await tx.execute(sql`SELECT id FROM companies WHERE id=${locator.company_id} FOR UPDATE`);
    const invite = await validInvitation(token, tx);
    await teamOwner(invite.company_id, invite.created_by, tx);
    const [person] = await teamPeople(invite.company_id, tx, invite.employee_id);
    await previewTeamPerson(invite.company_id, person, tx, person.personId);
    const policy = await teamPolicy(invite.company_id, tx);
    if (policy.seatLimit != null && policy.activeLoginSeats >= policy.seatLimit) {
      throw new FinancialRequestError("لا يتاح مقعد دخول جديد ضمن الحد المهيأ؛ لم يفعّل الحساب", 409);
    }
    const identities = await teamRows<{ id: number; name: string; password_hash: string | null; is_active: boolean; has_2fa: boolean }>(tx,
      sql`SELECT id,name,password_hash,is_active,has_2fa FROM users WHERE lower(email)=${invite.recipient_email} FOR UPDATE`);
    if (identities.length > 1) throw new FinancialRequestError("تحتاج الهوية مراجعة آمنة؛ لن تدمج حسابات تلقائيًا", 409);
    let identity = identities[0];
    if (identity) {
      if (authenticatedUserId !== identity.id) throw new FinancialRequestError("للهوية الموجودة: سجل الدخول المعتاد بالحساب نفسه ثم أعد فتح الدعوة؛ لا تستبدل كلمة مرورك", 403);
      // The public route's account epoch/challenge gate already requires a
      // fully verified identity. Legacy has_2fa is not enrollment evidence.
      if (!identity.is_active || !identity.password_hash || !await verifyAccountPassword(password, identity.password_hash)) {
        throw new FinancialRequestError("تعذر التفعيل بهذه البيانات", 403);
      }
      const memberships = await teamRows(tx, sql`SELECT id FROM user_companies WHERE user_id=${identity.id} AND company_id=${invite.company_id}`);
      if (memberships.length) throw new FinancialRequestError("الحساب عضو في هذه الشركة بالفعل؛ لا يستبدل دوره أو آخر مالك بالتفعيل", 409);
    } else {
      if (!newHash) throw new FinancialRequestError(newAccountPasswordError(password)!, 400);
      const [created] = await tx.insert(usersTable).values({
        name: person.name, email: invite.recipient_email, passwordHash: newHash, role: "scoped", isActive: true,
      }).returning({ id: usersTable.id, name: usersTable.name });
      identity = { ...created, password_hash: newHash, is_active: true, has_2fa: false };
    }
    await tx.insert(userCompaniesTable).values({ companyId: invite.company_id, userId: identity.id, role: "scoped" });
    await tx.execute(sql`UPDATE employees SET user_id=${identity.id} WHERE id=${person.personId} AND company_id=${invite.company_id}`);
    await tx.execute(sql`UPDATE employee_access SET user_id=${identity.id},status='active',revision=revision+1,updated_at=now()
      WHERE employee_id=${person.personId} AND company_id=${invite.company_id}`);
    await tx.execute(sql`UPDATE team_invitations SET used_at=now() WHERE id=${invite.id}`);
    await tx.insert(auditLogsTable).values({ companyId: invite.company_id, userId: identity.id, userName: identity.name,
      entity: "employee_access", action: "team.invitation.accept", details: JSON.stringify({ personId: person.personId, invitationId: invite.id }) });
    return { ok: true, email: invite.recipient_email };
  });
}
