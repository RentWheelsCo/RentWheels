import express from "express";
import { authMiddleware } from "../middlewares/auth.middleware.js";
import {
    createPaymentSession,
    handleStripeWebhook,
    getMyBookings,
    getMyVehiclesAvailability,
    getBookingsForMyListings,
    getBookingById,
    cancelBooking,
    returnBooking,
} from "../controller/booking.controller.js";

const router = express.Router();

// Payment flow
router.post("/checkout", authMiddleware, createPaymentSession);

// Stripe webhook
router.post("/webhook", express.raw({ type: "application/json" }), handleStripeWebhook);

router.get("/as-owner", authMiddleware, getBookingsForMyListings);
router.get("/my", authMiddleware, getMyBookings);
router.get("/:id", authMiddleware, getBookingById);
router.post("/:id/cancel", authMiddleware, cancelBooking);
router.post("/:id/return", authMiddleware, returnBooking);
router.get("/my-vehicles", authMiddleware, getMyVehiclesAvailability);

export default router;

