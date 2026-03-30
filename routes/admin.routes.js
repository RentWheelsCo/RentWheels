import express from "express";
import { authMiddleware, authorizeRoles } from "../middlewares/auth.middleware.js";
import { getAdminDashboard } from "../controller/admin.controller.js";

const router = express.Router();

router.get("/dashboard", authMiddleware, authorizeRoles("admin"), getAdminDashboard);

export default router;

