import { createParamDecorator, ExecutionContext, UnauthorizedException } from "@nestjs/common";

export const CurrentUserId = createParamDecorator((_: unknown, ctx: ExecutionContext): string => {
  const request = ctx.switchToHttp().getRequest<{ user?: { userId?: string } }>();
  const userId = request.user?.userId;
  if (!userId) {
    throw new UnauthorizedException("User identity not available");
  }
  return userId;
});
