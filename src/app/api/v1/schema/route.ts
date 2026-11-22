import { z } from "zod";
import { withServerTiming } from "@/lib/api";
import { ContextRequestSchema, PassageContextSchema } from "@/lib/context-schema";

// GET /api/v1/schema: JSON Schema generated from the same Zod schemas the server
// validates with, so native clients can generate their types instead of copying them.

export const GET = withServerTiming(() =>
  Response.json({
    ContextRequest: z.toJSONSchema(ContextRequestSchema),
    PassageContext: z.toJSONSchema(PassageContextSchema),
  }),
);
