import dotenv from 'dotenv/config';
import express from 'express';
import cors from 'cors';
import prisma from "./utils/db.js";
import mainRouter from "./routes/index.routes.js";
import { errorMiddleware } from './middlewares/error.middleware.js';
const app = express();
const PORT = process.env.PORT || 5000;


app.use(cors());
app.use(express.json());
app.use("/api", mainRouter);
app.get("/", (req, res) => res.send(`Server is running on Port ${PORT}`));
app.use(errorMiddleware);

async function startServer() {
    try {
        await prisma.$connect();
        console.log("Database connected successfully!");
        app.listen(PORT, () => console.log(`Server is running on Port ${PORT}`));
    } catch (error) {
        console.error("Failed to connect to the database:", error);
        process.exit(1);
    }
}
startServer();