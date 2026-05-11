import "reflect-metadata";

import { Logger, ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";

import { AppModule } from "./app.module";
import { appEnv } from "./common/env";

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    cors: {
      origin: [appEnv.frontendOrigin],
      credentials: true,
    },
  });

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
