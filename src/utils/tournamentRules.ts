export const POSITION_KEYS = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;

export type PositionKey = (typeof POSITION_KEYS)[number];

export type PointsRules = {
  byPosition: Record<PositionKey, number>;
  tenPlus: number;
  bonusMelhorMao: number;
};

export type PrizeRules = {
  ate9: number[];
  de9a18: number[];
  acima18: number[];
};

export const DEFAULT_POINTS_RULES: PointsRules = {
  byPosition: {
    1: 25,
    2: 18,
    3: 14,
    4: 12,
    5: 10,
    6: 8,
    7: 6,
    8: 4,
    9: 2,
  },
  tenPlus: 1,
  bonusMelhorMao: 1,
};

export const DEFAULT_PRIZE_RULES: PrizeRules = {
  ate9: [31.65, 22.79, 17.72, 15.19, 12.65, 0, 0, 0, 0],
  de9a18: [26.88, 19.35, 15.05, 12.9, 10.76, 8.6, 6.46, 0, 0],
  acima18: [25.25, 18.18, 14.14, 12.12, 10.1, 8.08, 6.06, 4.04, 2.03],
};

function toFiniteNumber(value: unknown, fallback: number): number {
  const parsed = typeof value === 'string' ? Number.parseFloat(value.replace(',', '.')) : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizePercentArray(value: unknown, fallback: number[]): number[] {
  if (!Array.isArray(value)) {
    return [...fallback];
  }

  const normalized = fallback.map((fallbackValue, index) => toFiniteNumber(value[index], fallbackValue));
  return normalized;
}

export function parsePointsRules(value: unknown): PointsRules {
  if (!value || typeof value !== 'object') {
    return { ...DEFAULT_POINTS_RULES, byPosition: { ...DEFAULT_POINTS_RULES.byPosition } };
  }

  const raw = value as Record<string, unknown>;
  const posicoesRaw = raw.posicoes && typeof raw.posicoes === 'object' ? (raw.posicoes as Record<string, unknown>) : {};

  const byPosition = POSITION_KEYS.reduce((acc, posicao) => {
    acc[posicao] = toFiniteNumber(posicoesRaw[String(posicao)], DEFAULT_POINTS_RULES.byPosition[posicao]);
    return acc;
  }, {} as Record<PositionKey, number>);

  return {
    byPosition,
    tenPlus: toFiniteNumber(posicoesRaw['10+'], DEFAULT_POINTS_RULES.tenPlus),
    bonusMelhorMao: toFiniteNumber(raw.bonus_melhor_mao, DEFAULT_POINTS_RULES.bonusMelhorMao),
  };
}

export function parsePrizeRules(value: unknown): PrizeRules {
  if (!value || typeof value !== 'object') {
    return {
      ate9: [...DEFAULT_PRIZE_RULES.ate9],
      de9a18: [...DEFAULT_PRIZE_RULES.de9a18],
      acima18: [...DEFAULT_PRIZE_RULES.acima18],
    };
  }

  const raw = value as Record<string, unknown>;
  const faixasRaw = raw.faixas && typeof raw.faixas === 'object' ? (raw.faixas as Record<string, unknown>) : {};

  return {
    ate9: normalizePercentArray(faixasRaw.ate_9, DEFAULT_PRIZE_RULES.ate9),
    de9a18: normalizePercentArray(faixasRaw.de_9_a_18, DEFAULT_PRIZE_RULES.de9a18),
    acima18: normalizePercentArray(faixasRaw.acima_18, DEFAULT_PRIZE_RULES.acima18),
  };
}

export function buildPointsJson(rules: PointsRules): Record<string, unknown> {
  return {
    posicoes: {
      '1': rules.byPosition[1],
      '2': rules.byPosition[2],
      '3': rules.byPosition[3],
      '4': rules.byPosition[4],
      '5': rules.byPosition[5],
      '6': rules.byPosition[6],
      '7': rules.byPosition[7],
      '8': rules.byPosition[8],
      '9': rules.byPosition[9],
      '10+': rules.tenPlus,
    },
    bonus_melhor_mao: rules.bonusMelhorMao,
  };
}

export function buildPrizeJson(rules: PrizeRules): Record<string, unknown> {
  return {
    faixas: {
      ate_9: rules.ate9,
      de_9_a_18: rules.de9a18,
      acima_18: rules.acima18,
    },
  };
}

export function getPointsByPlacement(colocacao: number | null, rules: PointsRules): number {
  if (!colocacao) return 0;
  if (colocacao >= 10) return rules.tenPlus;
  return rules.byPosition[colocacao as PositionKey] ?? 0;
}

export function getPrizePercentagesForPlayers(qtdJogadores: number, rules: PrizeRules): number[] {
  if (qtdJogadores > 18) return [...rules.acima18];
  if (qtdJogadores >= 9) return [...rules.de9a18];
  return [...rules.ate9];
}