import { z } from "zod";
import { ContextRequestSchema, PassageContextSchema } from "@/lib/context-schema";

// GET /api/v1/schema: JSON Schema generated from the same Zod schemas the server
// validates with, so native clients can generate their types instead of copying them.

export function GET() {
  return Response.json({
    ContextRequest: z.toJSONSchema(ContextRequestSchema),
    PassageContext: z.toJSONSchema(PassageContextSchema),
  });
}
