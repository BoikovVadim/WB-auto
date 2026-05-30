export interface PromotionCampaignCountGroup {
  type: number;
  status: number;
  count: number;
  advert_list: Array<{
    advertId: number;
    changeTime: string;
  }>;
}

export interface PromotionCampaignCountResponse {
  adverts: PromotionCampaignCountGroup[];
  all: number;
}

export interface PromotionCampaignDetailsResponse {
  adverts: PromotionCampaignDetailsItem[];
}

export interface PromotionCampaignDetailsItem {
  id: number;
  status: number;
  bid_type: string | null;
  currency: string | null;
  settings?: {
    name?: string;
    payment_type?: string;
    placements?: {
      search?: boolean;
      recommendations?: boolean;
    };
  };
  timestamps?: {
    created?: string;
    started?: string;
    updated?: string;
  };
  nm_settings?: Array<{
    nm_id: number;
    bids_kopecks?: {
      search?: number;
      recommendations?: number;
    };
    subject?: {
      id?: number;
      name?: string;
    };
  }>;
}

export interface PromotionNormQueryListResponse {
  items: Array<{
    advertId: number;
    nmId: number;
    normQueries?: {
      active?: string[] | null;
      excluded?: string[] | null;
    };
  }>;
}

export interface PromotionNormQueryStatsResponse {
  stats: Array<{
    advert_id: number;
    nm_id: number;
    stats: Array<{
      norm_query: string;
      views?: number;
      clicks?: number;
      atbs?: number;
      orders?: number;
      shks?: number;
      ctr?: number;
      avg_pos?: number;
      cpc?: number;
      cpm?: number;
      spend?: number;
      currency?: string;
    }>;
  }>;
}

export interface PromotionNormQueryBidsResponse {
  bids: Array<{
    advert_id: number;
    nm_id: number;
    norm_query: string;
    bid?: number;
  }> | null;
}

export interface PromotionSetNormQueryBidsRequest {
  bids: Array<{
    advert_id: number;
    nm_id: number;
    norm_query: string;
    bid: number;
  }>;
}

export interface PromotionMinimumProductBidsRequest {
  advert_id: number;
  nm_ids: number[];
  payment_type: string;
  placement_types: string[];
}

export interface PromotionNormQueryMinusResponse {
  items: Array<{
    advert_id: number;
    nm_id: number;
    norm_queries?: string[] | null;
  }> | null;
}

export interface PromotionDailyNormQueryStatsResponse {
  items: Array<{
    advertId: number;
    nmId: number;
    dailyStats?: Array<{
      date: string;
      stat?: {
        normQuery?: string;
        views?: number;
        clicks?: number;
        atbs?: number;
        orders?: number;
        shks?: number;
        ctr?: number;
        avgPos?: number;
        cpc?: number;
        cpm?: number;
        spend?: number;
        currency?: string;
      } | null;
    }> | null;
  }> | null;
}

/**
 * Ответ /adv/v2/fullstats — ПОЛНЫЙ расход кампании (как в кабинете WB),
 * с разбивкой по дням → площадкам (apps) → товарам (nm). В отличие от
 * normquery/stats (расход только в разрезе поисковых запросов), сюда входит
 * расход на показы вне поиска (каталог, карточки, рекомендации). Поле `sum` —
 * это расход в рублях. Тело запроса — массив { id, interval:{begin,end} }.
 */
export type PromotionFullstatsResponse = Array<{
  advertId: number;
  days?: Array<{
    date: string;
    apps?: Array<{
      appType?: number;
      nm?: Array<{
        nmId: number;
        sum?: number;
        name?: string;
      }> | null;
    }> | null;
  }> | null;
}>;

export interface PromotionKeywordStatsResponse {
  keywords: Array<{
    date: string;
    stats?: Array<{
      keyword?: string;
      views?: number;
      clicks?: number;
      ctr?: number;
      sum?: number;
      currency?: string;
    }> | null;
  }> | null;
}
