import dotenv from 'dotenv/config';
import express from 'express';
import http from "http";
import cors from 'cors';
import cookieParser from "cookie-parser";
import prisma from "./utils/db.js";
import mainRouter from "./routes/index.routes.js";
import { errorMiddleware } from './middlewares/error.middleware.js';
import { initSocket } from "./utils/socket.js";

const app = express();
const PORT = process.env.PORT || 5000;
const isProd = process.env.NODE_ENV === "production";

// COOKIE AUTH IMPLEMENTED
// Needed so secure cookies work correctly behind proxies (Render, Nginx, etc.)
app.set("trust proxy", 1);

// Stripe webhook raw body (before cors/json)
app.use("/api/bookings/webhook", express.raw({ type: "application/json" }));

const corsOrigins = (process.env.CORS_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
const defaultOrigins = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:5500",
    "http://127.0.0.1:5500",
    "http://localhost:8080",
    "http://127.0.0.1:8080",
    "http://localhost:5000",
];
const allowedOrigins = new Set([...(corsOrigins.length ? corsOrigins : defaultOrigins), process.env.APP_URL].filter(Boolean));

app.use(
    cors({
        origin(origin, cb) {
            // Allow same-origin/no-origin requests, and allow "null" origin for local file:// dev
            if (!origin) {
                return cb(null, true);
            }
            if (origin === "null" && !isProd) {
                return cb(null, true);
            }
            if (allowedOrigins.has(origin)) {
                return cb(null, true);
            }
            return cb(null, false);
        },
        credentials: true,
    }),
);
app.use(express.json());
app.use(cookieParser());
app.use("/api", mainRouter);
app.get("/", (req, res) => res.send(`
<h1>RentWheels api working! :)</h1>
<p>Server Port ${PORT} | DB connected</p>
`));
app.use(errorMiddleware);

async function startServer() {
    try {
        await prisma.$connect();
        console.log("Database connected!");
        const server = http.createServer(app);
        initSocket(server);
        server.listen(PORT, () => console.log(`Server running http://localhost:${PORT}`));
    } catch (error) {
        console.error("Database failed to connect:", error);
        process.exit(1);
    }
}
startServer();

