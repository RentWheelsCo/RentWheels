import IORedis from "ioredis";

let connection = null;

export function isQueueEnabled() {
    return Boolean(process.env.REDIS_URL);
}

export function getRedisConnection() {
    if (!isQueueEnabled()) return null;
    if (connection) return connection;
    connection = new IORedis(process.env.REDIS_URL, {
        maxRetriesPerRequest: null,
        enableReadyCheck: true,
    });
    return connection;
}

