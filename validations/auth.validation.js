import { z } from "zod";

const passwordSchema = z
    .string()
    .min(6)
    .regex(/[A-Z]/, "Must include uppercase letter")
    .regex(/[0-9]/, "Must include a number");

export const registerSchema = z.object({
    name: z.string().min(2, "Name must be at least 2 characters"),

    email: z.string().email("Invalid email format"),

    password: passwordSchema,
    phone: z.string().trim().min(7).max(20),
});

export const loginSchema = z.object({
    email: z.string().email(),
    password: z.string().min(1, "Password required"),
});

export const forgotPasswordSchema = z.object({
    email: z.string().email("Invalid email format"),
});

export const resetPasswordSchema = z.object({
    // OTP-based reset (frontend flow)
    email: z.string().email("Invalid email format"),
    otp: z.string().trim().regex(/^\d{6}$/, "OTP must be a 6-digit code"),
    password: passwordSchema,
});

export const adminCreateUserSchema = z.object({
    name: z.string().min(2, "Name must be at least 2 characters"),
    email: z.string().email("Invalid email format"),
    password: passwordSchema,
    role: z.enum(["user", "admin"]).optional(),
    phone: z.string().trim().min(7).max(20).optional(),
});

export const adminUpdateUserSchema = z.object({
    name: z.string().min(2, "Name must be at least 2 characters").optional(),
    email: z.string().email("Invalid email format").optional(),
    password: passwordSchema.optional(),
    role: z.enum(["user", "admin"]).optional(),
    phone: z.string().trim().min(7).max(20).optional(),
    isVerified: z.boolean().optional(),
});
