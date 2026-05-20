import prisma from "../utils/db.js";
import { StatusCodes } from "http-status-codes";
import {
    createCommentSchema,
    replyCommentSchema,
    listCommentsSchema,
    updateCommentSchema,
} from "../validations/comment.validation.js";
import { notifyUser } from "../utils/notification.js";

/**
 * Comment Controller
 * Handles creation, retrieval, and interaction (like/reply) for comments.
 */

const selectUser = {
    id: true,
    name: true,
    profilePhoto: true,
};

const serializeComment = (comment) => ({
    id: comment.id,
    content: comment.content,
    image: comment.image || null,
    createdAt: comment.createdAt,
    updatedAt: comment.updatedAt,
    user: comment.user,
    likeCount: comment._count?.likes ?? 0,
    replyCount: comment._count?.replies ?? 0,
    parentId: comment.parentId || null,
});

export const createComment = async (req, res, next) => {
    try {
        const parsed = createCommentSchema.parse(req.body);
        const content = String(parsed.content || "").trim();
        const image = req.file?.path ? String(req.file.path) : null;

        if (!content && !image) {
            return res.status(StatusCodes.BAD_REQUEST).json({
                success: false,
                status: StatusCodes.BAD_REQUEST,
                message: "Comment text or image is required.",
            });
        }

        const vehicle = await prisma.vehicle.findUnique({
            where: { id: parsed.vehicleId },
            select: {
                id: true,
                ownerId: true,
                owner: { select: { email: true, name: true } },
            },
        });
        if (!vehicle) {
            return res.status(StatusCodes.NOT_FOUND).json({
                success: false,
                status: StatusCodes.NOT_FOUND,
                message: "Vehicle not found.",
            });
        }

        if (parsed.parentId) {
            // Ensure parent comment belongs to the same vehicle.
            const parent = await prisma.comment.findUnique({
                where: { id: parsed.parentId },
                select: { id: true, vehicleId: true },
            });
            if (!parent) {
                return res.status(StatusCodes.NOT_FOUND).json({
                    success: false,
                    status: StatusCodes.NOT_FOUND,
                    message: "Parent comment not found.",
                });
            }
            if (parent.vehicleId !== parsed.vehicleId) {
                return res.status(StatusCodes.BAD_REQUEST).json({
                    success: false,
                    status: StatusCodes.BAD_REQUEST,
                    message: "Parent comment does not belong to this vehicle.",
                });
            }
        }

        const comment = await prisma.comment.create({
            data: {
                vehicleId: parsed.vehicleId,
                userId: req.user.id,
                parentId: parsed.parentId || null,
                content,
                image,
            },
            include: {
                user: { select: selectUser },
                _count: { select: { likes: true, replies: true } },
            },
        });

        // Notify vehicle owner
        if (vehicle.ownerId !== req.user.id) {
            try {
                await notifyUser({
                    userId: vehicle.ownerId,
                    type: "COMMENT_CREATED",
                    title: "New comment on your vehicle",
                    message: `${comment.user?.name || "Someone"} commented on your vehicle.`,
                    email: vehicle.owner?.email || null,
                });
            } catch (notifyError) {
                console.error("Failed to send comment notification:", notifyError?.message || notifyError);
            }
        }

        return res.status(StatusCodes.CREATED).json({
            success: true,
            status: StatusCodes.CREATED,
            message: "Comment created successfully.",
            data: serializeComment(comment),
        });
    } catch (error) {
        next(error);
    }
};

