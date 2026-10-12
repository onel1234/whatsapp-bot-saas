import {
  Body,
  Controller,
  Get,
  Post,
  Param,
  Req,
  Res,
  Query,
  Inject,
  HttpCode,
  ForbiddenException,
  ServiceUnavailableException,
  BadRequestException,
  type RawBodyRequest,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { AuthService } from "../auth/auth.service";
import { parse, tenantId } from "../common/validation";
import {
  ChannelService,
  connectionSchema,
  updateConnectionSchema,
} from "./service";
import { verifySignature, sameSecret } from "./crypto";
import { normalizeEnvelope } from "./meta-adapter";
@Controller("tenants/:tenant/channels")
export class ChannelController {
  constructor(
    @Inject(AuthService) private auth: AuthService,
    @Inject(ChannelService) private service: ChannelService,
  ) {}
  @Get() async list(@Req() req: Request, @Param("tenant") id: string) {
    return this.service.list((await this.auth.viewer(req)).id, tenantId(id));
  }
  @Post() async create(
    @Req() req: Request,
    @Param("tenant") id: string,
    @Body() body: unknown,
  ) {
    return this.service.create(
      (await this.auth.viewer(req)).id,
      tenantId(id),
      parse(connectionSchema, body),
    );
  }
  @Post(":id") async update(
    @Req() req: Request,
    @Param("tenant") tenant: string,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return this.service.update(
      (await this.auth.viewer(req)).id,
      tenantId(tenant),
      tenantId(id),
      parse(updateConnectionSchema, body),
    );
  }
  @Get("deliveries") async deliveries(
    @Req() req: Request,
    @Param("tenant") id: string,
  ) {
    return this.service.deliveries(
      (await this.auth.viewer(req)).id,
      tenantId(id),
    );
  }
}
@Controller("webhooks/meta")
export class MetaWebhookController {
  constructor(@Inject(ChannelService) private service: ChannelService) {}
  @Get() verify(@Query() query: Record<string, unknown>, @Res() res: Response) {
    if (!process.env.META_VERIFY_TOKEN)
      throw new ServiceUnavailableException("Meta webhook is not configured.");
    if (
      query["hub.mode"] !== "subscribe" ||
      !sameSecret(query["hub.verify_token"], process.env.META_VERIFY_TOKEN) ||
      typeof query["hub.challenge"] !== "string" ||
      query["hub.challenge"].length > 200
    )
      throw new ForbiddenException("Webhook verification failed.");
    res.type("text/plain").send(query["hub.challenge"]);
  }
  @Post() @HttpCode(200) async receive(@Req() req: RawBodyRequest<Request>) {
    if (!process.env.META_APP_SECRET)
      throw new ServiceUnavailableException("Meta webhook is not configured.");
    if (
      !req.rawBody ||
      !verifySignature(
        req.rawBody,
        req.headers["x-hub-signature-256"],
        process.env.META_APP_SECRET,
      )
    )
      throw new ForbiddenException("Invalid webhook signature.");
    let events;
    try {
      events = normalizeEnvelope(req.body);
    } catch {
      throw new BadRequestException("Invalid Meta event.");
    }
    await this.service.receive(events);
    return { received: true };
  }
}
