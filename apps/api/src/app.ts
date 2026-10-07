import "reflect-metadata";
import "dotenv/config";
import {
  Catch,
  ExceptionFilter,
  ArgumentsHost,
  HttpException,
  Module,
} from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import type { Request, Response, NextFunction } from "express";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import { DatabaseModule } from "./database/database.module";
import { AuthModule } from "./auth/auth.module";
import { TenancyModule } from "./tenancy/tenancy.module";
import { PlansModule } from "./plans/plans.module";
import { HealthController } from "./health.controller";
@Module({
  imports: [DatabaseModule, AuthModule, TenancyModule, PlansModule],
  controllers: [HealthController],
})
class AppModule {}
@Catch()
class SafeErrors implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    const status = error instanceof HttpException ? error.getStatus() : 500;
    // Never serialize Prisma, OAuth, connection strings, request bodies or secrets.
    res.status(status).json({
      statusCode: status,
      message:
        error instanceof HttpException
          ? error.message
          : "Something went wrong. Please try again.",
    });
  }
}
export async function createApp() {
  if (!process.env.WEB_ORIGIN)
    throw new Error("WEB_ORIGIN must be configured.");
  if (
    process.env.NODE_ENV === "production" &&
    !process.env.WEB_ORIGIN.startsWith("https://")
  )
    throw new Error("Production WEB_ORIGIN must use HTTPS.");
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: ["error", "warn"],
    bodyParser: true,
  });
  app.use(helmet());
  app.use(cookieParser());
  app.enableCors({ origin: process.env.WEB_ORIGIN, credentials: true });
  app.use((req: Request, res: Response, next: NextFunction) => {
    res.setHeader("Cache-Control", "no-store");
    if (
      !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
      req.headers.origin !== process.env.WEB_ORIGIN
    ) {
      res.status(403).json({ message: "Untrusted request origin." });
      return;
    }
    next();
  });
  app.use(
    rateLimit({
      windowMs: 60_000,
      limit: 120,
      standardHeaders: "draft-7",
      legacyHeaders: false,
    }),
  );
  app.use(
    "/auth",
    rateLimit({
      windowMs: 15 * 60_000,
      limit: 30,
      skip: (req) => req.method === "GET",
      standardHeaders: "draft-7",
      legacyHeaders: false,
    }),
  );
  app.useGlobalFilters(new SafeErrors());
  app.enableShutdownHooks();
  await app.init();
  return app;
}
