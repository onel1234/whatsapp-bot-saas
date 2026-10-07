import {
  Body,
  Controller,
  Get,
  Post,
  Req,
  Res,
  Inject,
  BadRequestException,
  ServiceUnavailableException,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { OAuth2Client } from "google-auth-library";
import { loginSchema, registerSchema } from "@saha/shared";
import { AuthService, cookieOptions } from "./auth.service";
import { Database } from "../database/database.service";
import { newToken } from "../security";
import { parse } from "../common/validation";
@Controller()
export class AuthController {
  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(AuthService) private readonly auth: AuthService,
  ) {}
  @Get("auth/config") config() {
    return {
      google: Boolean(
        process.env.GOOGLE_CLIENT_ID &&
          process.env.GOOGLE_CLIENT_SECRET &&
          process.env.GOOGLE_REDIRECT_URI,
      ),
    };
  }
  @Post("auth/register") register(
    @Body() body: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.auth.register(parse(registerSchema, body), res);
  }
  @Post("auth/login") login(
    @Body() body: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const data = parse(loginSchema, body);
    return this.auth.login(data.email, data.password, res);
  }
  @Post("auth/logout") logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.auth.logout(req, res);
  }
  @Get("auth/me") async me(@Req() req: Request) {
    const user = await this.auth.viewer(req);
    return this.db.forUser(user.id, async (tx) => {
      const memberships = await tx.membership.findMany({
        where: { userId: user.id },
        include: { tenant: true },
        orderBy: { createdAt: "asc" },
      });
      return {
        id: user.id,
        email: user.email,
        name: user.name,
        tenants: memberships.map((m) => ({ ...m.tenant, role: m.role })),
      };
    });
  }
  private google() {
    if (!this.config().google)
      throw new ServiceUnavailableException(
        "Google sign-in is not configured.",
      );
    return new OAuth2Client(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI,
    );
  }
  @Get("auth/google") async googleStart(@Res() res: Response) {
    const client = this.google();
    const state = newToken();
    const nonce = newToken();
    const { codeVerifier, codeChallenge } =
      await client.generateCodeVerifierAsync();
    res.cookie("saha_oauth", JSON.stringify({ state, nonce, codeVerifier }), {
      ...cookieOptions(),
      maxAge: 10 * 60 * 1000,
    });
    res.redirect(
      client.generateAuthUrl({
        scope: ["openid", "email", "profile"],
        state,
        nonce,
        code_challenge: codeChallenge,
        code_challenge_method:
          "S256" as import("google-auth-library").CodeChallengeMethod,
      }),
    );
  }
  @Get("auth/google/callback") async googleCallback(
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const client = this.google();
    let saved: { state: string; nonce: string; codeVerifier: string };
    try {
      saved = JSON.parse(req.cookies?.saha_oauth ?? "{}");
    } catch {
      throw new BadRequestException("Invalid sign-in state.");
    }
    res.clearCookie("saha_oauth", cookieOptions());
    if (
      !saved.state ||
      req.query.state !== saved.state ||
      typeof req.query.code !== "string"
    )
      throw new BadRequestException("Sign-in expired or cancelled.");
    const { tokens } = await client.getToken({
      code: req.query.code,
      codeVerifier: saved.codeVerifier,
    });
    if (!tokens.id_token)
      throw new BadRequestException("Google did not return an identity.");
    const ticket = await client.verifyIdToken({
      idToken: tokens.id_token,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    if (
      !payload?.sub ||
      !payload.email ||
      !payload.email_verified ||
      (payload as unknown as { nonce?: string }).nonce !== saved.nonce
    )
      throw new BadRequestException("Could not verify Google identity.");
    const user = await this.auth.googleUser(
      payload.sub,
      payload.email.toLowerCase(),
      payload.name ?? payload.email,
    );
    await this.auth.issue(user.id, res);
    res.redirect(`${process.env.WEB_ORIGIN}/dashboard`);
  }
}
