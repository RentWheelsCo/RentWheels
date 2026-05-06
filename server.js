import dotenv from 'dotenv/config';
import express from 'express';
import http from "http";
import cors from 'cors';
import prisma from "./utils/db.js";
import mainRouter from "./routes/index.routes.js";
import { errorMiddleware } from './middlewares/error.middleware.js';
import { initSocket } from "./utils/socket.js";

const app = express();
const PORT = process.env.PORT || 5000;

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
            if (!origin || allowedOrigins.has(origin)) {
                return cb(null, true);
            }
            return cb(null, false);
        },
        credentials: true,
    }),
);
app.use(express.json());
app.use("/api", mainRouter);
app.use("/test-ui", express.static("test-ui"));  // Stripe test UI
app.get("/", (req, res) => res.send(`
<h1>🚗 RentWheels + Stripe Ready!</h1>
<p>Server Port ${PORT} | DB connected</p>
<a href="/test-ui/test.html" style="font-size:24px;padding:10px;background:#635bff;color:white;text-decoration:none;border-radius:5px">💳 Test Stripe Checkout →</a>
<p><small>Login: renter@test.com / password → Copy JWT → Test</small></p>
`));
app.use(errorMiddleware);

async function startServer() {
    try {
        await prisma.$connect();
        console.log("✅ Database connected!");
        const server = http.createServer(app);
        initSocket(server);
        server.listen(PORT, () => console.log(`🚀 Server running http://localhost:${PORT}`));
    } catch (error) {
        console.error("❌ DB error:", error);
        process.exit(1);
    }
}
startServer();

