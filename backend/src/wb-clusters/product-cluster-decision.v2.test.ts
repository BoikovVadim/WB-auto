import { describe, expect, it } from "vitest";

import {
  decideForClusterV2,
  type ClusterAccrualDecisionInput,
} from "./product-cluster-decision.v2";
import type {
  AutomationMode,
  ClusterAutomationStateValue,
  ClusterReviewStatus,
} from "./wb-clusters.repository.automation";

type Prev = {
  state: ClusterAutomationStateValue;
  manualProtected: boolean;
  lastDecision: string | null;
};
type Roles = {
  isProtected: boolean;
  isBlacklisted: boolean;
  reviewStatus: ClusterReviewStatus;
  drrHeld: boolean;
};

function makeInput(
  overrides: Partial<ClusterAccrualDecisionInput> = {},
): ClusterAccrualDecisionInput {
  return {
    normalizedClusterName: "cluster",
    clusterName: "Cluster",
    currentSourceKind: "active",
    accruedSpend: 0,
    accruedOrdersRk: 0,
    accruedOrdersJam: 0,
    ...overrides,
  };
}

function makeRoles(overrides: Partial<Roles> = {}): Roles {
  return {
    isProtected: false,
    isBlacklisted: false,
    reviewStatus: "approved",
    drrHeld: false,
    ...overrides,
  };
}

const MAX_CPO = 100; // Макс СРО (уже ×2 от целевого) — порог для всех веток ниже.

function decide(
  input: ClusterAccrualDecisionInput,
  roles: Roles,
  prev?: Prev,
  mode: AutomationMode = "live",
) {
  return decideForClusterV2(input, MAX_CPO, prev, mode, roles);
}

