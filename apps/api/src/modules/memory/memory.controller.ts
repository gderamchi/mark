import { Body, Controller, Post } from "@nestjs/common";

import { CurrentUserId } from "@/common/current-user-id.decorator";

import { MemoryOptOutDto } from "./memory.dto";
import { MemoryService } from "./memory.service";

@Controller("v1/memory")
export class MemoryController {
  constructor(private readonly memoryService: MemoryService) {}

  @Post("opt-out")
  optOut(@CurrentUserId() userId: string, @Body() body: MemoryOptOutDto) {
    return this.memoryService.setOptOut(userId, body.enabled);
  }

  @Post("purge")
  purge(@CurrentUserId() userId: string) {
    return this.memoryService.purge(userId);
  }
}
