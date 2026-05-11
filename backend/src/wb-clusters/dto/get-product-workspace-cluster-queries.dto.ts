import { IsDateString, IsIn, IsOptional, IsString, MinLength } from "class-validator";

import type {
  ProductAdvertisingWorkspaceClusterSortDirection,
  ProductAdvertisingWorkspaceClusterSortKey,
} from "../wb-clusters.types";

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

export class GetProductWorkspaceClusterQueriesDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  clusterKey?: string;

  @IsString()
  @IsOptional()
  @MinLength(1)
  clusterName?: string;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @IsIn(clusterSortKeys)
  sortKey?: ProductAdvertisingWorkspaceClusterSortKey;

  @IsOptional()
  @IsIn(clusterSortDirections)
  sortDirection?: ProductAdvertisingWorkspaceClusterSortDirection;
}
