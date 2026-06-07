import { describe, expect, it } from "vitest";

import {
  suggestReviewAction,
  type ClusterRelevanceSignals,
} from "./product-cluster-relevance";

function signals(overrides: Partial<ClusterRelevanceSignals> = {}): ClusterRelevanceSignals {
  return {
    learnedNegative: false,
    hasOrders: false,
    matchedTokens: 0,
    clusterTokens: 0,
    ...overrides,
  };
}

describe("suggestReviewAction (мусор-фильтр релевантности)", () => {
  it("есть заказы → approve, даже без совпадения токенов", () => {
    expect(suggestReviewAction(signals({ hasOrders: true, clusterTokens: 5 }))).toBe("approve");
  });

  it("нет заказов, но фразы пересекаются с профилем/одобренными → approve", () => {
    expect(suggestReviewAction(signals({ matchedTokens: 2, clusterTokens: 4 }))).toBe("approve");
  });

  it("нет заказов и ноль пересечений токенов → blacklist (явный мусор)", () => {
    expect(suggestReviewAction(signals({ matchedTokens: 0, clusterTokens: 4 }))).toBe("blacklist");
  });

  it("серая зона: нечего сопоставлять (нет токенов) → approve (пускаем, downside мал)", () => {
    expect(suggestReviewAction(signals({ clusterTokens: 0 }))).toBe("approve");
  });

  it("асимметрия в сторону approve: одного совпавшего токена достаточно", () => {
    expect(suggestReviewAction(signals({ matchedTokens: 1, clusterTokens: 10 }))).toBe("approve");
  });

  describe("обучение от действий менеджера (learnedNegative)", () => {
    it("выученное чёрное слово перебивает ЗАКАЗЫ → blacklist (случай «для шиншилл»)", () => {
      expect(
        suggestReviewAction(signals({ learnedNegative: true, hasOrders: true, clusterTokens: 2 })),
      ).toBe("blacklist");
    });

    it("выученное чёрное слово перебивает совпадение токенов → blacklist", () => {
      expect(
        suggestReviewAction(signals({ learnedNegative: true, matchedTokens: 3, clusterTokens: 5 })),
      ).toBe("blacklist");
    });

    it("без выученного негатива заказы по-прежнему дают approve", () => {
      expect(
        suggestReviewAction(signals({ learnedNegative: false, hasOrders: true, clusterTokens: 2 })),
      ).toBe("approve");
    });
  });
});
