import { Body, Controller, Post } from "@nestjs/common";

import { Public } from "@/common/public.decorator";

import { AuthService } from "./auth.service";
import { LoginDto, RefreshDto, RegisterDto } from "./auth.dto";

@Controller("v1/auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post("register")
  register(@Body() body: RegisterDto) {
    return this.authService.register(body);
  }

  @Public()
  @Post("login")
  login(@Body() body: LoginDto) {
    return this.authService.login(body);
  }

  @Public()
  @Post("refresh")
  refresh(@Body() body: RefreshDto) {
    return this.authService.refreshSession(body.refreshToken);
  }
}
