import { describe, expect, it } from "vitest";

import { suggestReviewAction } from "./product-cluster-relevance";

describe("suggestReviewAction (мусор-фильтр релевантности)", () => {
  it("есть заказы → approve, даже без совпадения токенов", () => {
    expect(
      suggestReviewAction({ hasOrders: true, matchedTokens: 0, clusterTokens: 5 }),
    ).toBe("approve");
  });

  it("нет заказов, но фразы пересекаются с профилем/одобренными → approve", () => {
    expect(
      suggestReviewAction({ hasOrders: false, matchedTokens: 2, clusterTokens: 4 }),
    ).toBe("approve");
  });

  it("нет заказов и ноль пересечений токенов → blacklist (явный мусор)", () => {
    expect(
      suggestReviewAction({ hasOrders: false, matchedTokens: 0, clusterTokens: 4 }),
    ).toBe("blacklist");
  });

  it("серая зона: нечего сопоставлять (нет токенов) → approve (пускаем, downside мал)", () => {
    expect(
      suggestReviewAction({ hasOrders: false, matchedTokens: 0, clusterTokens: 0 }),
    ).toBe("approve");
  });

  it("асимметрия в сторону approve: одного совпавшего токена достаточно", () => {
    expect(
      suggestReviewAction({ hasOrders: false, matchedTokens: 1, clusterTokens: 10 }),
    ).toBe("approve");
  });
});
