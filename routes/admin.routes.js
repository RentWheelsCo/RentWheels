import express from "express";
import { authMiddleware, authorizeRoles } from "../middlewares/auth.middleware.js";
import { adminGetAllBookings, adminGetBookingById, adminGetAllVehicles, adminGetVehicleById } from "../controller/adminView.controller.js";
import { cancelBooking, returnBooking } from "../controller/booking.controller.js";

const router = express.Router();

router.use(authMiddleware, authorizeRoles("admin"));

router.get("/bookings", adminGetAllBookings);
router.get("/bookings/:id", adminGetBookingById);
router.post("/bookings/:id/cancel", cancelBooking);
router.post("/bookings/:id/return", returnBooking);
router.get("/vehicles", adminGetAllVehicles);
router.get("/vehicles/:id", adminGetVehicleById);

export default router;
