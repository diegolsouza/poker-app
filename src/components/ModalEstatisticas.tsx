import { useEffect, useMemo, useState } from 'react';
import supabase from '../supabaseClient';
import {
  DEFAULT_POINTS_RULES,
  DEFAULT_PRIZE_RULES,
  getPointsByPlacement,
  getPrizePercentagesForPlayers,
  parsePointsRules,
  parsePrizeRules,
} from '../utils/tournamentRules';

type ModalEstatisticasProps = {
  jogadorId: string;
  isOpen: boolean;
  onClose: () => void;
};

type RegistroHistorico = {
  id: number;
  tipo_participante: 'jogador' | 'visitante';
  colocacao: number | null;
  rebuys: number | null;
  fez_addon: boolean;
  melhor_mao: boolean;
  etapa: {
    id: number;
    codigo_etapa: string;
    temporada: {
      id: number;
      codigo_temporada: string;
    } | null;
  } | null;
};

type RegistroHistoricoRow = {
  id: number;
  tipo_participante: 'jogador' | 'visitante';
  colocacao: number | null;
  rebuys: number | null;
  fez_addon: boolean;
  melhor_mao: boolean;
  etapa:
    | {
        id: number;
        codigo_etapa: string;
        temporada:
          | {
              id: number;
              codigo_temporada: string;
            }
          | {
              id: number;
              codigo_temporada: string;
            }[]
          | null;
      }
    | {
        id: number;
        codigo_etapa: string;
        temporada:
          | {
              id: number;
              codigo_temporada: string;
            }
          | {
              id: number;
              codigo_temporada: string;
            }[]
          | null;
      }[]
    | null;
};

function pickFirst<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }
  return value ?? null;
}

function normalizarRegistro(row: RegistroHistoricoRow): RegistroHistorico {
  const etapa = pickFirst(row.etapa);
  const temporada = etapa ? pickFirst(etapa.temporada) : null;

  return {
    id: row.id,
    tipo_participante: row.tipo_participante,
    colocacao: row.colocacao,
    rebuys: row.rebuys,
    fez_addon: row.fez_addon,
    melhor_mao: row.melhor_mao,
    etapa: etapa
      ? {
          id: etapa.id,
          codigo_etapa: etapa.codigo_etapa,
          temporada: temporada
            ? {
                id: temporada.id,
                codigo_temporada: temporada.codigo_temporada,
              }
            : null,
        }
      : null,
  };
}

type ResumoTemporada = {
  temporadaId: number;
  nomeTemporada: string;
  pontos: number;
  participacoes: number;
  melhorColocacao: number | null;
  premioRecebido: number;
  gastoTotal: number;
  saldoFinal: number;
};

type RegistroGlobal = {
  jogadorId: number;
  tipoParticipante: 'jogador' | 'visitante';
  etapaId: number;
  colocacao: number | null;
  melhorMao: boolean;
  rebuys: number;
  fezAddon: boolean;
  temporadaId: number;
  codigoTemporada: string;
};

type EvolucaoTemporada = {
  temporadaId: number;
  codigoTemporada: string;
  eficiencia: number;
  posicaoFinal: number;
};

type ResumoGlobalJogador = {
  jogadorId: number;
  pontos: number;
  participacoes: number;
};

type RegistroGlobalRow = {
  jogador_id: number;
  tipo_participante: 'jogador' | 'visitante';
  colocacao: number | null;
  melhor_mao: boolean;
  rebuys: number | null;
  fez_addon: boolean;
  etapa:
    | {
        id: number;
        temporada:
          | {
              id: number;
              codigo_temporada: string;
            }
          | {
              id: number;
              codigo_temporada: string;
            }[]
          | null;
      }
    | {
      id: number;
        temporada:
          | {
              id: number;
              codigo_temporada: string;
            }
          | {
              id: number;
              codigo_temporada: string;
            }[]
          | null;
      }[]
    | null;
};

function formatDecimal(value: number, digits = 2): string {
  return value.toLocaleString('pt-BR', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function formatPercent(value: number): string {
  return `${formatDecimal(value, 2)}%`;
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
  }).format(value);
}

const TEMPORADA_POR_JOGADOR = 8;
const CAIXINHA_POR_JOGADOR = 2;

