import express from "express";
import {
    createVehicle,
    getVehicles,
    getVehicleOwnerContact,
    getVehicleById,
    getMyVehicles,
    updateVehicle,
    deleteVehicle,
    getVehicleOptions,
    createVehicleOption,
    updateVehicleOption,
    deactivateVehicleOption,
} from "../controller/vehicle.controller.js";
import { authMiddleware, authorizeRoles } from "../middlewares/auth.middleware.js";
import { uploadVehiclePhotos } from "../middlewares/upload.middleware.js";

const router = express.Router();

router.get("/", getVehicles);
router.get("/my", authMiddleware, getMyVehicles);
router.get("/options", getVehicleOptions);
router.post("/options", authMiddleware, authorizeRoles("admin"), createVehicleOption);
router.patch("/options/:id", authMiddleware, authorizeRoles("admin"), updateVehicleOption);
router.delete("/options/:id", authMiddleware, authorizeRoles("admin"), deactivateVehicleOption);
router.get("/:id/contact", authMiddleware, getVehicleOwnerContact);
router.get("/:id", getVehicleById);
router.post("/", authMiddleware, uploadVehiclePhotos, createVehicle);
router.patch("/:id", authMiddleware, updateVehicle);
router.delete("/:id", authMiddleware, deleteVehicle);

export default router;
