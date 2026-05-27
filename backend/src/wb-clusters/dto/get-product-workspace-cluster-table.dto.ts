import { Type } from "class-transformer";
import { IsDateString, IsIn, IsInt, IsOptional, IsString, Min } from "class-validator";

import { IsValidDateRange } from "../../common/validators/date-range.validator";
import type {
  ProductAdvertisingWorkspaceClusterSortDirection,
  ProductAdvertisingWorkspaceClusterSortKey,
  ProductAdvertisingWorkspaceClusterStatusFilter,
} from "../wb-clusters.types";

const clusterStatusFilters: ProductAdvertisingWorkspaceClusterStatusFilter[] = [
  "all",
  "active",
  "excluded",
];

const clusterSortDirections: ProductAdvertisingWorkspaceClusterSortDirection[] = ["asc", "desc"];

const clusterSortKeys: ProductAdvertisingWorkspaceClusterSortKey[] = [
  "source",
  "advertId",
  "campaignName",
  "clusterName",
  "jamFrequency",
  "jamClicks",
  "jamAddToCart",
  "jamOrders",
  "jamAvgPosition",
  "jamCtc",
  "jamCto",
  "monthlyFrequency",
  "bid",
  "views",
  "clicks",
  "ctr",
  "addToCart",
  "ctc",
  "orders",
  "cto",
  "avgPosition",
  "cpc",
  "cpm",
  "cpo",
  "viewToOrder",
  "spend",
];

@IsValidDateRange()
export class GetProductWorkspaceClusterTableDto {
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @IsIn(clusterStatusFilters)
  status?: ProductAdvertisingWorkspaceClusterStatusFilter;

  @IsOptional()
  search?: string;

  @IsOptional()
  @IsString()
  clusterNameSearch?: string;

  @IsOptional()
  @IsIn(clusterSortKeys)
  sortKey?: ProductAdvertisingWorkspaceClusterSortKey;

  @IsOptional()
  @IsIn(clusterSortDirections)
  sortDirection?: ProductAdvertisingWorkspaceClusterSortDirection;

  @IsOptional()
  @IsString()
  numericFilters?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pageSize?: number;
}
