import express from 'express';
import authRouter from "./auth.routes.js";
const mainRouter = express.Router();

mainRouter.use("/auth", authRouter);
export default mainRouter;