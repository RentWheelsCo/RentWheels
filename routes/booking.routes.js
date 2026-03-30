import express from "express";
import { authMiddleware } from "../middlewares/auth.middleware.js";
import { createBooking, getMyBookings, getMyVehiclesAvailability } from "../controller/booking.controller.js";

const router = express.Router();

router.post("/", authMiddleware, createBooking);
router.get("/my", authMiddleware, getMyBookings);
router.get("/my-vehicles", authMiddleware, getMyVehiclesAvailability);

export default router;

