import { z } from "zod";
import { withServerTiming } from "@/lib/api";
import { ApiErrorSchema, ContextRequestSchema, PassageContextResponseSchema, PassageContextSchema } from "@/lib/context-schema";

// GET /api/v1/schema: JSON Schema generated from the same Zod schemas the server
// validates with, so native clients can generate their types instead of copying them.
//   ContextRequest          body of POST /api/v1/context
//   PassageContextResponse  its 200 response: unit, selection, ai, data
//   PassageContext          the AI part alone (response.ai)
//   ApiError                every error response; see docs/api.md for the codes

export const GET = withServerTiming(() =>
  Response.json({
    ContextRequest: z.toJSONSchema(ContextRequestSchema),
    PassageContextResponse: z.toJSONSchema(PassageContextResponseSchema),
    PassageContext: z.toJSONSchema(PassageContextSchema),
    ApiError: z.toJSONSchema(ApiErrorSchema),
  }),
);