function normalizeGlobalRegistro(row: RegistroGlobalRow): RegistroGlobal | null {
  const etapa = pickFirst(row.etapa);
  const temporada = etapa ? pickFirst(etapa.temporada) : null;
  if (!temporada || !etapa) {
    return null;
  }

  return {
    jogadorId: row.jogador_id,
    tipoParticipante: row.tipo_participante,
    etapaId: etapa.id,
    colocacao: row.colocacao,
    melhorMao: row.melhor_mao,
    rebuys: row.rebuys ?? 0,
    fezAddon: row.fez_addon,
    temporadaId: temporada.id,
    codigoTemporada: temporada.codigo_temporada,
  };
}

function buildLinePath(points: string[]): string {
  if (points.length === 0) {
    return '';
  }

  return `M ${points.join(' L ')}`;
}

export default function ModalEstatisticas({ jogadorId, isOpen, onClose }: ModalEstatisticasProps) {
  const [registros, setRegistros] = useState<RegistroHistorico[]>([]);
  const [registrosGlobais, setRegistrosGlobais] = useState<RegistroGlobal[]>([]);
  const [pointsRules, setPointsRules] = useState(DEFAULT_POINTS_RULES);
  const [prizeRules, setPrizeRules] = useState(DEFAULT_PRIZE_RULES);
  const [financeConfig, setFinanceConfig] = useState({ buyIn: 50, rebuy: 50, addon: 50 });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const carregarRegras = async () => {
      const { data, error: queryError } = await supabase
        .from('configuracoes')
        .select('pontuacao_json, premiacao_json, buy_in, rebuy, add_on')
        .order('id', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!queryError) {
        setPointsRules(parsePointsRules(data?.pontuacao_json));
        setPrizeRules(parsePrizeRules(data?.premiacao_json));
        setFinanceConfig({
          buyIn: Number(data?.buy_in ?? 50),
          rebuy: Number(data?.rebuy ?? 50),
          addon: Number(data?.add_on ?? 50),
        });
      }
    };

    void carregarRegras();
  }, []);

  useEffect(() => {
    const carregarHistorico = async () => {
      if (!isOpen) return;

      const jogadorIdNumber = Number(jogadorId);
      if (!jogadorId || Number.isNaN(jogadorIdNumber)) {
        setError('Jogador inválido para consulta de estatísticas.');
        setRegistros([]);
        return;
      }

      setIsLoading(true);
      setError(null);

      const [historicoResult, globalResult] = await Promise.all([
        supabase
          .from('registros_etapa')
          .select(
            'id, tipo_participante, colocacao, rebuys, fez_addon, melhor_mao, etapa:etapas!fk_registros_etapa(id, codigo_etapa, temporada:temporadas!fk_etapa_temporada(id, codigo_temporada))',
          )
          .eq('jogador_id', jogadorIdNumber)
          .order('id', { ascending: false }),
        supabase
          .from('registros_etapa')
          .select(
            'jogador_id, tipo_participante, colocacao, melhor_mao, rebuys, fez_addon, etapa:etapas!fk_registros_etapa(id, temporada:temporadas!fk_etapa_temporada(id, codigo_temporada))',
          ),
      ]);

      if (historicoResult.error) {
        setError(`Erro ao carregar histórico do jogador: ${historicoResult.error.message}`);
        setRegistros([]);
      } else {
        const registrosNormalizados = ((historicoResult.data ?? []) as RegistroHistoricoRow[]).map(normalizarRegistro);
        setRegistros(registrosNormalizados);
      }

      if (globalResult.error) {
        setError(`Erro ao carregar dados globais: ${globalResult.error.message}`);
        setRegistrosGlobais([]);
      } else {
        const globais = ((globalResult.data ?? []) as RegistroGlobalRow[])
          .map(normalizeGlobalRegistro)
          .filter((item): item is RegistroGlobal => item !== null);
        setRegistrosGlobais(globais);
      }

      setIsLoading(false);
    };

    void carregarHistorico();
  }, [isOpen, jogadorId]);

  const estatisticas = useMemo(() => {
    const financeiroPorEtapa = new Map<number, { qtdJogadores: number; totalRebuys: number; totalAddons: number }>();

    for (const item of registrosGlobais) {
      if (item.tipoParticipante !== 'jogador') {
        continue;
      }

      if (!financeiroPorEtapa.has(item.etapaId)) {
        financeiroPorEtapa.set(item.etapaId, {
          qtdJogadores: 0,
          totalRebuys: 0,
          totalAddons: 0,
        });
      }

      const resumoEtapa = financeiroPorEtapa.get(item.etapaId);
      if (!resumoEtapa) {
        continue;
      }

      resumoEtapa.qtdJogadores += 1;
      resumoEtapa.totalRebuys += item.rebuys;
      resumoEtapa.totalAddons += item.fezAddon ? 1 : 0;
    }

    const premioPorEtapaMap = new Map<number, Map<number, number>>();
    financeiroPorEtapa.forEach((resumoEtapa, etapaId) => {
      const premiacaoEtapa =
        resumoEtapa.qtdJogadores * (financeConfig.buyIn - TEMPORADA_POR_JOGADOR - CAIXINHA_POR_JOGADOR) +
        resumoEtapa.totalRebuys * financeConfig.rebuy +
        resumoEtapa.totalAddons * financeConfig.addon;

      const percentuais = getPrizePercentagesForPlayers(resumoEtapa.qtdJogadores, prizeRules);
      const mapaPremios = new Map<number, number>();

      percentuais.forEach((percentual, index) => {
        if (percentual <= 0) {
          return;
        }

        mapaPremios.set(index + 1, (premiacaoEtapa * percentual) / 100);
      });

      premioPorEtapaMap.set(etapaId, mapaPremios);
    });

    const totalPontos = registros.reduce((acc, item) => {
      const pontosBase = getPointsByPlacement(item.colocacao, pointsRules);
      const bonusMelhorMao = item.melhor_mao ? pointsRules.bonusMelhorMao : 0;
      return acc + pontosBase + bonusMelhorMao;
    }, 0);

    const totalParticipacoes = registros.length;
    const totalRebuys = registros.reduce((acc, item) => acc + (item.rebuys ?? 0), 0);
    const totalMelhorMao = registros.filter((item) => item.melhor_mao).length;
    const totalPodios = registros.filter((item) => item.colocacao !== null && item.colocacao >= 1 && item.colocacao <= 5).length;

    let totalPremiacoesRecebidas = 0;
    let totalGastoBuyIn = 0;
    let totalGastoRebuy = 0;
    let totalGastoAddon = 0;

    const porTemporadaMap = new Map<number, ResumoTemporada>();

    for (const item of registros) {
      const temporada = item.etapa?.temporada;
      if (!temporada) {
        continue;
      }

      if (!porTemporadaMap.has(temporada.id)) {
        porTemporadaMap.set(temporada.id, {
          temporadaId: temporada.id,
          nomeTemporada: temporada.codigo_temporada,
          pontos: 0,
          participacoes: 0,
          melhorColocacao: null,
          premioRecebido: 0,
          gastoTotal: 0,
          saldoFinal: 0,
        });
      }

      const resumo = porTemporadaMap.get(temporada.id);
      if (!resumo) continue;

      resumo.participacoes += 1;
      resumo.pontos += getPointsByPlacement(item.colocacao, pointsRules);
      if (item.melhor_mao) {
        resumo.pontos += pointsRules.bonusMelhorMao;
      }

      if (item.colocacao !== null) {
        resumo.melhorColocacao = resumo.melhorColocacao === null ? item.colocacao : Math.min(resumo.melhorColocacao, item.colocacao);
      }

      const gastoBuyInItem = item.tipo_participante === 'jogador' ? financeConfig.buyIn : 0;
      const gastoRebuyItem = (item.rebuys ?? 0) * financeConfig.rebuy;
      const gastoAddonItem = item.fez_addon ? financeConfig.addon : 0;
      const gastoTotalItem = gastoBuyInItem + gastoRebuyItem + gastoAddonItem;

      const premiosEtapa = item.etapa ? premioPorEtapaMap.get(item.etapa.id) : undefined;
      const premioRecebidoItem = item.colocacao ? premiosEtapa?.get(item.colocacao) ?? 0 : 0;

      totalPremiacoesRecebidas += premioRecebidoItem;
      totalGastoBuyIn += gastoBuyInItem;
      totalGastoRebuy += gastoRebuyItem;
      totalGastoAddon += gastoAddonItem;

      resumo.premioRecebido += premioRecebidoItem;
      resumo.gastoTotal += gastoTotalItem;
    }

    const porTemporada = Array.from(porTemporadaMap.values())
      .map((item) => ({
        ...item,
        saldoFinal: item.premioRecebido - item.gastoTotal,
      }))
      .sort((a, b) => b.nomeTemporada.localeCompare(a.nomeTemporada, 'pt-BR', { numeric: true, sensitivity: 'base' }));

    const totalGastosFinanceiros = totalGastoBuyIn + totalGastoRebuy + totalGastoAddon;

    return {
      totalPontos,
      totalParticipacoes,
      totalRebuys,
      totalMelhorMao,
      totalPodios,
      totalVitorias: registros.filter((item) => item.colocacao === 1).length,
      totalPremiacoesRecebidas,
      totalGastoBuyIn,
      totalGastoRebuy,
      totalGastoAddon,
      totalGastosFinanceiros,
      saldoFinanceiro: totalPremiacoesRecebidas - totalGastosFinanceiros,
      porTemporada,
    };
  }, [financeConfig, pointsRules, prizeRules, registros, registrosGlobais]);

  const desempenhoGeral = useMemo(() => {
    const jogadorIdNumber = Number(jogadorId);
    if (!jogadorId || Number.isNaN(jogadorIdNumber)) {
      return {
        eficiencia: 0,
        rankingPosicao: null as number | null,
        rankingTotal: 0,
        participacoes: 0,
      };
    }

    const resumoMap = new Map<number, ResumoGlobalJogador>();

    for (const item of registrosGlobais) {
      if (item.tipoParticipante !== 'jogador') {
        continue;
      }

      if (!resumoMap.has(item.jogadorId)) {
        resumoMap.set(item.jogadorId, {
          jogadorId: item.jogadorId,
          pontos: 0,
          participacoes: 0,
        });
      }

      const resumo = resumoMap.get(item.jogadorId);
      if (!resumo) continue;

      resumo.participacoes += 1;
      resumo.pontos += getPointsByPlacement(item.colocacao, pointsRules);
      if (item.melhorMao) {
        resumo.pontos += pointsRules.bonusMelhorMao;
      }
    }

    const resumoAtual = resumoMap.get(jogadorIdNumber);
    const eficienciaAtual = resumoAtual && resumoAtual.participacoes > 0 ? resumoAtual.pontos / resumoAtual.participacoes : 0;

    const elegiveis = Array.from(resumoMap.values())
      .filter((item) => item.participacoes >= 5)
      .sort((a, b) => {
        const eficienciaA = a.pontos / a.participacoes;
        const eficienciaB = b.pontos / b.participacoes;
        if (eficienciaB !== eficienciaA) {
          return eficienciaB - eficienciaA;
        }
        if (b.participacoes !== a.participacoes) {
          return b.participacoes - a.participacoes;
        }
        return a.jogadorId - b.jogadorId;
      });

    const rankingPosicao = elegiveis.findIndex((item) => item.jogadorId === jogadorIdNumber);

    return {
      eficiencia: eficienciaAtual,
      rankingPosicao: rankingPosicao >= 0 ? rankingPosicao + 1 : null,
      rankingTotal: elegiveis.length,
      participacoes: resumoAtual?.participacoes ?? 0,
    };
  }, [jogadorId, pointsRules, registrosGlobais]);

  const taxaVitoria = useMemo(() => {
    if (estatisticas.totalParticipacoes === 0) {
      return 0;
    }

    return (estatisticas.totalVitorias / estatisticas.totalParticipacoes) * 100;
  }, [estatisticas.totalParticipacoes, estatisticas.totalVitorias]);

  const evolucaoTemporadas = useMemo(() => {
    const jogadorIdNumber = Number(jogadorId);
    if (!jogadorId || Number.isNaN(jogadorIdNumber)) {
      return [] as EvolucaoTemporada[];
    }

    const porTemporada = new Map<number, { codigo: string; registros: RegistroGlobal[] }>();

    for (const registro of registrosGlobais) {
      if (registro.tipoParticipante !== 'jogador') {
        continue;
      }

      if (!porTemporada.has(registro.temporadaId)) {
        porTemporada.set(registro.temporadaId, {
          codigo: registro.codigoTemporada,
          registros: [],
        });
      }

      porTemporada.get(registro.temporadaId)?.registros.push(registro);
    }

    const evolucao: EvolucaoTemporada[] = [];

    porTemporada.forEach((temporada, temporadaId) => {
      const resumoJogadores = new Map<number, { pontos: number; participacoes: number }>();

      for (const registro of temporada.registros) {
        if (!resumoJogadores.has(registro.jogadorId)) {
          resumoJogadores.set(registro.jogadorId, { pontos: 0, participacoes: 0 });
        }

        const resumo = resumoJogadores.get(registro.jogadorId);
        if (!resumo) continue;

        resumo.participacoes += 1;
        resumo.pontos += getPointsByPlacement(registro.colocacao, pointsRules);
        if (registro.melhorMao) {
          resumo.pontos += pointsRules.bonusMelhorMao;
        }
      }

      const rankingTemporada = Array.from(resumoJogadores.entries())
        .map(([id, resumo]) => ({ jogadorId: id, ...resumo }))
        .sort((a, b) => {
          if (b.pontos !== a.pontos) {
            return b.pontos - a.pontos;
          }
          if (b.participacoes !== a.participacoes) {
            return b.participacoes - a.participacoes;
          }
          return a.jogadorId - b.jogadorId;
        });

      const indiceJogador = rankingTemporada.findIndex((item) => item.jogadorId === jogadorIdNumber);
      const resumoJogador = resumoJogadores.get(jogadorIdNumber);

      if (indiceJogador < 0 || !resumoJogador || resumoJogador.participacoes === 0) {
        return;
      }

      evolucao.push({
        temporadaId,
        codigoTemporada: temporada.codigo,
        eficiencia: resumoJogador.pontos / resumoJogador.participacoes,
        posicaoFinal: indiceJogador + 1,
      });
    });

    return evolucao
      .sort((a, b) => b.codigoTemporada.localeCompare(a.codigoTemporada, 'pt-BR', { numeric: true, sensitivity: 'base' }))
      .slice(0, 6)
      .reverse();
  }, [jogadorId, pointsRules, registrosGlobais]);

  const graficoEvolucao = useMemo(() => {
    if (evolucaoTemporadas.length < 2) {
      return null;
    }

    const width = 640;
    const height = 230;
    const paddingLeft = 44;
    const paddingRight = 16;
    const paddingTop = 16;
    const paddingBottom = 44;
    const chartWidth = width - paddingLeft - paddingRight;
    const chartHeight = height - paddingTop - paddingBottom;

    const eficiencias = evolucaoTemporadas.map((item) => item.eficiencia);
    const posicoes = evolucaoTemporadas.map((item) => item.posicaoFinal);

    const minEf = Math.min(...eficiencias);
    const maxEf = Math.max(...eficiencias);
    const rangeEf = maxEf - minEf || 1;
    const maxPos = Math.max(...posicoes);
    const rangePos = Math.max(maxPos - 1, 1);

    const xStep = chartWidth / (evolucaoTemporadas.length - 1);

    const pontosEficiencia = evolucaoTemporadas.map((item, index) => {
      const x = paddingLeft + index * xStep;
      const y = paddingTop + chartHeight * (1 - (item.eficiencia - minEf) / rangeEf);
      return { x, y, label: item.codigoTemporada, valor: item.eficiencia };
    });

    const pontosPosicao = evolucaoTemporadas.map((item, index) => {
      const x = paddingLeft + index * xStep;
      const y = paddingTop + chartHeight * (1 - (item.posicaoFinal - 1) / rangePos);
      return { x, y, label: item.codigoTemporada, valor: item.posicaoFinal };
    });

    const pathEficiencia = buildLinePath(pontosEficiencia.map((p) => `${p.x},${p.y}`));
    const pathPosicao = buildLinePath(pontosPosicao.map((p) => `${p.x},${p.y}`));

    return {
      width,
      height,
      paddingLeft,
      paddingBottom,
      pathEficiencia,
      pathPosicao,
      pontosEficiencia,
      pontosPosicao,
    };
  }, [evolucaoTemporadas]);

  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-[#01060c]/75 p-3 backdrop-blur-[2px] sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-label="Estatísticas do jogador">
      <button
        type="button"
        aria-label="Fechar modal"
        className="absolute inset-0 cursor-default"
        onClick={onClose}
      />

      <section
        className="relative z-10 flex h-[92dvh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-[#315770] bg-[#0b1a25] shadow-[0_24px_60px_rgba(0,0,0,0.45)] sm:h-auto sm:max-h-[90dvh]"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-start justify-between border-b border-[#244357] px-4 py-3 sm:items-center sm:px-6 sm:py-4">
          <div>
            <h2 className="text-base font-bold text-slate-50 sm:text-xl">Histórico Completo do Jogador</h2>
            <p className="mt-1 text-xs text-slate-300 sm:text-sm">Dados consolidados de todas as temporadas.</p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-[#315770] bg-[#102536] text-slate-200 transition hover:border-[#ff9a63] hover:text-[#ffcfb2]"
            aria-label="Fechar"
          >
            X
          </button>
        </header>

        <div className="flex-1 space-y-4 overflow-y-auto p-4 sm:space-y-5 sm:p-6">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-2 sm:gap-3 lg:grid-cols-7">
            <article className="rounded-xl border border-[#244357] bg-[#102536] p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-[#ff9a63]">Pontos Ganhos</p>
              <p className="mt-2 text-xl font-bold text-slate-50 sm:text-2xl">{estatisticas.totalPontos}</p>
            </article>

            <article className="rounded-xl border border-[#244357] bg-[#102536] p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-[#ff9a63]">Participações</p>
              <p className="mt-2 text-xl font-bold text-slate-50 sm:text-2xl">{estatisticas.totalParticipacoes}</p>
            </article>

            <article className="rounded-xl border border-[#244357] bg-[#102536] p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-[#ff9a63]">Premiações Recebidas</p>
              <p className="mt-2 text-lg font-bold text-emerald-300 sm:text-2xl">{formatCurrency(estatisticas.totalPremiacoesRecebidas)}</p>
            </article>

            <article className="rounded-xl border border-[#244357] bg-[#102536] p-3 lg:col-span-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-[#ff9a63]">Gasto Buy-in/Rebuy/Add-on</p>
              <p className="mt-2 text-lg font-bold text-rose-300 sm:text-2xl">-{formatCurrency(estatisticas.totalGastosFinanceiros)}</p>
              <p className="mt-1 text-xs text-slate-300">
                B: {formatCurrency(estatisticas.totalGastoBuyIn)} | Rb: {formatCurrency(estatisticas.totalGastoRebuy)} | Ad: {formatCurrency(estatisticas.totalGastoAddon)}
              </p>
            </article>

            <article className="rounded-xl border border-[#244357] bg-[#102536] p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-[#ff9a63]">Saldo</p>
              <p className={`mt-2 text-lg font-bold sm:text-2xl ${estatisticas.saldoFinanceiro >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
                {formatCurrency(estatisticas.saldoFinanceiro)}
              </p>
            </article>

            <article className="rounded-xl border border-[#244357] bg-[#102536] p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-[#ff9a63]">Rebuys</p>
              <p className="mt-2 text-xl font-bold text-slate-50 sm:text-2xl">{estatisticas.totalRebuys}</p>
            </article>

            <article className="rounded-xl border border-[#244357] bg-[#102536] p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-[#ff9a63]">Melhor Mão</p>
              <p className="mt-2 text-xl font-bold text-slate-50 sm:text-2xl">{estatisticas.totalMelhorMao}</p>
            </article>

            <article className="rounded-xl border border-[#244357] bg-[#102536] p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-[#ff9a63]">Pódios</p>
              <p className="mt-2 text-xl font-bold text-slate-50 sm:text-2xl">{estatisticas.totalPodios}</p>
            </article>

            <article className="rounded-xl border border-[#244357] bg-[#102536] p-3 lg:col-span-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-[#ff9a63]">Desempenho</p>
              <p className="mt-2 text-lg font-bold text-slate-50 sm:text-2xl">{formatDecimal(desempenhoGeral.eficiencia)}</p>
              <p className="mt-1 text-xs text-slate-300">
                {desempenhoGeral.rankingPosicao
                  ? `${desempenhoGeral.rankingPosicao}º de ${desempenhoGeral.rankingTotal}`
                  : desempenhoGeral.participacoes < 5
                    ? 'Sem ranking (mín. 5 participações)'
                    : 'Sem ranking disponível'}
              </p>
            </article>

            <article className="rounded-xl border border-[#244357] bg-[#102536] p-3 lg:col-span-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-[#ff9a63]">Taxa de Vitória</p>
              <p className="mt-2 text-lg font-bold text-slate-50 sm:text-2xl">{formatPercent(taxaVitoria)}</p>
              <p className="mt-1 text-xs text-slate-300">{estatisticas.totalVitorias} vitórias em {estatisticas.totalParticipacoes} participações</p>
            </article>
          </div>

          {error ? <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">{error}</p> : null}
          {isLoading ? <p className="text-sm text-slate-300">Carregando histórico...</p> : null}

          <div className="space-y-2 md:hidden">
            {estatisticas.porTemporada.length === 0 ? (
              <p className="rounded-xl border border-[#244357] bg-[#102536] px-3 py-4 text-center text-sm text-slate-300">
                Nenhum registro encontrado para este jogador.
              </p>
            ) : (
              estatisticas.porTemporada.map((item) => {
                const saldoClass = item.saldoFinal >= 0 ? 'text-emerald-300' : 'text-rose-300';

                return (
                  <article key={item.temporadaId} className="rounded-xl border border-[#244357] bg-[#102536] p-3">
                    <p className="text-sm font-semibold text-slate-100">{item.nomeTemporada}</p>
                    <div className="mt-2 grid grid-cols-4 gap-2 text-xs">
                      <div className="rounded-lg border border-[#2f5268] bg-[#0f2230] px-2 py-1 text-slate-300">
                      Pontos<br />
                        <span className="font-semibold text-slate-100">{item.pontos}</span>
                      </div>
                      <div className="rounded-lg border border-[#2f5268] bg-[#0f2230] px-2 py-1 text-slate-300">
                      Part.<br />
                        <span className="font-semibold text-slate-100">{item.participacoes}</span>
                      </div>
                      <div className="rounded-lg border border-[#2f5268] bg-[#0f2230] px-2 py-1 text-slate-300">
                      Melhor<br />
                        <span className="font-semibold text-slate-100">{item.melhorColocacao ?? '-'}</span>
                      </div>
                      <div className="rounded-lg border border-[#2f5268] bg-[#0f2230] px-2 py-1 text-slate-300">
                        Saldo<br />
                        <span className={`font-semibold ${saldoClass}`}>{formatCurrency(item.saldoFinal)}</span>
                      </div>
                    </div>

                    <p className="mt-2 text-[11px] text-slate-400">
                      Premiações: <span className="text-emerald-300">{formatCurrency(item.premioRecebido)}</span> | Gastos:{' '}
                      <span className="text-rose-300">{formatCurrency(item.gastoTotal)}</span>
                    </p>
                  </article>
                );
              })
            )}
          </div>

          <section className="rounded-xl border border-[#244357] bg-[#102536] p-3 sm:p-4">
            <header className="mb-3">
              <h3 className="text-sm font-semibold text-slate-50 sm:text-base">Evolução nas últimas temporadas</h3>
              <p className="text-xs text-slate-300">Linha azul: eficiência (pontos/participações). Linha laranja: posição final.</p>
            </header>

            {!graficoEvolucao ? (
              <p className="rounded-lg border border-[#244357] bg-[#0f2230] px-3 py-3 text-sm text-slate-300">Dados insuficientes para gerar gráfico (mínimo de 2 temporadas com participação).</p>
            ) : (
              <div className="space-y-2">
                <svg viewBox={`0 0 ${graficoEvolucao.width} ${graficoEvolucao.height}`} className="h-52 w-full overflow-visible">
                  <line
                    x1={graficoEvolucao.paddingLeft}
                    y1={graficoEvolucao.height - graficoEvolucao.paddingBottom}
                    x2={graficoEvolucao.width - 16}
                    y2={graficoEvolucao.height - graficoEvolucao.paddingBottom}
                    stroke="#3e6278"
                    strokeWidth="1"
                  />

                  <path d={graficoEvolucao.pathEficiencia} fill="none" stroke="#38bdf8" strokeWidth="2.5" />
                  <path d={graficoEvolucao.pathPosicao} fill="none" stroke="#ff9a63" strokeWidth="2.5" />

                  {graficoEvolucao.pontosEficiencia.map((ponto, index) => (
                    <g key={`ef-${ponto.label}`}>
                      <circle cx={ponto.x} cy={ponto.y} r="3.5" fill="#38bdf8" />
                      <text x={ponto.x} y={ponto.y - 8} textAnchor="middle" fontSize="10" fill="#7dd3fc" fontWeight="700">
                        {formatDecimal(ponto.valor, 1)}
                      </text>
                      <text
                        x={ponto.x}
                        y={graficoEvolucao.height - 10}
                        textAnchor={index === 0 ? 'start' : index === graficoEvolucao.pontosEficiencia.length - 1 ? 'end' : 'middle'}
                        fontSize="10"
                        fill="#94a3b8"
                      >
                        {ponto.label}
                      </text>
                    </g>
                  ))}

                  {graficoEvolucao.pontosPosicao.map((ponto) => (
                    <g key={`pos-${ponto.label}`}>
                      <circle cx={ponto.x} cy={ponto.y} r="3.5" fill="#ff9a63" />
                      <text x={ponto.x} y={ponto.y + 14} textAnchor="middle" fontSize="10" fill="#ffd0b2" fontWeight="700">
                        {ponto.valor}º
                      </text>
                    </g>
                  ))}
                </svg>

                <div className="flex flex-wrap gap-2 text-xs text-slate-300">
                  <span className="inline-flex items-center gap-1 rounded-full border border-sky-400/30 bg-sky-400/10 px-2 py-1 text-sky-200">
                    <span className="h-2 w-2 rounded-full bg-sky-400" /> Eficiência
                  </span>
                  <span className="inline-flex items-center gap-1 rounded-full border border-[#ff9a63]/30 bg-[#ff9a63]/10 px-2 py-1 text-[#ffd0b2]">
                    <span className="h-2 w-2 rounded-full bg-[#ff9a63]" /> Posição final
                  </span>
                </div>
              </div>
            )}
          </section>

          <div className="hidden overflow-x-auto rounded-xl border border-[#244357] md:block">
            <table className="w-full min-w-[620px] border-collapse text-sm">
              <thead className="bg-[#0f2230] text-slate-200">
                <tr>
                  <th className="px-3 py-3 text-left font-semibold">Temporada</th>
                  <th className="px-3 py-3 text-right font-semibold">Pontos</th>
                  <th className="px-3 py-3 text-right font-semibold">Participações</th>
                  <th className="px-3 py-3 text-right font-semibold">Melhor Colocação</th>
                  <th className="px-3 py-3 text-right font-semibold">Premiações</th>
                  <th className="px-3 py-3 text-right font-semibold">Gastos</th>
                  <th className="px-3 py-3 text-right font-semibold">Saldo</th>
                </tr>
              </thead>

              <tbody>
                {estatisticas.porTemporada.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-3 py-6 text-center text-slate-300">
                      Nenhum registro encontrado para este jogador.
                    </td>
                  </tr>
                ) : (
                  estatisticas.porTemporada.map((item) => {
                    const saldoClass = item.saldoFinal >= 0 ? 'text-emerald-300' : 'text-rose-300';

                    return (
                      <tr key={item.temporadaId} className="border-t border-[#244357] text-slate-200">
                        <td className="px-3 py-3 font-medium text-slate-100">{item.nomeTemporada}</td>
                        <td className="px-3 py-3 text-right font-semibold">{item.pontos}</td>
                        <td className="px-3 py-3 text-right">{item.participacoes}</td>
                        <td className="px-3 py-3 text-right">{item.melhorColocacao ?? '-'}</td>
                        <td className="px-3 py-3 text-right text-emerald-300">{formatCurrency(item.premioRecebido)}</td>
                        <td className="px-3 py-3 text-right text-rose-300">{formatCurrency(item.gastoTotal)}</td>
                        <td className={`px-3 py-3 text-right font-semibold ${saldoClass}`}>{formatCurrency(item.saldoFinal)}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        <footer className="flex justify-end border-t border-[#244357] px-5 py-4 sm:px-6">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-[#315770] bg-[#102536] px-4 py-2 text-sm font-semibold text-slate-200 transition hover:border-[#ff9a63] hover:text-[#ffcfb2]"
          >
            Fechar
          </button>
        </footer>
      </section>
    </div>
  );
}
