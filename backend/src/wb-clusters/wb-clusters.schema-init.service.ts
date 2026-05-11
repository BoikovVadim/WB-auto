import { Injectable, Logger, OnModuleInit } from "@nestjs/common";

import { WbClustersRepository } from "./wb-clusters.repository";

@Injectable()
export class WbClustersSchemaInitService implements OnModuleInit {
  private readonly logger = new Logger(WbClustersSchemaInitService.name);

  constructor(private readonly wbClustersRepository: WbClustersRepository) {}

  async onModuleInit() {
    if (!this.wbClustersRepository.isConfigured()) {
      return;
    }

    await this.wbClustersRepository.ensureSchema();
    this.logger.log("WB clusters schema is ready.");
  }
}