export const replyToComment = async (req, res, next) => {
    try {
        const parentId = Number(req.params.id);
        if (!Number.isInteger(parentId) || parentId <= 0) {
            return res.status(StatusCodes.BAD_REQUEST).json({
                success: false,
                status: StatusCodes.BAD_REQUEST,
                message: "Invalid comment id.",
            });
        }

        const parsed = replyCommentSchema.parse(req.body);

        const parent = await prisma.comment.findUnique({
            where: { id: parentId },
            select: { id: true, vehicleId: true, userId: true },
        });
        if (!parent) {
            return res.status(StatusCodes.NOT_FOUND).json({
                success: false,
                status: StatusCodes.NOT_FOUND,
                message: "Parent comment not found.",
            });
        }

        const reply = await prisma.comment.create({
            data: {
                vehicleId: parent.vehicleId,
                userId: req.user.id,
                parentId: parent.id,
                content: parsed.content,
            },
            include: {
                user: { select: selectUser },
                _count: { select: { likes: true, replies: true } },
            },
        });

        // Notify original commenter
        if (parent.userId !== req.user.id) {
            try {
                await notifyUser({
                    userId: parent.userId,
                    type: "COMMENT_REPLY",
                    title: "New reply to your comment",
                    message: `${reply.user?.name || "Someone"} replied to your comment.`,
                });
            } catch (notifyError) {
                console.error("Failed to send reply notification:", notifyError?.message || notifyError);
            }
        }

        return res.status(StatusCodes.CREATED).json({
            success: true,
            status: StatusCodes.CREATED,
            message: "Reply created successfully.",
            data: serializeComment(reply),
        });
    } catch (error) {
        next(error);
    }
};

export const getVehicleComments = async (req, res, next) => {
    try {
        const vehicleId = Number(req.params.vehicleId);
        if (!Number.isInteger(vehicleId) || vehicleId <= 0) {
            return res.status(StatusCodes.BAD_REQUEST).json({
                success: false,
                status: StatusCodes.BAD_REQUEST,
                message: "Invalid vehicle id.",
            });
        }

        const parsed = listCommentsSchema.parse(req.query);
        const page = parsed.page || 1;
        const pageSize = parsed.pageSize || 10;
        const skip = (page - 1) * pageSize;

        const [total, comments] = await Promise.all([
            prisma.comment.count({
                where: { vehicleId, parentId: null },
            }),
            prisma.comment.findMany({
                where: { vehicleId, parentId: null },
                orderBy: { createdAt: "desc" },
                skip,
                take: pageSize,
                include: {
                    user: { select: selectUser },
                    _count: { select: { likes: true, replies: true } },
                    replies: {
                        orderBy: { createdAt: "asc" },
                        include: {
                            user: { select: selectUser },
                            _count: { select: { likes: true, replies: true } },
                        },
                    },
                },
            }),
        ]);

        const data = comments.map((comment) => ({
            ...serializeComment(comment),
            replies: comment.replies.map(serializeComment),
        }));

        return res.status(StatusCodes.OK).json({
            success: true,
            status: StatusCodes.OK,
            data: {
                vehicleId,
                page,
                pageSize,
                total,
                comments: data,
            },
        });
    } catch (error) {
        next(error);
    }
};

export const likeComment = async (req, res, next) => {
    try {
        const commentId = Number(req.params.id);
        if (!Number.isInteger(commentId) || commentId <= 0) {
            return res.status(StatusCodes.BAD_REQUEST).json({
                success: false,
                status: StatusCodes.BAD_REQUEST,
                message: "Invalid comment id.",
            });
        }

        const comment = await prisma.comment.findUnique({
            where: { id: commentId },
            select: { id: true, userId: true },
        });
        if (!comment) {
            return res.status(StatusCodes.NOT_FOUND).json({
                success: false,
                status: StatusCodes.NOT_FOUND,
                message: "Comment not found.",
            });
        }

        const existing = await prisma.commentLike.findUnique({
            where: {
                commentId_userId: {
                    commentId,
                    userId: req.user.id,
                },
            },
        });

        if (existing) {
            return res.status(StatusCodes.OK).json({
                success: true,
                status: StatusCodes.OK,
                message: "Comment already liked.",
            });
        }

        await prisma.commentLike.create({
            data: {
                commentId,
                userId: req.user.id,
            },
        });

        // Notify comment owner
        if (comment.userId !== req.user.id) {
            try {
                await notifyUser({
                    userId: comment.userId,
                    type: "COMMENT_LIKED",
                    title: "Your comment got a like",
                    message: "Someone liked your comment.",
                });
            } catch (notifyError) {
                console.error("Failed to send like notification:", notifyError?.message || notifyError);
            }
        }

        return res.status(StatusCodes.OK).json({
            success: true,
            status: StatusCodes.OK,
            message: "Comment liked successfully.",
        });
    } catch (error) {
        next(error);
    }
};

