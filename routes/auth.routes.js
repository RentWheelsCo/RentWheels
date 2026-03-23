import express from "express";
import { register, login, getProfile } from "../controller/auth.controller.js";
import { authMiddleware } from "../middlewares/auth.middleware.js";
import { uploadFields } from "../middlewares/upload.middleware.js";

const router = express.Router();

router.post("/register", uploadFields, register);
router.post("/login", login);

router.get("/profile", authMiddleware, getProfile);

export default router;