describe("decideForClusterV2", () => {
  describe("CPO = accruedSpend / max(заказы РК, JAM)", () => {
    it("делит на РК-заказы, когда их больше JAM", () => {
      const d = decide(
        makeInput({ accruedSpend: 300, accruedOrdersRk: 6, accruedOrdersJam: 2 }),
        makeRoles(),
      );
      expect(d.effectiveCpo).toBe(50); // 300 / max(6,2)=6
      expect(d.state).toBe("active"); // 50 ≤ 100
    });

    it("делит на JAM-заказы (halo-зачёт), когда их больше РК", () => {
      const d = decide(
        makeInput({ accruedSpend: 300, accruedOrdersRk: 1, accruedOrdersJam: 10 }),
        makeRoles(),
      );
      expect(d.effectiveCpo).toBe(30); // 300 / max(1,10)=10
      expect(d.state).toBe("active");
    });

    it("округляет CPO до 2 знаков", () => {
      const d = decide(
        makeInput({ accruedSpend: 100, accruedOrdersRk: 3, accruedOrdersJam: 0 }),
        makeRoles(),
      );
      expect(d.effectiveCpo).toBe(33.33); // 100/3
    });
  });

  describe("фаза LEARNING (нет заказов)", () => {
    it("держит в learning, пока накопленный расход < 2× Макс СРО", () => {
      const d = decide(
        makeInput({ accruedSpend: 2 * MAX_CPO - 1, accruedOrdersRk: 0, accruedOrdersJam: 0 }),
        makeRoles(),
      );
      expect(d.state).toBe("learning");
      expect(d.decision).toBe("noop"); // желаем active, и так active
      expect(d.effectiveCpo).toBe(2 * MAX_CPO - 1); // нет заказов → показываем расход
    });

    it("исключает (надёжно плохой) при расходе ≥ 2× Макс СРО без единого заказа", () => {
      const d = decide(
        makeInput({ accruedSpend: 2 * MAX_CPO, accruedOrdersRk: 0, accruedOrdersJam: 0 }),
        makeRoles(),
      );
      expect(d.state).toBe("excluded_high");
      expect(d.decision).toBe("exclude");
    });

    it("learning из excluded → include (возвращаем кластер набирать данные)", () => {
      const d = decide(
        makeInput({
          currentSourceKind: "excluded",
          accruedSpend: 10,
          accruedOrdersRk: 0,
          accruedOrdersJam: 0,
        }),
        makeRoles(),
      );
      expect(d.state).toBe("learning");
      expect(d.decision).toBe("include");
    });
  });

  describe("CPO-правило (есть заказы)", () => {
    it("active при CPO ровно на пороге (≤ Макс)", () => {
      const d = decide(
        makeInput({ accruedSpend: 100, accruedOrdersRk: 1, accruedOrdersJam: 0 }),
        makeRoles(),
      );
      expect(d.effectiveCpo).toBe(100);
      expect(d.state).toBe("active");
      expect(d.decision).toBe("noop");
    });

    it("excluded_high при CPO выше Макс", () => {
      const d = decide(
        makeInput({ accruedSpend: 101, accruedOrdersRk: 1, accruedOrdersJam: 0 }),
        makeRoles(),
      );
      expect(d.effectiveCpo).toBe(101);
      expect(d.state).toBe("excluded_high");
      expect(d.decision).toBe("exclude");
    });

    it("include дорогого кластера, который сейчас excluded, но стал рентабельным", () => {
      const d = decide(
        makeInput({
          currentSourceKind: "excluded",
          accruedSpend: 50,
          accruedOrdersRk: 1,
          accruedOrdersJam: 0,
        }),
        makeRoles(),
      );
      expect(d.state).toBe("active");
      expect(d.decision).toBe("include");
    });
  });

  describe("приоритеты ролей (сверху вниз)", () => {
    it("pending — наивысший приоритет: новый кластер сразу exclude", () => {
      const d = decide(
        makeInput({ accruedSpend: 10, accruedOrdersRk: 5 }), // рентабельный, но pending
        makeRoles({ reviewStatus: "pending" }),
      );
      expect(d.state).toBe("pending_review");
      expect(d.decision).toBe("exclude");
      expect(d.reviewStatus).toBe("pending");
    });

    it("pending уже excluded → noop (не трогаем)", () => {
      const d = decide(
        makeInput({ currentSourceKind: "excluded" }),
        makeRoles({ reviewStatus: "pending" }),
      );
      expect(d.decision).toBe("noop");
    });

    it("blacklist бьёт рентабельный CPO → exclude", () => {
      const d = decide(
        makeInput({ accruedSpend: 10, accruedOrdersRk: 5 }),
        makeRoles({ isBlacklisted: true }),
      );
      expect(d.state).toBe("blacklisted");
      expect(d.decision).toBe("exclude");
    });

    it("protected держит активным даже при CPO выше Макс", () => {
      const d = decide(
        makeInput({
          currentSourceKind: "excluded",
          accruedSpend: 1000,
          accruedOrdersRk: 1, // CPO=1000 ≫ Макс, но белый список
        }),
        makeRoles({ isProtected: true }),
      );
      expect(d.state).toBe("protected");
      expect(d.decision).toBe("include");
    });

    it("pending имеет приоритет над blacklist", () => {
      const d = decide(
        makeInput(),
        makeRoles({ reviewStatus: "pending", isBlacklisted: true }),
      );
      expect(d.state).toBe("pending_review");
    });

    it("blacklist имеет приоритет над protected", () => {
      const d = decide(
        makeInput({ currentSourceKind: "excluded" }),
        makeRoles({ isBlacklisted: true, isProtected: true }),
      );
      expect(d.state).toBe("blacklisted");
    });
  });

  describe("регулятор дневного ДРР (drrHeld)", () => {
    it("придерживает рентабельный кластер → excluded_drr / exclude", () => {
      const d = decide(
        makeInput({ accruedSpend: 10, accruedOrdersRk: 5 }), // рентабельный
        makeRoles({ drrHeld: true }),
      );
      expect(d.state).toBe("excluded_drr");
      expect(d.decision).toBe("exclude");
    });

    it("ДРР-hold ниже белого списка по приоритету (человек важнее)", () => {
      const d = decide(
        makeInput({ currentSourceKind: "excluded" }),
        makeRoles({ drrHeld: true, isProtected: true }),
      );
      expect(d.state).toBe("protected");
    });
  });

  describe("ручная защита (manual_protected)", () => {
    it("в live: сотрудник вернул выбывший кластер → иммунитет, learning→manual_protected", () => {
      const d = decide(
        makeInput({ accruedSpend: 10, accruedOrdersRk: 0, accruedOrdersJam: 0 }),
        makeRoles(),
        { state: "excluded_high", manualProtected: false, lastDecision: "exclude" },
        "live",
      );
      expect(d.manualProtected).toBe(true);
      expect(d.state).toBe("manual_protected");
    });

    it("в preview ручная защита не выставляется", () => {
      const d = decide(
        makeInput({ accruedSpend: 10, accruedOrdersRk: 0, accruedOrdersJam: 0 }),
        makeRoles(),
        { state: "excluded_high", manualProtected: false, lastDecision: "exclude" },
        "preview",
      );
      expect(d.manualProtected).toBe(false);
      expect(d.state).toBe("learning");
    });
  });
});
