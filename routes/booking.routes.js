import express from "express";
import { authMiddleware } from "../middlewares/auth.middleware.js";
import {
    createPaymentSession,
    handleStripeWebhook,
    getMyBookings,
    getMyVehiclesAvailability,
    getBookingsForMyListings,
} from "../controller/booking.controller.js";

const router = express.Router();

// Payment flow
router.post("/checkout", authMiddleware, createPaymentSession);

// Stripe webhook (no auth)
router.post("/webhook", express.raw({ type: "application/json" }), handleStripeWebhook);

// Existing routes
router.get("/as-owner", authMiddleware, getBookingsForMyListings);
router.get("/my", authMiddleware, getMyBookings);
router.get("/my-vehicles", authMiddleware, getMyVehiclesAvailability);

// Legacy / deprecated
router.post("/", authMiddleware, (req, res) => {
    res.status(405).json({ message: "Use POST /booking/checkout for payments" });
});

export default router;

