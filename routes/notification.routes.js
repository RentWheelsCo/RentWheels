import express from "express";
import { authMiddleware } from "../middlewares/auth.middleware.js";
import {
    getMyNotifications,
    markNotificationRead,
    markAllNotificationsRead,
} from "../controller/notification.controller.js";

const router = express.Router();

router.get("/", authMiddleware, getMyNotifications);
router.patch("/read-all", authMiddleware, markAllNotificationsRead);
router.patch("/:id/read", authMiddleware, markNotificationRead);

export default router;
