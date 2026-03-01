import { Module } from "@nestjs/common";

import { AuditModule } from "@/modules/audit/audit.module";

import { ComposioActionMapperService } from "./composio-action-mapper.service";
import { ComposioAdapter } from "./composio.adapter";
import { ConnectorsController } from "./connectors.controller";
import { ConnectorsService } from "./connectors.service";

@Module({
  imports: [AuditModule],
  controllers: [ConnectorsController],
  providers: [ConnectorsService, ComposioActionMapperService, ComposioAdapter],
  exports: [ConnectorsService, ComposioActionMapperService, ComposioAdapter]
})
export class ConnectorsModule {}
