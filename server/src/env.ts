import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  DATABASE_URL: z.string().default('file:./mpl_rack.db'),
  PORT: z.coerce.number().default(4000),
  HOST: z.string().default('0.0.0.0'),
  BOT_TOKEN: z.string().default(''),
  GROUP_CHAT_ID: z.string().default(''),
  UPLOADS_DIR: z.string().default('uploads'),
  CLIENT_DIST: z.string().default(''),
  SESSION_SECRET: z.string().default(''),
  SESSION_DIR: z.string().default(''),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment configuration:');
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
export const botEnabled = env.BOT_TOKEN.length > 0 && env.GROUP_CHAT_ID.length > 0;
