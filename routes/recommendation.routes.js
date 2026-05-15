import express from "express";
import { optionalAuthMiddleware } from "../middlewares/auth.middleware.js";
import { getVehicleRecommendations } from "../controller/recommendation.controller.js";

const router = express.Router();

// Public endpoint: uses personalization when authenticated, otherwise returns generic recommendations.
router.get("/vehicles", optionalAuthMiddleware, getVehicleRecommendations);

export default router;
