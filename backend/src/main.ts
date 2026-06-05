import "reflect-metadata";

import compression from "compression";
import { json, urlencoded } from "express";
import { Logger, ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";

import { AppModule } from "./app.module";
import { appEnv } from "./common/env";

// Дефолтный лимит body-parser express — 100 КБ. Сохранение бело-/чёрных списков
// кластеров (PUT .../automation/config) шлёт списки сотен кластеров с длинными
// именами и легко перешагивает 100 КБ → 413 «request entity too large», и человек
// не может сохранить фильтры. Поднимаем лимит. Сами body парсим вручную, отключив
// дефолтный (bodyParser: false), чтобы лимит точно применился.
const BODY_LIMIT = "10mb";

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    bodyParser: false,
    cors: {
      // TODO security: this app's dashboard origin is FRONTEND_ORIGIN only;
      // "https://seller.wildberries.ru" is scraped server-side (Safari/Playwright),
      // not a browser caller of this API, so allowing it with credentials:true is a
      // wider surface than needed. Consider dropping it once confirmed unused.
      origin: [appEnv.frontendOrigin, "https://seller.wildberries.ru"],
      credentials: true,
      allowedHeaders: [
        "Content-Type",
        "Authorization",
        "X-WB-Write-Intent",
        "X-WB-Write-Key",
      ],
    },
  });

  app.use(json({ limit: BODY_LIMIT }));
  app.use(urlencoded({ extended: true, limit: BODY_LIMIT }));
  app.use(compression());
  app.setGlobalPrefix("api");
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );

  await app.listen(appEnv.port);

  Logger.log(
    `Backend is running on http://localhost:${appEnv.port}/api`,
    "Bootstrap",
  );
}

void bootstrap();
