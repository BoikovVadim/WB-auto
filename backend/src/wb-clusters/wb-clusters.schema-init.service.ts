import { Injectable, Logger, OnModuleInit } from "@nestjs/common";

import { WbClustersRepository } from "./wb-clusters.repository";

@Injectable()
export class WbClustersSchemaInitService implements OnModuleInit {
  private readonly logger = new Logger(WbClustersSchemaInitService.name);

  constructor(private readonly wbClustersRepository: WbClustersRepository) {}

  onModuleInit() {
    if (!this.wbClustersRepository.isConfigured()) {
      return;
    }

    // НЕ блокируем bootstrap: раньше `await ensureSchema()` держал app.listen()
    // ~2 минуты на проде (десятки ALTER/backfill по большим таблицам), и всё это
    // время nginx отдавал 502 после каждого деплоя. Инициализация схемы идёт в фоне;
    // первый же запрос к данным дождётся того же мемоизированного ensureSchema()-
    // промиса (read-пути зовут ensureSchema/ensureSchemaOrThrow перед SQL), а /health
    // БД не трогает и отвечает сразу — деплойный health-чек проходит мгновенно,
    // окно недоступности после деплоя ~исчезает.
    void this.wbClustersRepository
      .ensureSchema()
      .then(() => this.logger.log("WB clusters schema is ready."))
      .catch((err: Error) =>
        this.logger.error(`WB clusters schema init failed: ${err.message}`),
      );
  }
}
