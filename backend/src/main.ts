import "reflect-metadata";

import compression from "compression";
import { Logger, ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";

import { AppModule } from "./app.module";
import { appEnv } from "./common/env";

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
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
