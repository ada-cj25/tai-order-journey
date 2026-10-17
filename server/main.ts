import "dotenv/config";
import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import connectPgSimple from "connect-pg-simple";
import session from "express-session";
import helmet from "helmet";
import { AppModule } from "./app.module.js";
import { runtimeConfig } from "./runtime-config.js";

async function bootstrap() {
  const config = runtimeConfig();
  const app = await NestFactory.create(AppModule, { cors: false });
  app.getHttpAdapter().getInstance().set("trust proxy", config.trustProxy);
  app.enableShutdownHooks();
  const PgStore = connectPgSimple(session);
  app.use(helmet(config.production ? {} : { contentSecurityPolicy: false }));
  app.enableCors({ origin: config.origin, credentials: true });
  app.use(
    session({
      name: "erp.sid",
      secret: config.secret,
      resave: false,
      saveUninitialized: false,
      rolling: true,
      cookie: { httpOnly: true, sameSite: "lax", secure: config.production, maxAge: 8 * 60 * 60 * 1000 },
      store: new PgStore({ conString: process.env.DATABASE_URL, createTableIfMissing: !config.production, tableName: "user_sessions" }),
    }),
  );

  if (!config.production) {
    const openApi = new DocumentBuilder().setTitle("苔的跟单旅程 API").setVersion("1.2").addCookieAuth("erp.sid").build();
    SwaggerModule.setup("api/docs", app, SwaggerModule.createDocument(app, openApi));
  }

  await app.listen(config.port, config.host);
  console.log(`ERP API listening on ${config.host}:${config.port}`);
}

void bootstrap();
