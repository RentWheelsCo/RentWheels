import express from "express";
import { register, login, logout, getProfile, googleLogin, forgotPassword, resetPassword, uploadUserDocuments, checkEmail } from "../controller/auth.controller.js";
import { adminCreateUser, adminUpdateUser, adminDeleteUser, adminGetAllUsers, adminGetUserById } from "../controller/admin.controller.js";
import { authMiddleware, authorizeRoles } from "../middlewares/auth.middleware.js";
import { uploadFields } from "../middlewares/upload.middleware.js";
import { validateGoogleLogin } from "../middlewares/validateGoogleLogin.middleware.js";

const router = express.Router();

router.post("/register", uploadFields, register);
router.post("/login", login);
router.post("/logout", logout);
router.post("/check-email", checkEmail);
router.post("/google", validateGoogleLogin, googleLogin);
router.post("/forgot-password", forgotPassword);
router.post("/reset-password", resetPassword);
router.patch("/documents", authMiddleware, uploadFields, uploadUserDocuments);
router.post("/admin/users", authMiddleware, authorizeRoles("admin"), adminCreateUser);
router.get("/admin/users", authMiddleware, authorizeRoles("admin"), adminGetAllUsers);
router.get("/admin/users/:id", authMiddleware, authorizeRoles("admin"), adminGetUserById);
router.patch("/admin/users/:id", authMiddleware, authorizeRoles("admin"), adminUpdateUser);
router.delete("/admin/users/:id", authMiddleware, authorizeRoles("admin"), adminDeleteUser);

router.get("/profile", authMiddleware, getProfile);

export default router;
