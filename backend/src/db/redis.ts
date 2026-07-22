import Redis from "ioredis";
export const redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379", {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  lazyConnect: true,
});
redis.connect().catch(() => {
  /* 允许启动时无 Redis */
});
