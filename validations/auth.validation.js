import { z } from "zod";

export const registerSchema = z.object({
    name: z.string().min(2, "Name must be at least 2 characters"),

    email: z.string().email("Invalid email format"),

    password: z
        .string()
        .min(6)
        .regex(/[A-Z]/, "Must include uppercase letter")
        .regex(/[0-9]/, "Must include a number"),
});

export const loginSchema = z.object({
    email: z.string().email(),
    password: z.string().min(1, "Password required"),
});
