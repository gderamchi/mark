import { Module } from "@nestjs/common";

import { AuditModule } from "@/modules/audit/audit.module";

import { BackboardAdapter } from "./backboard.adapter";
import { MemoryController } from "./memory.controller";
import { MemoryService } from "./memory.service";

@Module({
  imports: [AuditModule],
  controllers: [MemoryController],
  providers: [BackboardAdapter, MemoryService],
  exports: [MemoryService]
})
export class MemoryModule {}
