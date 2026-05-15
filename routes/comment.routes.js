import express from "express";
import {
    createComment,
    replyToComment,
    getVehicleComments,
    likeComment,
    unlikeComment,
    updateComment,
    deleteComment,
} from "../controller/comment.controller.js";
import { authMiddleware } from "../middlewares/auth.middleware.js";

const router = express.Router();

router.get("/vehicle/:vehicleId", getVehicleComments);
router.post("/", authMiddleware, createComment);
router.patch("/:id", authMiddleware, updateComment);
router.delete("/:id", authMiddleware, deleteComment);
router.post("/:id/reply", authMiddleware, replyToComment);
router.post("/:id/like", authMiddleware, likeComment);
router.delete("/:id/like", authMiddleware, unlikeComment);

export default router;
