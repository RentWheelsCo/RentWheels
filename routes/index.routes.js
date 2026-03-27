import express from 'express';
import authRouter from "./auth.routes.js";
import vehicleRouter from "./vehicle.routes.js";
const mainRouter = express.Router();

mainRouter.use("/auth", authRouter);
mainRouter.use("/vehicles", vehicleRouter);
export default mainRouter;
