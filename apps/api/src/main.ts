import { Logger, ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";

import { parseBooleanFlag } from "@/common/debug-logging";

import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: ["error", "warn", "log", "debug", "verbose"]
  });
  const config = app.get(ConfigService);
  const debugLogsEnabled = parseBooleanFlag(config.get<string>("APP_DEBUG_LOGS") ?? process.env.APP_DEBUG_LOGS);
  app.useLogger(debugLogsEnabled ? ["error", "warn", "log", "debug", "verbose"] : ["error", "warn", "log"]);
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidUnknownValues: true
    })
  );
  if (debugLogsEnabled) {
    app.use((req: { method: string; originalUrl?: string; url: string }, res: any, next: () => void) => {
      const startedAt = Date.now();
      const method = req.method;
      const route = req.originalUrl ?? req.url;
      Logger.debug(`[http] inbound ${method} ${route}`, "HttpTrace");
      res.on("finish", () => {
        const durationMs = Date.now() - startedAt;
        Logger.debug(
          `[http] outbound ${method} ${route} status=${res.statusCode} durationMs=${durationMs}`,
          "HttpTrace"
        );
      });
      next();
    });
    Logger.log("Debug logging enabled (APP_DEBUG_LOGS=true)", "Bootstrap");
  }

  const port = Number(process.env.PORT ?? 4000);
  await app.listen(port);
  Logger.log(`API listening on http://localhost:${port}`, "Bootstrap");
}

bootstrap();
