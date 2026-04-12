import express from "express";
import { authMiddleware } from "../middlewares/auth.middleware.js";
import {
    createBooking,
    getMyBookings,
    getMyVehiclesAvailability,
    getBookingsForMyListings,
} from "../controller/booking.controller.js";

const router = express.Router();

router.post("/", authMiddleware, createBooking);
router.get("/as-owner", authMiddleware, getBookingsForMyListings);
router.get("/my", authMiddleware, getMyBookings);
router.get("/my-vehicles", authMiddleware, getMyVehiclesAvailability);

export default router;

