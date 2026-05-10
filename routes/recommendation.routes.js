import express from "express";
import { authMiddleware } from "../middlewares/auth.middleware.js";
import { getVehicleRecommendations } from "../controller/recommendation.controller.js";

const router = express.Router();

router.get("/vehicles", authMiddleware, getVehicleRecommendations);

export default router;

