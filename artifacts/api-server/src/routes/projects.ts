import { Router } from "express";
import { db, projectsTable, projectTasksTable, customersTable } from "@workspace/db";
import { desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { adminGuard } from "../middlewares/require-role";
import { handleRouteError } from "../lib/handle-error";

const router = Router();

// Projects: any authenticated user can read. Only owner + manager can mutate.
const projWriteGuard = adminGuard;

const IdParam = z.object({ id: z.coerce.number().int().positive() });

const serializeProject = (p: typeof projectsTable.$inferSelect & { customerName?: string | null }) => ({
  ...p,
  budget: Number(p.budget),
  spent: Number(p.spent),
  startDate: p.startDate,
  dueDate: p.dueDate,
  createdAt: p.createdAt.toISOString(),
});

router.get("/projects", async (req, res) => {
  try {
    const rows = await db
      .select({
        id: projectsTable.id,
        name: projectsTable.name,
        code: projectsTable.code,
        customerId: projectsTable.customerId,
        customerName: customersTable.name,
        managerId: projectsTable.managerId,
        status: projectsTable.status,
        priority: projectsTable.priority,
        budget: projectsTable.budget,
        spent: projectsTable.spent,
        progress: projectsTable.progress,
        startDate: projectsTable.startDate,
        dueDate: projectsTable.dueDate,
        description: projectsTable.description,
        createdAt: projectsTable.createdAt,
      })
      .from(projectsTable)
      .leftJoin(customersTable, eq(customersTable.id, projectsTable.customerId))
      .orderBy(desc(projectsTable.createdAt));
    res.json(
      rows.map((r) => ({
        ...r,
        budget: Number(r.budget),
        spent: Number(r.spent),
        createdAt: r.createdAt.toISOString(),
      }))
    );
  } catch (err) {
    req.log.error({ err }, "projects GET");
    res.status(500).json({ error: "Internal server error" });
  }
});

const CreateProjectBody = z.object({
  name: z.string().min(2),
  code: z.string().optional(),
  customerId: z.number().int().optional(),
  managerId: z.number().int().optional(),
  status: z.enum(["planning", "active", "on_hold", "completed", "cancelled"]).optional(),
  priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
  budget: z.number().nonnegative().optional(),
  startDate: z.string().optional(),
  dueDate: z.string().optional(),
  description: z.string().optional(),
});

router.post("/projects", projWriteGuard, async (req, res) => {
  try {
    const body = CreateProjectBody.parse(req.body);
    const [row] = await db
      .insert(projectsTable)
      .values({
        name: body.name,
        code: body.code ?? null,
        customerId: body.customerId ?? null,
        managerId: body.managerId ?? null,
        status: body.status ?? "planning",
        priority: body.priority ?? "medium",
        budget: String(body.budget ?? 0),
        startDate: body.startDate ?? null,
        dueDate: body.dueDate ?? null,
        description: body.description ?? null,
      })
      .returning();
    res.status(201).json(serializeProject(row));
  } catch (err) {
    req.log.error({ err }, "projects POST");
    handleRouteError(err, res);
  }
});

router.get("/projects/:id/tasks", async (req, res) => {
  try {
    const { id } = IdParam.parse(req.params);
    const rows = await db
      .select()
      .from(projectTasksTable)
      .where(eq(projectTasksTable.projectId, id))
      .orderBy(desc(projectTasksTable.createdAt));
    res.json(
      rows.map((r) => ({
        ...r,
        completedAt: r.completedAt?.toISOString() ?? null,
        createdAt: r.createdAt.toISOString(),
      }))
    );
  } catch (err) {
    req.log.error({ err }, "projects/:id/tasks");
    handleRouteError(err, res);
  }
});

const CreateTaskBody = z.object({
  title: z.string().min(2),
  description: z.string().optional(),
  assigneeId: z.number().int().optional(),
  status: z.enum(["todo", "in_progress", "review", "done"]).optional(),
  priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
  dueDate: z.string().optional(),
});

router.post("/projects/:id/tasks", projWriteGuard, async (req, res) => {
  try {
    const { id: projectId } = IdParam.parse(req.params);
    const body = CreateTaskBody.parse(req.body);
    const [row] = await db
      .insert(projectTasksTable)
      .values({
        projectId,
        title: body.title,
        description: body.description ?? null,
        assigneeId: body.assigneeId ?? null,
        status: body.status ?? "todo",
        priority: body.priority ?? "medium",
        dueDate: body.dueDate ?? null,
      })
      .returning();
    res.status(201).json({
      ...row,
      completedAt: row.completedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    });
  } catch (err) {
    req.log.error({ err }, "projects/:id/tasks POST");
    handleRouteError(err, res);
  }
});

router.get("/projects/summary", async (req, res) => {
  try {
    const [{ total }] = await db
      .select({ total: sql<number>`count(*)::int` })
      .from(projectsTable);
    const [{ active }] = await db
      .select({ active: sql<number>`count(*) filter (where ${projectsTable.status} = 'active')::int` })
      .from(projectsTable);
    const [{ totalBudget }] = await db
      .select({ totalBudget: sql<number>`coalesce(sum(${projectsTable.budget}), 0)::numeric` })
      .from(projectsTable);
    const [{ totalSpent }] = await db
      .select({ totalSpent: sql<number>`coalesce(sum(${projectsTable.spent}), 0)::numeric` })
      .from(projectsTable);
    res.json({
      totalProjects: total,
      activeProjects: active,
      totalBudget: Number(totalBudget),
      totalSpent: Number(totalSpent),
    });
  } catch (err) {
    req.log.error({ err }, "projects/summary");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
