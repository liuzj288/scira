import { drizzle } from 'drizzle-orm/neon-http';
import * as schema from '@/lib/db/schema';
import { serverEnv } from '@/env/server';
import { upstashCache } from 'drizzle-orm/cache/upstash';

export const db = drizzle(serverEnv.DATABASE_URL, {
  schema,
  cache: upstashCache({
    url: process.env.UPSTASH_REDIS_REST_URL!,
    token: process.env.UPSTASH_REDIS_REST_TOKEN!,
    global: true,
    config: { ex: 60 },
  }),
});
