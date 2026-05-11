import { Global, Module } from "@nestjs/common";

import { WbRuntimeConfigService } from "../wb-sync/wb-runtime-config.service";

@Global()
@Module({
  providers: [WbRuntimeConfigService],
  exports: [WbRuntimeConfigService],
})
export class WbRuntimeConfigModule {}
