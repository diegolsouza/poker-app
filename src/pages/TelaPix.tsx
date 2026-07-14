import { useEffect, useMemo, useState } from 'react';
import supabase from '../supabaseClient';
import {
  DEFAULT_PRIZE_RULES,
  getPrizePercentagesForPlayers,
  parsePrizeRules,
} from '../utils/tournamentRules';

type Etapa = {
  id: number;
  codigo_etapa: string;
  data_etapa: string;
};

type Jogador = {
  id: number;
  nome: string;
};

type TipoParticipacao = 'jogador' | 'visitante';

type RegistroEtapa = {
  id: number;
  etapa_id: number;
  jogador_id: number;
  tipo_participante: TipoParticipacao;
  jantou: boolean;
  cozinheiro: boolean;
  melhor_mao: boolean;
  fez_addon: boolean;
  colocacao: number | null;
  rebuys: number | null;
  pagou_salao: number | null;
  pagou_janta: number | null;
  outros_custos: number | null;
};

type Configuracoes = {
  buy_in: number;
  rebuy: number;
  add_on: number;
  premiacao_json?: unknown;
};

type PrizeRow = {
  colocacao: number;
  percentual: number;
  valor: number;
};

type TabelaAcertoRow = {
  id: number;
  nome: string;
  valorFinalLiquido: number;
  premioColocacao: number;
  custoBuyIn: number;
  custoRebuy: number;
  custoAddon: number;
  cotaSalao: number;
  cotaJanta: number;
  reembolsoSalao: number;
  reembolsoJanta: number;
  outrosReembolsos: number;
  jantou: boolean;
  participacao: TipoParticipacao;
  melhorMao: boolean;
  colocacao: number | null;
  rebuys: number;
  addon: boolean;
  outros: number;
};

const BUY_IN_PADRAO = 50;
const REBUY_PADRAO = 50;
const ADDON_PADRAO = 50;
const TEMPORADA_POR_JOGADOR = 8;
const CAIXINHA_POR_JOGADOR = 2;

function toNumber(value: number | null | undefined): number {
  return value ?? 0;
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
  }).format(value);
}

function safeDivide(total: number, quantity: number): number {
  if (quantity <= 0) return 0;
  return total / quantity;
}

function boolMark(value: boolean): string {
  return value ? '✅' : '';
}

function getGrupoOrdenacao(colocacao: number | null): number {
  if (colocacao === null) return 3;
  if (colocacao >= 1 && colocacao <= 9) return 1;
  if (colocacao >= 10) return 2;
  return 4;
}

function getResumoContaItens(row: TabelaAcertoRow): Array<{ label: string; valor: number }> {
  return [
    { label: 'Janta', valor: -row.cotaJanta },
    { label: 'Salão', valor: -row.cotaSalao },
    { label: 'Buy-in', valor: -row.custoBuyIn },
    { label: row.rebuys === 1 ? '1x Rebuy' : `${row.rebuys}x Rebuys`, valor: -row.custoRebuy },
    { label: 'Add-on', valor: -row.custoAddon },
    { label: 'Premiação', valor: row.premioColocacao },
    { label: 'Reembolso custo salão', valor: row.reembolsoSalao },
    { label: 'Reembolso custo janta', valor: row.reembolsoJanta },
  ].filter((item) => Math.abs(item.valor) > 0.0001);
}

