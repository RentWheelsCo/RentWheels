import dotenv from "dotenv/config";
import { Worker } from "bullmq";
import { getRedisConnection, isQueueEnabled } from "../utils/queue.js";
import { notifyUser } from "../utils/notification.js";
import prisma from "../utils/db.js";
import cloudinary from "../utils/cloudinary.js";
import fs from "fs";

if (!isQueueEnabled()) {
    console.error("REDIS_URL is not set. Notification worker cannot start.");
    process.exit(1);
}

const connection = getRedisConnection();

const worker = new Worker(
    "notifications",
    async (job) => {
        if (job.name === "notifyUser") {
            await notifyUser(job.data || {});
            return;
        }
        if (job.name === "uploadCommentImage") {
            const commentId = Number(job?.data?.commentId || 0);
            if (!commentId) return;

            const comment = await prisma.comment.findUnique({
                where: { id: commentId },
                select: { id: true, image: true, imageTmpPath: true },
            });
            if (!comment || comment.image || !comment.imageTmpPath) return;

            const tmpPath = comment.imageTmpPath;
            const upload = await cloudinary.uploader.upload(tmpPath, {
                folder: "comments",
                resource_type: "image",
                public_id: `${Date.now()}-comment-${commentId}`,
            });

            await prisma.comment.update({
                where: { id: commentId },
                data: {
                    image: upload?.secure_url || upload?.url || null,
                    imageTmpPath: null,
                },
            });

            try {
                fs.unlinkSync(tmpPath);
            } catch {}
        }
    },
    { connection },
);

worker.on("ready", () => {
    console.log("[worker] notifications ready");
});

worker.on("failed", (job, err) => {
    console.error("[worker] notifications job failed", job?.id, err?.message || err);
});