export const unlikeComment = async (req, res, next) => {
    try {
        const commentId = Number(req.params.id);
        if (!Number.isInteger(commentId) || commentId <= 0) {
            return res.status(StatusCodes.BAD_REQUEST).json({
                success: false,
                status: StatusCodes.BAD_REQUEST,
                message: "Invalid comment id.",
            });
        }

        const existing = await prisma.commentLike.findUnique({
            where: {
                commentId_userId: {
                    commentId,
                    userId: req.user.id,
                },
            },
        });

        if (!existing) {
            return res.status(StatusCodes.OK).json({
                success: true,
                status: StatusCodes.OK,
                message: "Comment was not liked.",
            });
        }

        await prisma.commentLike.delete({
            where: { id: existing.id },
        });

        return res.status(StatusCodes.OK).json({
            success: true,
            status: StatusCodes.OK,
            message: "Comment unliked successfully.",
        });
    } catch (error) {
        next(error);
    }
};

export const updateComment = async (req, res, next) => {
    try {
        const id = Number(req.params.id);
        if (!Number.isInteger(id) || id <= 0) {
            return res.status(StatusCodes.BAD_REQUEST).json({
                success: false,
                status: StatusCodes.BAD_REQUEST,
                message: "Invalid comment id.",
            });
        }

        const parsed = updateCommentSchema.parse(req.body);

        const existing = await prisma.comment.findUnique({
            where: { id },
            select: { id: true, userId: true, vehicleId: true },
        });
        if (!existing) {
            return res.status(StatusCodes.NOT_FOUND).json({
                success: false,
                status: StatusCodes.NOT_FOUND,
                message: "Comment not found.",
            });
        }

        const canEdit =
            req.user?.role === "admin" || existing.userId === req.user?.id;
        if (!canEdit) {
            return res.status(StatusCodes.FORBIDDEN).json({
                success: false,
                status: StatusCodes.FORBIDDEN,
                message: "You can only edit your own comment.",
            });
        }

        const updated = await prisma.comment.update({
            where: { id },
            data: { content: parsed.content },
            include: {
                user: { select: selectUser },
                _count: { select: { likes: true, replies: true } },
            },
        });

        return res.status(StatusCodes.OK).json({
            success: true,
            status: StatusCodes.OK,
            message: "Comment updated successfully.",
            data: serializeComment(updated),
        });
    } catch (error) {
        next(error);
    }
};

export const deleteComment = async (req, res, next) => {
    try {
        const id = Number(req.params.id);
        if (!Number.isInteger(id) || id <= 0) {
            return res.status(StatusCodes.BAD_REQUEST).json({
                success: false,
                status: StatusCodes.BAD_REQUEST,
                message: "Invalid comment id.",
            });
        }

        const existing = await prisma.comment.findUnique({
            where: { id },
            select: { id: true, userId: true },
        });
        if (!existing) {
            return res.status(StatusCodes.NOT_FOUND).json({
                success: false,
                status: StatusCodes.NOT_FOUND,
                message: "Comment not found.",
            });
        }

        const canDelete =
            req.user?.role === "admin" || existing.userId === req.user?.id;
        if (!canDelete) {
            return res.status(StatusCodes.FORBIDDEN).json({
                success: false,
                status: StatusCodes.FORBIDDEN,
                message: "You can only delete your own comment.",
            });
        }

        await prisma.comment.delete({ where: { id } });

        return res.status(StatusCodes.OK).json({
            success: true,
            status: StatusCodes.OK,
            message: "Comment deleted successfully.",
        });
    } catch (error) {
        next(error);
    }
};
