import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Post,
  UseGuards,
} from "@nestjs/common";

import { WbClustersWriteGuard } from "../common/guards/wb-clusters-write.guard";
import { ExportWbDataDto } from "./dto/export-wb-data.dto";
import { GetProductSearchTextsRangeDto } from "./dto/get-product-search-texts-range.dto";
import { RunSyncDto } from "./dto/run-sync.dto";
import { SetWbTokenDto } from "./dto/set-wb-token.dto";
import { WbSyncService } from "./wb-sync.service";

@Controller("wb-sync")
export class WbSyncController {
  constructor(
    @Inject(WbSyncService)
    private readonly wbSyncService: WbSyncService,
  ) {}

  @Get("status")
  getStatus() {
    return this.wbSyncService.getIntegrationStatus();
  }

  @Get("token")
  getTokenSession() {
    return this.wbSyncService.getTokenSession();
  }

  @Get("methods")
  getExportMethods() {
    return this.wbSyncService.getExportMethods();
  }

  @Post("token")
  @UseGuards(WbClustersWriteGuard)
  setRuntimeToken(@Body() body: SetWbTokenDto) {
    return this.wbSyncService.setRuntimeToken(body.token);
  }

  @Delete("token")
  @UseGuards(WbClustersWriteGuard)
  clearRuntimeToken() {
    return this.wbSyncService.clearRuntimeToken();
  }

  @Post("jobs/preview")
  previewSync(@Body() body: RunSyncDto) {
    return this.wbSyncService.createPreview(body.entityType);
  }

  @Get("exports/history")
  getExportsHistory() {
    return this.wbSyncService.getExportsHistory();
  }

  @Post("exports")
  exportData(@Body() body: ExportWbDataDto) {
    return this.wbSyncService.exportData(body);
  }

  @Get("exports/:requestId/status")
  getExportStatus(@Param("requestId") requestId: string) {
    return this.wbSyncService.getExportStatus(requestId);
  }

  @Get("exports/:requestId")
  getSavedExport(@Param("requestId") requestId: string) {
    return this.wbSyncService.getSavedExport(requestId);
  }

  @Post("product-search-texts/range")
  getProductSearchTextsRange(@Body() body: GetProductSearchTextsRangeDto) {
    return this.wbSyncService.getProductSearchTextsRange(body);
  }
}
