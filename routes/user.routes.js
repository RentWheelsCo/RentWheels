import express from "express";
import { authMiddleware } from "../middlewares/auth.middleware.js";
import { getSellerDashboard } from "../controller/seller.controller.js";
import { getBuyerDashboard } from "../controller/buyer.controller.js";

const router = express.Router();

router.get("/buyer/dashboard", authMiddleware, getBuyerDashboard);
router.get("/seller/dashboard", authMiddleware, getSellerDashboard);

export default router;

