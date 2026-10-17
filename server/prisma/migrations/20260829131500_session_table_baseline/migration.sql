-- express-session's PostgreSQL store creates this table at runtime. Recording it
-- in migration history keeps Prisma drift checks deterministic without changing
-- the existing session data.
CREATE TABLE "user_sessions" (
  "sid" VARCHAR NOT NULL,
  "sess" JSONB NOT NULL,
  "expire" TIMESTAMP(6) NOT NULL,
  CONSTRAINT "session_pkey" PRIMARY KEY ("sid")
);

CREATE INDEX "IDX_session_expire" ON "user_sessions"("expire");
