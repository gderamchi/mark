import { Module } from "@nestjs/common";

import { ConnectorsModule } from "@/modules/connectors/connectors.module";

import { PolicyService } from "./policy.service";

@Module({
  imports: [ConnectorsModule],
  providers: [PolicyService],
  exports: [PolicyService]
})
export class PolicyModule {}
