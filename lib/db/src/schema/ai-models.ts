import { pgTable, serial, text, timestamp, jsonb, real, integer } from "drizzle-orm/pg-core";

export const aiModelsTable = pgTable("ai_models", {
  id: serial("id").primaryKey(),
  key: text("key").notNull().unique(),
  name: text("name").notNull(),
  description: text("description"),
  category: text("category").notNull().default("general"),
  status: text("status").notNull().default("idle"),
  accuracy: real("accuracy"),
  trainingSize: integer("training_size"),
  parameters: jsonb("parameters").$type<Record<string, unknown>>(),
  lastTrainedAt: timestamp("last_trained_at"),
  lastError: text("last_error"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type AIModel = typeof aiModelsTable.$inferSelect;
