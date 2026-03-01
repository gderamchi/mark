import { Controller, Get, Param, Post } from "@nestjs/common";

import { CurrentUserId } from "@/common/current-user-id.decorator";

import { ConnectorsService } from "./connectors.service";

@Controller("v1/connectors")
export class ConnectorsController {
  constructor(private readonly connectorsService: ConnectorsService) {}

  @Get()
  list(@CurrentUserId() userId: string) {
    return {
      connectors: this.connectorsService.listConnectors(userId)
    };
  }

  @Post(":connectorId/connect")
  connect(@CurrentUserId() userId: string, @Param("connectorId") connectorId: string) {
    return this.connectorsService.connect(userId, connectorId);
  }

  @Post(":connectorId/disconnect")
  disconnect(@CurrentUserId() userId: string, @Param("connectorId") connectorId: string) {
    return this.connectorsService.disconnect(userId, connectorId);
  }
}
