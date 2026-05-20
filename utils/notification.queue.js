import { Queue } from "bullmq";
import { getRedisConnection, isQueueEnabled } from "./queue.js";

const QUEUE_NAME = "notifications";
let queue = null;

export function getNotificationQueue() {
    if (!isQueueEnabled()) return null;
    if (queue) return queue;
    const connection = getRedisConnection();
    queue = new Queue(QUEUE_NAME, { connection });
    return queue;
}

export async function enqueueNotification(payload) {
    const q = getNotificationQueue();
    if (!q) return null;
    return q.add("notifyUser", payload, {
        removeOnComplete: { age: 60 * 60, count: 1000 },
        removeOnFail: { age: 24 * 60 * 60, count: 1000 },
        attempts: 3,
        backoff: { type: "exponential", delay: 1000 },
    });
}

export async function enqueueCommentImageUpload(payload) {
    const q = getNotificationQueue();
    if (!q) return null;
    return q.add("uploadCommentImage", payload, {
        removeOnComplete: { age: 60 * 60, count: 5000 },
        removeOnFail: { age: 24 * 60 * 60, count: 5000 },
        attempts: 3,
        backoff: { type: "exponential", delay: 1500 },
    });
}