export default function TelaPix() {
  const [etapas, setEtapas] = useState<Etapa[]>([]);
  const [jogadoresMap, setJogadoresMap] = useState<Record<number, string>>({});
  const [registros, setRegistros] = useState<RegistroEtapa[]>([]);
  const [configuracoes, setConfiguracoes] = useState<Configuracoes>({
    buy_in: BUY_IN_PADRAO,
    rebuy: REBUY_PADRAO,
    add_on: ADDON_PADRAO,
  });
  const [premiacaoRules, setPremiacaoRules] = useState(DEFAULT_PRIZE_RULES);

  const [etapaSelecionada, setEtapaSelecionada] = useState('');
  const [isLoadingEtapas, setIsLoadingEtapas] = useState(false);
  const [isLoadingRegistros, setIsLoadingRegistros] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [participanteSelecionadoId, setParticipanteSelecionadoId] = useState<number | null>(null);
  const [isContaEtapaExpanded, setIsContaEtapaExpanded] = useState(false);

  useEffect(() => {
    const carregarBase = async () => {
      setIsLoadingEtapas(true);
      setError(null);

      const [etapasResult, jogadoresResult] = await Promise.all([
        supabase.from('etapas').select('id, codigo_etapa, data_etapa').order('data_etapa', { ascending: false }),
        supabase.from('jogadores').select('id, nome').eq('ativo', true).order('nome', { ascending: true }),
      ]);

      const { data: configData, error: configError } = await supabase
        .from('configuracoes')
        .select('buy_in, rebuy, add_on, premiacao_json')
        .order('id', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (etapasResult.error) {
        setError(`Erro ao carregar etapas: ${etapasResult.error.message}`);
      } else {
        const etapasData = (etapasResult.data ?? []) as Etapa[];
        setEtapas(etapasData);
        if (etapasData.length > 0) {
          setEtapaSelecionada(String(etapasData[0].id));
        }
      }

      if (jogadoresResult.error) {
        setError(`Erro ao carregar jogadores: ${jogadoresResult.error.message}`);
      } else {
        const map: Record<number, string> = {};
        ((jogadoresResult.data ?? []) as Jogador[]).forEach((jogador) => {
          map[jogador.id] = jogador.nome;
        });
        setJogadoresMap(map);
      }

      if (configError) {
        setError(`Erro ao carregar configuracoes: ${configError.message}`);
      } else if (configData) {
        setConfiguracoes({
          buy_in: Number(configData.buy_in ?? BUY_IN_PADRAO),
          rebuy: Number(configData.rebuy ?? REBUY_PADRAO),
          add_on: Number(configData.add_on ?? ADDON_PADRAO),
          premiacao_json: configData.premiacao_json,
        });
        setPremiacaoRules(parsePrizeRules(configData.premiacao_json));
      }

      setIsLoadingEtapas(false);
    };

    void carregarBase();
  }, []);

  useEffect(() => {
    const carregarRegistros = async () => {
      if (!etapaSelecionada) {
        setRegistros([]);
        return;
      }

      setIsLoadingRegistros(true);
      setError(null);

      const { data, error: registrosError } = await supabase
        .from('registros_etapa')
        .select(
          'id, etapa_id, jogador_id, tipo_participante, jantou, cozinheiro, melhor_mao, fez_addon, colocacao, rebuys, pagou_salao, pagou_janta, outros_custos',
        )
        .eq('etapa_id', Number(etapaSelecionada));

      if (registrosError) {
        setError(`Erro ao carregar registros da etapa: ${registrosError.message}`);
        setRegistros([]);
      } else {
        setRegistros((data ?? []) as RegistroEtapa[]);
      }

      setIsLoadingRegistros(false);
    };

    void carregarRegistros();
  }, [etapaSelecionada]);

  const calculos = useMemo(() => {
    const totalParticipantes = registros.length;
    const totalJogadores = registros.filter((r) => r.tipo_participante === 'jogador').length;
    const totalVisitantes = totalParticipantes - totalJogadores;
    const totalJantaram = registros.filter((r) => r.jantou).length;

    const totalPagouSalao = registros.reduce((sum, r) => sum + toNumber(r.pagou_salao), 0);
    const totalPagouJanta = registros.reduce((sum, r) => sum + toNumber(r.pagou_janta), 0);
    const totalOutrosCustos = registros.reduce((sum, r) => sum + toNumber(r.outros_custos), 0);

    const pagadoresSalao = Array.from(
      new Set(
        registros
          .filter((r) => toNumber(r.pagou_salao) > 0)
          .map((r) => jogadoresMap[r.jogador_id] ?? `Jogador #${r.jogador_id}`),
      ),
    );

    const pagadoresJanta = Array.from(
      new Set(
        registros
          .filter((r) => toNumber(r.pagou_janta) > 0)
          .map((r) => jogadoresMap[r.jogador_id] ?? `Jogador #${r.jogador_id}`),
      ),
    );

    const totalRebuys = registros.reduce((sum, r) => sum + toNumber(r.rebuys), 0);
    const totalAddons = registros.filter((r) => r.fez_addon).length;

    const qtdRateioSalao = registros.filter((r) => r.tipo_participante === 'jogador').length;
    const qtdRateioJanta = registros.filter((r) => r.jantou && !r.cozinheiro).length;

    const rateioSalaoPorPessoa = safeDivide(totalPagouSalao, qtdRateioSalao);
    const rateioJantaPorPessoa = safeDivide(totalPagouJanta, qtdRateioJanta);

    const totalEntradasBuyIn = totalJogadores * configuracoes.buy_in;
    const totalEntradasRebuy = totalRebuys * configuracoes.rebuy;
    const totalEntradasAddon = totalAddons * configuracoes.add_on;
    const totalEntradasRateioSalao = rateioSalaoPorPessoa * qtdRateioSalao;
    const totalEntradasRateioJanta = rateioJantaPorPessoa * qtdRateioJanta;
    const totalEntradasEtapa =
      totalEntradasBuyIn +
      totalEntradasRebuy +
      totalEntradasAddon +
      totalEntradasRateioSalao +
      totalEntradasRateioJanta;

    const totalSaidasSalao = totalPagouSalao;
    const totalSaidasJanta = totalPagouJanta;

    const acumuladoTemporada = totalJogadores * TEMPORADA_POR_JOGADOR;
    const acumuladoCaixinha = totalJogadores * CAIXINHA_POR_JOGADOR;

    const premiacaoTotal =
      totalJogadores * (configuracoes.buy_in - TEMPORADA_POR_JOGADOR - CAIXINHA_POR_JOGADOR) +
      totalRebuys * configuracoes.rebuy +
      totalAddons * configuracoes.add_on;

    const percentuaisPremiacao = getPrizePercentagesForPlayers(totalJogadores, premiacaoRules);
    const premiosPorColocacao: PrizeRow[] = percentuaisPremiacao
      .map((percentual, index) => ({
        colocacao: index + 1,
        percentual,
        valor: (premiacaoTotal * percentual) / 100,
      }))
      .filter((premio) => premio.percentual > 0);

    const totalSaidasPremiacaoRodada = premiosPorColocacao.reduce((sum, premio) => sum + premio.valor, 0);
    const totalSaidasEtapa = totalSaidasSalao + totalSaidasJanta + totalSaidasPremiacaoRodada;
    const saldoContaEtapa = totalEntradasEtapa - totalSaidasEtapa;
    const reservaEsperadaAcumulados = acumuladoTemporada + acumuladoCaixinha;
    const diferencaConferencia = saldoContaEtapa - reservaEsperadaAcumulados;

    const premioPorColocacaoMap = new Map<number, number>();
    premiosPorColocacao.forEach((premio) => {
      premioPorColocacaoMap.set(premio.colocacao, premio.valor);
    });

    const tabelaAcertos: TabelaAcertoRow[] = registros.map((r) => {
      const colocacao = r.colocacao;
      const premioColocacao = colocacao ? premioPorColocacaoMap.get(colocacao) ?? 0 : 0;

      const reembolsoSalao = toNumber(r.pagou_salao);
      const reembolsoJanta = toNumber(r.pagou_janta);
      const outrosReembolsos = toNumber(r.outros_custos);

      const custoBuyIn = r.tipo_participante === 'jogador' ? configuracoes.buy_in : 0;
      const custoRebuy = toNumber(r.rebuys) * configuracoes.rebuy;
      const custoAddon = r.fez_addon ? configuracoes.add_on : 0;

      const cotaSalao = r.tipo_participante === 'jogador' ? rateioSalaoPorPessoa : 0;
      const cotaJanta = r.jantou && !r.cozinheiro ? rateioJantaPorPessoa : 0;

      const ganhos = premioColocacao + reembolsoSalao + reembolsoJanta + outrosReembolsos;
      const subtracoes = custoBuyIn + custoRebuy + custoAddon + cotaSalao + cotaJanta;
      const valorFinalLiquido = ganhos - subtracoes;

      return {
        id: r.id,
        nome: jogadoresMap[r.jogador_id] ?? `Jogador #${r.jogador_id}`,
        valorFinalLiquido,
        premioColocacao,
        custoBuyIn,
        custoRebuy,
        custoAddon,
        cotaSalao,
        cotaJanta,
        reembolsoSalao,
        reembolsoJanta,
        outrosReembolsos,
        jantou: r.jantou,
        participacao: r.tipo_participante,
        melhorMao: r.melhor_mao,
        colocacao,
        rebuys: toNumber(r.rebuys),
        addon: r.fez_addon,
        outros: outrosReembolsos,
      };
    });

    return {
      totalParticipantes,
      totalJogadores,
      totalVisitantes,
      totalJantaram,
      qtdRateioSalao,
      qtdRateioJanta,
      totalPagouSalao,
      totalPagouJanta,
      pagadoresSalao,
      pagadoresJanta,
      totalOutrosCustos,
      totalRebuys,
      totalAddons,
      totalEntradasBuyIn,
      totalEntradasRebuy,
      totalEntradasAddon,
      totalEntradasRateioSalao,
      totalEntradasRateioJanta,
      totalEntradasEtapa,
      totalSaidasSalao,
      totalSaidasJanta,
      totalSaidasPremiacaoRodada,
      totalSaidasEtapa,
      saldoContaEtapa,
      reservaEsperadaAcumulados,
      diferencaConferencia,
      rateioSalaoPorPessoa,
      rateioJantaPorPessoa,
      acumuladoTemporada,
      acumuladoCaixinha,
      premiacaoTotal,
      premiosPorColocacao,
      tabelaAcertos,
    };
  }, [configuracoes, jogadoresMap, premiacaoRules, registros]);

  const carregando = isLoadingEtapas || isLoadingRegistros;

  const tabelaAcertosOrdenada = useMemo(() => {
    return [...calculos.tabelaAcertos].sort((a, b) => {
      const grupoA = getGrupoOrdenacao(a.colocacao);
      const grupoB = getGrupoOrdenacao(b.colocacao);

      if (grupoA !== grupoB) {
        return grupoA - grupoB;
      }

      if (grupoA === 1) {
        const colocacaoA = a.colocacao ?? 999;
        const colocacaoB = b.colocacao ?? 999;
        if (colocacaoA !== colocacaoB) {
          return colocacaoA - colocacaoB;
        }

        return b.valorFinalLiquido - a.valorFinalLiquido;
      }

      if (grupoA === 2) {
        if (b.valorFinalLiquido !== a.valorFinalLiquido) {
          return b.valorFinalLiquido - a.valorFinalLiquido;
        }

        return a.nome.localeCompare(b.nome, 'pt-BR');
      }

      return a.nome.localeCompare(b.nome, 'pt-BR');
    });
  }, [calculos.tabelaAcertos]);

  const participanteSelecionado = useMemo(
    () => tabelaAcertosOrdenada.find((row) => row.id === participanteSelecionadoId) ?? null,
    [participanteSelecionadoId, tabelaAcertosOrdenada],
  );

  const itensResumoConta = useMemo(() => {
    if (!participanteSelecionado) {
      return [];
    }

    return getResumoContaItens(participanteSelecionado);
  }, [participanteSelecionado]);

  const totaisResumoConta = useMemo(() => {
    if (!participanteSelecionado) {
      return {
        totalGanhos: 0,
        totalCustos: 0,
        saldoEtapa: 0,
        totalExtrasCaixinha: 0,
        resultadoFinalParticipante: 0,
      };
    }

    const totalGanhosEtapa =
      participanteSelecionado.premioColocacao +
      participanteSelecionado.reembolsoSalao +
      participanteSelecionado.reembolsoJanta;

    const totalCustos =
      participanteSelecionado.custoBuyIn +
      participanteSelecionado.custoRebuy +
      participanteSelecionado.custoAddon +
      participanteSelecionado.cotaSalao +
      participanteSelecionado.cotaJanta;

    const saldoEtapa = totalGanhosEtapa - totalCustos;
    const totalExtrasCaixinha = participanteSelecionado.outrosReembolsos;
    const totalGanhos = totalGanhosEtapa + totalExtrasCaixinha;
    const resultadoFinalParticipante = saldoEtapa + totalExtrasCaixinha;

    return {
      totalGanhos,
      totalCustos,
      saldoEtapa,
      totalExtrasCaixinha,
      resultadoFinalParticipante,
    };
  }, [participanteSelecionado]);

  const contaEtapaFechou = useMemo(() => Math.abs(calculos.diferencaConferencia) <= 0.01, [calculos.diferencaConferencia]);

  useEffect(() => {
    if (!participanteSelecionado) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setParticipanteSelecionadoId(null);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [participanteSelecionado]);

  const abrirResumoConta = (rowId: number) => {
    setParticipanteSelecionadoId(rowId);
  };

  const fecharResumoConta = () => {
    setParticipanteSelecionadoId(null);
  };

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,rgba(255,94,0,0.08),transparent_24%),linear-gradient(180deg,#061019_0%,#07131d_40%,#081723_100%)] px-4 py-8 sm:px-6 lg:px-8">
      <section className="mx-auto w-full max-w-[1700px] space-y-6">
        <header className="flex flex-col gap-3 rounded-3xl border border-[#244357] bg-[#081723]/92 p-5 shadow-[0_18px_45px_rgba(3,8,14,0.42)] backdrop-blur sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-50">Financeiro da Etapa</h1>
            <p className="mt-1 hidden text-sm text-slate-300 sm:block">
              Visualize os acertos da rodada com base nos registros da etapa selecionada.
            </p>
          </div>

          <label className="flex w-full max-w-xs flex-col gap-1 text-sm text-slate-200">
            Etapa
            <select
              value={etapaSelecionada}
              onChange={(event) => setEtapaSelecionada(event.target.value)}
              className="h-11 rounded-lg border border-[#244357] bg-[#0b1a25] px-3 text-slate-50 outline-none transition focus:border-[#ff5e00]"
              disabled={isLoadingEtapas || etapas.length === 0}
            >
              {etapas.length === 0 ? <option value="">Sem etapas</option> : null}
              {etapas.map((etapa) => (
                <option key={etapa.id} value={etapa.id}>
                  {etapa.codigo_etapa} - {new Date(etapa.data_etapa).toLocaleDateString('pt-BR')}
                </option>
              ))}
            </select>
          </label>
        </header>

        {error ? <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</p> : null}

        <section className="rounded-3xl border border-[#244357] bg-[#081723]/92 p-5 shadow-[0_18px_45px_rgba(3,8,14,0.42)]">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-slate-50">💰 Resumo Financeiro da Rodada</h2>
            {carregando ? <span className="text-sm text-slate-300">Carregando...</span> : null}
          </div>

          <div className="grid grid-cols-2 gap-2 md:hidden">
            <article className="rounded-lg border border-[#244357] bg-[#0b1a25] p-2">
              <p className="text-[11px] text-slate-400">Participantes</p>
              <p className="text-base font-semibold text-slate-50">{calculos.totalParticipantes}</p>
            </article>
            <article className="rounded-lg border border-[#244357] bg-[#0b1a25] p-2">
              <p className="text-[11px] text-slate-400">Premiação</p>
              <p className="text-base font-semibold text-emerald-300">{formatCurrency(calculos.premiacaoTotal)}</p>
            </article>
            <article className="rounded-lg border border-[#244357] bg-[#0b1a25] p-2">
              <p className="text-[11px] text-slate-400">Rateio Salão</p>
              <p className="text-sm font-semibold text-slate-100">{formatCurrency(calculos.rateioSalaoPorPessoa)}</p>
            </article>
            <article className="rounded-lg border border-[#244357] bg-[#0b1a25] p-2">
              <p className="text-[11px] text-slate-400">Rateio Janta</p>
              <p className="text-sm font-semibold text-slate-100">{formatCurrency(calculos.rateioJantaPorPessoa)}</p>
            </article>

            <article className="col-span-2 rounded-lg border border-[#244357] bg-[#0b1a25] p-2">
              <button
                type="button"
                onClick={() => setIsContaEtapaExpanded((current) => !current)}
                className="flex w-full items-center justify-between text-left"
                aria-expanded={isContaEtapaExpanded}
              >
                <p className="text-[11px] font-semibold uppercase tracking-wide text-[#ff9a63]">🧾 Conta da Etapa</p>
                <span className="text-[11px] font-semibold text-slate-300">
                  {isContaEtapaExpanded ? 'Fechar ▲' : 'Abrir ▼'}
                </span>
              </button>

              {!isContaEtapaExpanded ? (
                <div className="mt-2 space-y-1 text-[11px] text-slate-300">
                  <p>Total entradas: {formatCurrency(calculos.totalEntradasEtapa)}</p>
                  <p>Total saídas: {formatCurrency(calculos.totalSaidasEtapa)}</p>
                  <p className="text-[10px] text-slate-400">Toque para detalhar e conferir fechamento.</p>
                </div>
              ) : (
                <>
                  <div className="mt-2 space-y-1 text-[11px] text-slate-300">
                    <p className="font-semibold text-emerald-300">Entradas</p>
                    <p>Buy-in: {formatCurrency(calculos.totalEntradasBuyIn)}</p>
                    <p>Rebuy: {formatCurrency(calculos.totalEntradasRebuy)}</p>
                    <p>Add-on: {formatCurrency(calculos.totalEntradasAddon)}</p>
                    <p>Rateio salão (recebido): {formatCurrency(calculos.totalEntradasRateioSalao)}</p>
                    <p>Rateio janta (recebido): {formatCurrency(calculos.totalEntradasRateioJanta)}</p>
                    <p className="font-semibold text-emerald-200">Total entradas: {formatCurrency(calculos.totalEntradasEtapa)}</p>
                  </div>

                  <div className="mt-2 space-y-1 text-[11px] text-slate-300">
                    <p className="font-semibold text-rose-300">Saídas</p>
                    <p>Janta: {formatCurrency(calculos.totalSaidasJanta)}</p>
                    <p>Salão: {formatCurrency(calculos.totalSaidasSalao)}</p>
                    <p>Premiações da rodada: {formatCurrency(calculos.totalSaidasPremiacaoRodada)}</p>
                    <p className="font-semibold text-rose-200">Total saídas: {formatCurrency(calculos.totalSaidasEtapa)}</p>
                  </div>

                  <div className="mt-2 space-y-1 text-[11px] text-slate-300">
                    <p className="font-semibold text-slate-100">Conferência</p>
                    <p>Saldo após entradas e saídas: {formatCurrency(calculos.saldoContaEtapa)}</p>
                    <p>Reserva esperada (Final + Caixinha): {formatCurrency(calculos.reservaEsperadaAcumulados)}</p>
                    <p>Saídas da caixinha (fora da etapa): {formatCurrency(calculos.totalOutrosCustos)}</p>
                    <p className={`font-semibold ${contaEtapaFechou ? 'text-emerald-300' : 'text-rose-300'}`}>
                      Status: {contaEtapaFechou ? 'FECHOU' : 'NÃO FECHOU'}
                    </p>
                    <p
                      className={`font-semibold ${
                        Math.abs(calculos.diferencaConferencia) < 0.01 ? 'text-emerald-300' : 'text-amber-300'
                      }`}
                    >
                      Diferença: {formatCurrency(calculos.diferencaConferencia)}
                    </p>
                  </div>

                  <p className="mt-2 text-[10px] text-slate-400">Custos Extras ficam fora da conta da etapa e saem da Caixinha do Grupo.</p>
                </>
              )}
            </article>
          </div>

          <div className="hidden gap-3 md:grid md:grid-cols-2 xl:grid-cols-4">
            <article className="rounded-xl border border-[#244357] bg-[#0b1a25] p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-[#ff9a63]">👥 Participantes</p>
              <p className="mt-2 text-2xl font-bold text-slate-50">{calculos.totalParticipantes}</p>
              <p className="mt-1 text-xs text-slate-300">🎯 {calculos.totalJogadores} | 👀 {calculos.totalVisitantes}</p>
            </article>

            <article className="rounded-xl border border-[#244357] bg-[#0b1a25] p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-[#ff9a63]">🏠 Salão</p>
              <p className="mt-2 text-lg font-bold text-slate-50">{formatCurrency(calculos.totalPagouSalao)}</p>
              <p className="mt-1 text-xs text-slate-300">Rateio: {formatCurrency(calculos.rateioSalaoPorPessoa)}</p>
              <p className="mt-1 break-words text-xs text-slate-400">
                Custeado por: {calculos.pagadoresSalao.length > 0 ? calculos.pagadoresSalao.join(', ') : '-'}
              </p>
            </article>

            <article className="rounded-xl border border-[#244357] bg-[#0b1a25] p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-[#ff9a63]">🍽️ Janta</p>
              <p className="mt-2 text-lg font-bold text-slate-50">{formatCurrency(calculos.totalPagouJanta)}</p>
              <p className="mt-1 text-xs text-slate-300">✅ {calculos.totalJantaram} | Rateio: {formatCurrency(calculos.rateioJantaPorPessoa)}</p>
              <p className="mt-1 break-words text-xs text-slate-400">
                Custeada por: {calculos.pagadoresJanta.length > 0 ? calculos.pagadoresJanta.join(', ') : '-'}
              </p>
            </article>

            <article className="rounded-xl border border-[#244357] bg-[#0b1a25] p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-[#ff9a63]">🏆 Premiação</p>
              <p className="mt-2 text-lg font-bold text-emerald-300">{formatCurrency(calculos.premiacaoTotal)}</p>
              <p className="mt-1 text-xs text-slate-300">Rb: {calculos.totalRebuys} | Add-on: {calculos.totalAddons}</p>
            </article>

            <article className="rounded-xl border border-[#244357] bg-[#0b1a25] p-3 sm:col-span-2 xl:col-span-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-[#ff9a63]">🎯 Faixas de Pagamento</p>
              <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-200">
                {calculos.premiosPorColocacao.map((premio) => (
                  <span key={premio.colocacao} className="rounded-md border border-[#2d4f66] bg-[#102536] px-2 py-1">
                    {premio.colocacao}º {premio.percentual}% {formatCurrency(premio.valor)}
                  </span>
                ))}
              </div>
            </article>

            <article className="rounded-xl border border-[#244357] bg-[#0b1a25] p-3 sm:col-span-2 xl:col-span-1">
              <p className="text-xs font-semibold uppercase tracking-wide text-[#ff9a63]">📦 Acumulados</p>
              <p className="mt-2 text-sm text-slate-200">🏁 Final: {formatCurrency(calculos.acumuladoTemporada)}</p>
              <p className="text-sm text-slate-200">🪙 Caixinha: {formatCurrency(calculos.acumuladoCaixinha)}</p>
            </article>

            <article className="rounded-xl border border-[#244357] bg-[#0b1a25] p-3 sm:col-span-2 xl:col-span-1">
              <button
                type="button"
                onClick={() => setIsContaEtapaExpanded((current) => !current)}
                className="flex w-full items-center justify-between text-left"
                aria-expanded={isContaEtapaExpanded}
              >
                <p className="text-xs font-semibold uppercase tracking-wide text-[#ff9a63]">🧾 Conta da Etapa</p>
                <span className="text-xs font-semibold text-slate-300">
                  {isContaEtapaExpanded ? 'Fechar detalhes ▲' : 'Abrir detalhes ▼'}
                </span>
              </button>

              {!isContaEtapaExpanded ? (
                <div className="mt-2 space-y-1 text-xs text-slate-300">
                  <p>Total entradas: {formatCurrency(calculos.totalEntradasEtapa)}</p>
                  <p>Total saídas: {formatCurrency(calculos.totalSaidasEtapa)}</p>
                  <p className="text-[11px] text-slate-400">Clique para detalhar e conferir o fechamento.</p>
                </div>
              ) : (
                <>
                  <div className="mt-2 space-y-1.5 text-xs text-slate-300">
                    <p className="font-semibold text-emerald-300">Entradas</p>
                    <p>Buy-in: {formatCurrency(calculos.totalEntradasBuyIn)}</p>
                    <p>Rebuy: {formatCurrency(calculos.totalEntradasRebuy)}</p>
                    <p>Add-on: {formatCurrency(calculos.totalEntradasAddon)}</p>
                    <p>Rateio salão (recebido): {formatCurrency(calculos.totalEntradasRateioSalao)}</p>
                    <p>Rateio janta (recebido): {formatCurrency(calculos.totalEntradasRateioJanta)}</p>
                    <p className="font-semibold text-emerald-200">Total entradas: {formatCurrency(calculos.totalEntradasEtapa)}</p>
                  </div>

                  <div className="mt-3 space-y-1.5 text-xs text-slate-300">
                    <p className="font-semibold text-rose-300">Saídas</p>
                    <p>Janta: {formatCurrency(calculos.totalSaidasJanta)}</p>
                    <p>Salão: {formatCurrency(calculos.totalSaidasSalao)}</p>
                    <p>Premiações da rodada: {formatCurrency(calculos.totalSaidasPremiacaoRodada)}</p>
                    <p className="font-semibold text-rose-200">Total saídas: {formatCurrency(calculos.totalSaidasEtapa)}</p>
                  </div>

                  <div className="mt-3 space-y-1.5 text-xs text-slate-300">
                    <p className="font-semibold text-slate-100">Conferência</p>
                    <p>Saldo após entradas e saídas: {formatCurrency(calculos.saldoContaEtapa)}</p>
                    <p>Reserva esperada (Final + Caixinha): {formatCurrency(calculos.reservaEsperadaAcumulados)}</p>
                    <p>Saídas da caixinha (fora da etapa): {formatCurrency(calculos.totalOutrosCustos)}</p>
                    <p className={`font-semibold ${contaEtapaFechou ? 'text-emerald-300' : 'text-rose-300'}`}>
                      Status: {contaEtapaFechou ? 'FECHOU' : 'NÃO FECHOU'}
                    </p>
                    <p
                      className={`font-semibold ${
                        Math.abs(calculos.diferencaConferencia) < 0.01 ? 'text-emerald-300' : 'text-amber-300'
                      }`}
                    >
                      Diferença da conferência: {formatCurrency(calculos.diferencaConferencia)}
                    </p>
                  </div>

                  <p className="mt-2 text-[11px] text-slate-400">Custos Extras ficam fora da conta da etapa e saem da Caixinha do Grupo.</p>
                </>
              )}
            </article>
          </div>
        </section>

        <section className="rounded-3xl border border-[#244357] bg-[#081723]/92 p-5 shadow-[0_18px_45px_rgba(3,8,14,0.42)]">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-slate-50">📋 Acertos dos Participantes</h2>
            {carregando ? <span className="text-sm text-slate-300">Carregando...</span> : null}
          </div>

          <div className="space-y-2 md:hidden">
            {calculos.tabelaAcertos.length === 0 ? (
              <p className="rounded-xl border border-[#244357] bg-[#0b1a25] px-3 py-4 text-center text-sm text-slate-300">
                Nenhum registro encontrado para esta etapa.
              </p>
            ) : (
              tabelaAcertosOrdenada.map((row) => (
                <article key={row.id} className="rounded-xl border border-[#244357] bg-[#0b1a25] p-3 text-sm">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <button
                        type="button"
                        onClick={() => abrirResumoConta(row.id)}
                        className="max-w-full truncate font-semibold text-left text-[#ff9a63] transition hover:text-[#ffb387]"
                      >
                        {row.nome}
                      </button>
                      <p className="text-xs text-slate-400">
                        {row.colocacao === null
                          ? 'Sem colocação'
                          : row.colocacao === 10
                            ? '10+'
                            : row.colocacao >= 1 && row.colocacao <= 9
                              ? `${row.colocacao}º lugar`
                              : `${row.colocacao}º`}
                      </p>
                    </div>
                    <span
                      className={`text-xs font-semibold ${
                        row.valorFinalLiquido > 0
                          ? 'text-emerald-400'
                          : row.valorFinalLiquido < 0
                            ? 'text-rose-400'
                            : 'text-slate-300'
                      }`}
                    >
                      {formatCurrency(row.valorFinalLiquido)}
                    </span>
                  </div>

                  <div className="mt-2 grid grid-cols-4 gap-1 text-[11px] text-slate-300">
                    <span className="rounded-md border border-[#2b4758] bg-[#0e2432] px-1 py-0.5 text-center">🍽️ {boolMark(row.jantou) || '-'}</span>
                    <span className="rounded-md border border-[#2b4758] bg-[#0e2432] px-1 py-0.5 text-center">{row.participacao === 'jogador' ? '🎯' : '👀'}</span>
                    <span className="rounded-md border border-[#2b4758] bg-[#0e2432] px-1 py-0.5 text-center">Rb {row.rebuys}</span>
                    <span className="rounded-md border border-[#2b4758] bg-[#0e2432] px-1 py-0.5 text-center">➕ {boolMark(row.addon) || '-'}</span>
                  </div>
                </article>
              ))
            )}
          </div>

            <div className="hidden overflow-x-auto md:block">
              <table className="min-w-[840px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-[#244357] text-left text-slate-200">
                    <th className="px-2 py-2 text-center font-semibold">🏁</th>
                    <th className="px-2 py-2 font-semibold">Nome</th>
                    <th className="px-2 py-2 font-semibold">Líquido</th>
                    <th className="px-2 py-2 text-center font-semibold">🍽️</th>
                    <th className="px-2 py-2 text-center font-semibold">Participação</th>
                    <th className="px-2 py-2 text-center font-semibold">M.Mão</th>
                    <th className="px-2 py-2 text-center font-semibold">Rb</th>
                    <th className="px-2 py-2 text-center font-semibold">➕</th>
                    <th className="px-2 py-2 text-right font-semibold">Custos Extras</th>
                  </tr>
                </thead>

                <tbody>
                  {calculos.tabelaAcertos.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="px-2 py-6 text-center text-slate-300">
                        Nenhum registro encontrado para esta etapa.
                      </td>
                    </tr>
                  ) : (
                    tabelaAcertosOrdenada.map((row) => (
                        <tr key={row.id} className="border-b border-[#244357] text-slate-200">
                          <td className="px-2 py-2 text-center">
                            {row.colocacao === null
                              ? ''
                              : row.colocacao === 10
                                ? '10+'
                                : row.colocacao >= 1 && row.colocacao <= 9
                                  ? `${row.colocacao}º`
                                  : row.colocacao}
                          </td>
                          <td className="px-2 py-2">
                            <button
                              type="button"
                              onClick={() => abrirResumoConta(row.id)}
                              className="text-left text-[#ff9a63] transition hover:text-[#ffb387]"
                            >
                              {row.nome}
                            </button>
                          </td>
                          <td
                            className={`px-2 py-2 font-semibold ${
                              row.valorFinalLiquido > 0
                                ? 'text-emerald-400'
                                : row.valorFinalLiquido < 0
                                  ? 'text-rose-400'
                                  : 'text-slate-600'
                            }`}
                          >
                            {formatCurrency(row.valorFinalLiquido)}
                          </td>
                          <td className="px-2 py-2 text-center">{boolMark(row.jantou)}</td>
                          <td className="px-2 py-2 text-center">{row.participacao === 'jogador' ? '🎯' : '👀'}</td>
                          <td className="px-2 py-2 text-center">{boolMark(row.melhorMao)}</td>
                          <td className="px-2 py-2 text-center">{row.rebuys}</td>
                          <td className="px-2 py-2 text-center">{boolMark(row.addon)}</td>
                          <td className={`px-2 py-2 text-right ${row.outros === 0 ? 'text-slate-600' : 'text-slate-100'}`}>
                            {formatCurrency(row.outros)}
                          </td>
                        </tr>
                      ))
                  )}
                </tbody>
              </table>
            </div>
        </section>
      </section>

      {participanteSelecionado ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-[#01060c]/75 p-3 backdrop-blur-[2px] sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-label={`Resumo das contas de ${participanteSelecionado.nome}`}>
          <button type="button" aria-label="Fechar resumo" className="absolute inset-0 cursor-default" onClick={fecharResumoConta} />

          <article className="relative z-10 w-full max-w-xl rounded-2xl border border-[#315770] bg-[#0b1a25] p-4 shadow-[0_24px_60px_rgba(0,0,0,0.45)] sm:p-5">
            <header className="mb-3 flex items-start justify-between gap-3 border-b border-[#244357] pb-3">
              <div>
                <h3 className="text-lg font-semibold text-slate-50">Resumo das contas</h3>
                <p className="text-sm text-slate-300">{participanteSelecionado.nome}</p>
              </div>

              <button
                type="button"
                onClick={fecharResumoConta}
                className="rounded-lg border border-[#315770] bg-[#102536] px-2.5 py-1.5 text-xs font-semibold text-slate-200 transition hover:border-[#ff9a63] hover:text-[#ffcfb2]"
              >
                Fechar
              </button>
            </header>

            <div className="max-h-[52vh] overflow-y-auto pr-1 sm:max-h-[60vh]">
              <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
                <div className="rounded-lg border border-[#2f5268] bg-[#102536] px-3 py-2">
                  <p className="text-[11px] uppercase tracking-wide text-slate-400">Total de custos</p>
                  <p className="mt-1 text-sm font-semibold text-rose-300">-{formatCurrency(totaisResumoConta.totalCustos)}</p>
                </div>
                <div className="rounded-lg border border-[#2f5268] bg-[#102536] px-3 py-2">
                  <p className="text-[11px] uppercase tracking-wide text-slate-400">Total de ganhos</p>
                  <p className="mt-1 text-sm font-semibold text-emerald-300">+{formatCurrency(totaisResumoConta.totalGanhos)}</p>
                </div>
                <div className="rounded-lg border border-[#2f5268] bg-[#102536] px-3 py-2">
                  <p className="text-[11px] uppercase tracking-wide text-slate-400">Saldo da etapa</p>
                  <p
                    className={`mt-1 text-sm font-semibold ${
                      totaisResumoConta.saldoEtapa > 0
                        ? 'text-emerald-300'
                        : totaisResumoConta.saldoEtapa < 0
                          ? 'text-rose-300'
                          : 'text-slate-200'
                    }`}
                  >
                    {formatCurrency(totaisResumoConta.saldoEtapa)}
                  </p>
                </div>
              </div>

              {itensResumoConta.length === 0 ? (
                <p className="rounded-lg border border-[#244357] bg-[#102536] px-3 py-3 text-sm text-slate-300">
                  Não há movimentações para exibir neste participante.
                </p>
              ) : (
                <ul className="space-y-2">
                  {itensResumoConta.map((item) => (
                    <li key={`${item.label}-${item.valor}`} className="flex items-center justify-between rounded-lg border border-[#244357] bg-[#102536] px-3 py-2 text-sm">
                      <span className="text-slate-200">{item.label}</span>
                      <span className={`font-semibold ${item.valor > 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
                        {item.valor > 0 ? '+' : '-'}
                        {formatCurrency(Math.abs(item.valor))}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <footer className="mt-4 border-t border-[#244357] pt-3">
              <div className="mb-2 flex items-center justify-between rounded-lg border border-[#2f5268] bg-[#102536] px-3 py-2">
                <span className="text-sm text-slate-300">Custos Extras (Caixinha do Grupo)</span>
                <span className="text-sm font-semibold text-sky-300">{formatCurrency(totaisResumoConta.totalExtrasCaixinha)}</span>
              </div>

              <div className="flex items-center justify-between rounded-lg bg-[#081723] px-3 py-2">
                <span className="text-sm text-slate-300">Resultado da conta da etapa</span>
                <span
                  className={`text-base font-semibold ${
                    totaisResumoConta.saldoEtapa > 0
                      ? 'text-emerald-300'
                      : totaisResumoConta.saldoEtapa < 0
                        ? 'text-rose-300'
                        : 'text-slate-200'
                  }`}
                >
                  {formatCurrency(totaisResumoConta.saldoEtapa)}
                </span>
              </div>

              <div className="mt-2 flex items-center justify-between rounded-lg border border-[#2f5268] bg-[#102536] px-3 py-2">
                <span className="text-sm text-slate-300">Resultado final do participante</span>
                <span
                  className={`text-base font-semibold ${
                    totaisResumoConta.resultadoFinalParticipante > 0
                      ? 'text-emerald-300'
                      : totaisResumoConta.resultadoFinalParticipante < 0
                        ? 'text-rose-300'
                        : 'text-slate-200'
                  }`}
                >
                  {formatCurrency(totaisResumoConta.resultadoFinalParticipante)}
                </span>
              </div>

              <p className="mt-2 text-[11px] text-slate-400">
                O valor de Custos Extras entra no resultado final do participante, mas é retirado da Caixinha e não entra no cálculo da etapa.
              </p>
            </footer>
          </article>
        </div>
      ) : null}
    </main>
  );
}