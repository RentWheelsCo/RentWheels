import express from "express";
import {
    createVehicle,
    getVehicles,
    getVehicleOptions,
    createVehicleOption,
    updateVehicleOption,
    deactivateVehicleOption,
} from "../controller/vehicle.controller.js";
import { authMiddleware, authorizeRoles } from "../middlewares/auth.middleware.js";
import { uploadVehiclePhotos } from "../middlewares/upload.middleware.js";

const router = express.Router();

router.get("/", getVehicles);
router.post("/", authMiddleware, uploadVehiclePhotos, createVehicle);
router.get("/options", getVehicleOptions);
router.post("/options", authMiddleware, authorizeRoles("admin"), createVehicleOption);
router.patch("/options/:id", authMiddleware, authorizeRoles("admin"), updateVehicleOption);
router.delete("/options/:id", authMiddleware, authorizeRoles("admin"), deactivateVehicleOption);

export default router;
