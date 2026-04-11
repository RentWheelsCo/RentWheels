import express from "express";
import { authMiddleware, authorizeRoles } from "../middlewares/auth.middleware.js";
import { adminGetAllBookings, adminGetBookingById, adminGetAllVehicles } from "../controller/adminView.controller.js";

const router = express.Router();

router.use(authMiddleware, authorizeRoles("admin"));

router.get("/bookings", adminGetAllBookings);
router.get("/bookings/:id", adminGetBookingById);
router.get("/vehicles", adminGetAllVehicles);

export default router;
