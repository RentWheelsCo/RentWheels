import prisma from "../utils/db.js";
import { StatusCodes } from "http-status-codes";
import { parsePositiveInt } from "../utils/pagination.js";

export const getMyNotifications = async (req, res, next) => {
    try {
        const page = parsePositiveInt(req.query.page, 1);
        const pageSize = Math.min(parsePositiveInt(req.query.pageSize, 20), 50);
        const skip = (page - 1) * pageSize;
        const unreadOnly = String(req.query.unreadOnly || "").toLowerCase() === "true";

        const where = {
            userId: req.user.id,
            ...(unreadOnly ? { isRead: false } : {}),
        };

        const [total, unreadCount, notifications] = await Promise.all([
            prisma.notification.count({ where }),
            prisma.notification.count({ where: { userId: req.user.id, isRead: false } }),
            prisma.notification.findMany({
                where,
                orderBy: { createdAt: "desc" },
                skip,
                take: pageSize,
            }),
        ]);

        return res.status(StatusCodes.OK).json({
            success: true,
            status: StatusCodes.OK,
            data: {
                page,
                pageSize,
                total,
                unreadCount,
                notifications,
            },
        });
    } catch (error) {
        next(error);
    }
};

export const markNotificationRead = async (req, res, next) => {
    try {
        const id = Number(req.params.id);
        if (!Number.isInteger(id) || id <= 0) {
            return res.status(StatusCodes.BAD_REQUEST).json({
                success: false,
                status: StatusCodes.BAD_REQUEST,
                message: "Invalid notification id.",
            });
        }

        const result = await prisma.notification.updateMany({
            where: {
                id,
                userId: req.user.id,
            },
            data: { isRead: true },
        });

        if (result.count === 0) {
            return res.status(StatusCodes.NOT_FOUND).json({
                success: false,
                status: StatusCodes.NOT_FOUND,
                message: "Notification not found.",
            });
        }

        return res.status(StatusCodes.OK).json({
            success: true,
            status: StatusCodes.OK,
            message: "Notification marked as read.",
        });
    } catch (error) {
        next(error);
    }
};

export const markAllNotificationsRead = async (req, res, next) => {
    try {
        await prisma.notification.updateMany({
            where: { userId: req.user.id, isRead: false },
            data: { isRead: true },
        });

        return res.status(StatusCodes.OK).json({
            success: true,
            status: StatusCodes.OK,
            message: "All notifications marked as read.",
        });
    } catch (error) {
        next(error);
    }
};
