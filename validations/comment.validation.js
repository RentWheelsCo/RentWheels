import { z } from "zod";

export const createCommentSchema = z.object({
    vehicleId: z.coerce.number().int().positive(),
    content: z.string().trim().max(1000).optional(),
    parentId: z.coerce.number().int().positive().optional(),
});

export const replyCommentSchema = z.object({
    content: z.string().trim().min(1).max(1000),
});

export const listCommentsSchema = z.object({
    page: z.coerce.number().int().positive().optional(),
    pageSize: z.coerce.number().int().positive().max(100).optional(),
});

export const updateCommentSchema = z.object({
    content: z.string().trim().min(1).max(1000),
});
