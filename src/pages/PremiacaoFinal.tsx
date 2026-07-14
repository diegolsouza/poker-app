import { useEffect, useMemo, useState } from 'react';
import supabase from '../supabaseClient';
import {
  DEFAULT_POINTS_RULES,
  POSITION_KEYS,
  getPointsByPlacement,
  parsePointsRules,
} from '../utils/tournamentRules';

type Temporada = {
  id: number;
  codigo_temporada: string;
  ativa: boolean;
  data_inicio: string;
};

type Etapa = {
  id: number;
  codigo_etapa: string;
  data_etapa: string;
};

type Jogador = {
  id: number;
  nome: string;
};

type RegistroEtapa = {
  etapa_id: number;
  jogador_id: number;
  tipo_participante: 'jogador' | 'visitante';
  colocacao: number | null;
  rebuys: number | null;
  melhor_mao: boolean;
  outros_custos: number | null;
};

type RankingRow = {
  jogadorId: number;
  nome: string;
  pontosTotais: number;
  posicoes: Record<1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9, number>;
};

type PremiacaoProjecaoRow = {
  colocacao: 1 | 2 | 3 | 4 | 5;
  percentual: number;
  nome: string;
  valor: number;
};

type ResumoEtapaRow = {
  etapaId: number;
  codigoEtapa: string;
  dataEtapa: string;
  inscricoes: number;
  arrecadadoFinal: number;
  arrecadadoCaixinha: number;
};

type SaidaCaixinhaRow = {
  etapaId: number;
  etapaCodigo: string;
  nomeJogador: string;
  valor: number;
};

const PROJECAO_PERCENTUAIS: Array<{ colocacao: 1 | 2 | 3 | 4 | 5; percentual: number }> = [
  { colocacao: 1, percentual: 40 },
  { colocacao: 2, percentual: 25 },
  { colocacao: 3, percentual: 18 },
  { colocacao: 4, percentual: 11 },
  { colocacao: 5, percentual: 6 },
];

const VALOR_FINAL_POR_INSCRICAO = 8;
const VALOR_CAIXINHA_POR_INSCRICAO = 2;

function createEmptyPositions(): Record<1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9, number> {
  return { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0, 8: 0, 9: 0 };
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
  }).format(value);
}

function getMedalStyle(index: number): string {
  if (index === 0) return 'bg-amber-400/20 text-amber-200 ring-amber-400/40';
  if (index === 1) return 'bg-slate-300/20 text-slate-100 ring-slate-400/40';
  if (index === 2) return 'bg-orange-400/20 text-orange-200 ring-orange-400/40';
  return 'bg-slate-800/70 text-slate-100 ring-slate-700/70';
}

function formatOrdinal(colocacao: number): string {
  return `${colocacao}º`;
}

export default function PremiacaoFinal() {
  const [temporadas, setTemporadas] = useState<Temporada[]>([]);
  const [etapas, setEtapas] = useState<Etapa[]>([]);
  const [registros, setRegistros] = useState<RegistroEtapa[]>([]);
  const [jogadoresMap, setJogadoresMap] = useState<Record<number, string>>({});
  const [pointsRules, setPointsRules] = useState(DEFAULT_POINTS_RULES);

  const [temporadaSelecionada, setTemporadaSelecionada] = useState('');
  const [isLoadingBase, setIsLoadingBase] = useState(false);
  const [isLoadingDados, setIsLoadingDados] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadBaseData = async () => {
      setIsLoadingBase(true);
      setError(null);

      const [temporadasResult, jogadoresResult, configResult] = await Promise.all([
        supabase.from('temporadas').select('id, codigo_temporada, ativa, data_inicio').order('data_inicio', { ascending: false }),
        supabase.from('jogadores').select('id, nome').eq('ativo', true).order('nome', { ascending: true }),
        supabase.from('configuracoes').select('pontuacao_json').order('id', { ascending: false }).limit(1).maybeSingle(),
      ]);

      if (temporadasResult.error) {
        setError(`Erro ao carregar temporadas: ${temporadasResult.error.message}`);
      } else {
        const temporadasData = (temporadasResult.data ?? []) as Temporada[];
        setTemporadas(temporadasData);

        const ativa = temporadasData.find((item) => item.ativa);
        const inicial = ativa ?? temporadasData[0];
        if (inicial) {
          setTemporadaSelecionada(String(inicial.id));
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

      if (configResult.error) {
        setError(`Erro ao carregar configurações: ${configResult.error.message}`);
      } else {
        setPointsRules(parsePointsRules(configResult.data?.pontuacao_json));
      }

      setIsLoadingBase(false);
    };

    void loadBaseData();
  }, []);

  useEffect(() => {
    const loadDadosTemporada = async () => {
      if (!temporadaSelecionada) {
        setEtapas([]);
        setRegistros([]);
        return;
      }

      setIsLoadingDados(true);
      setError(null);

      const { data: etapasData, error: etapasError } = await supabase
        .from('etapas')
        .select('id, codigo_etapa, data_etapa')
        .eq('temporada_id', Number(temporadaSelecionada))
        .order('data_etapa', { ascending: true });

      if (etapasError) {
        setError(`Erro ao carregar etapas da temporada: ${etapasError.message}`);
        setEtapas([]);
        setRegistros([]);
        setIsLoadingDados(false);
        return;
      }

      const etapaRows = (etapasData ?? []) as Etapa[];
      setEtapas(etapaRows);

      const etapaIds = etapaRows.map((etapa) => etapa.id);
      if (etapaIds.length === 0) {
        setRegistros([]);
        setIsLoadingDados(false);
        return;
      }

      const { data: registrosData, error: registrosError } = await supabase
        .from('registros_etapa')
        .select('etapa_id, jogador_id, tipo_participante, colocacao, rebuys, melhor_mao, outros_custos')
        .in('etapa_id', etapaIds);

      if (registrosError) {
        setError(`Erro ao carregar registros da temporada: ${registrosError.message}`);
        setRegistros([]);
      } else {
        setRegistros((registrosData ?? []) as RegistroEtapa[]);
      }

      setIsLoadingDados(false);
    };

    void loadDadosTemporada();
  }, [temporadaSelecionada]);

  const ranking = useMemo(() => {
    const map = new Map<number, RankingRow>();

    for (const registro of registros) {
      if (registro.tipo_participante !== 'jogador') continue;

      if (!map.has(registro.jogador_id)) {
        map.set(registro.jogador_id, {
          jogadorId: registro.jogador_id,
          nome: jogadoresMap[registro.jogador_id] ?? `Jogador #${registro.jogador_id}`,
          pontosTotais: 0,
          posicoes: createEmptyPositions(),
        });
      }

      const row = map.get(registro.jogador_id);
      if (!row) continue;

      row.pontosTotais += getPointsByPlacement(registro.colocacao, pointsRules);
      if (registro.melhor_mao) {
        row.pontosTotais += pointsRules.bonusMelhorMao;
      }

      if (registro.colocacao && registro.colocacao >= 1 && registro.colocacao <= 9) {
        row.posicoes[registro.colocacao as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9] += 1;
      }
    }

    return Array.from(map.values()).sort((a, b) => {
      if (b.pontosTotais !== a.pontosTotais) {
        return b.pontosTotais - a.pontosTotais;
      }

      for (const posicao of POSITION_KEYS) {
        const diff = b.posicoes[posicao] - a.posicoes[posicao];
        if (diff !== 0) {
          return diff;
        }
      }

      return a.nome.localeCompare(b.nome, 'pt-BR');
    });
  }, [jogadoresMap, pointsRules, registros]);

  const resumo = useMemo(() => {
    const registrosJogadores = registros.filter((r) => r.tipo_participante === 'jogador');
    const totalInscricoes = registrosJogadores.length;
    const totalPremiacaoFinal = totalInscricoes * VALOR_FINAL_POR_INSCRICAO;
    const totalCaixinha = totalInscricoes * VALOR_CAIXINHA_POR_INSCRICAO;

    const rankingTop5 = ranking.slice(0, 5);

    const projecaoPagamentos: PremiacaoProjecaoRow[] = PROJECAO_PERCENTUAIS.map((item, index) => {
      const jogador = rankingTop5[index];
      return {
        colocacao: item.colocacao,
        percentual: item.percentual,
        nome: jogador?.nome ?? 'A definir',
        valor: (totalPremiacaoFinal * item.percentual) / 100,
      };
    });

    const registrosPorEtapa = new Map<number, number>();
    for (const registro of registrosJogadores) {
      registrosPorEtapa.set(registro.etapa_id, (registrosPorEtapa.get(registro.etapa_id) ?? 0) + 1);
    }

    const resumoPorEtapa: ResumoEtapaRow[] = etapas.map((etapa) => {
      const inscricoes = registrosPorEtapa.get(etapa.id) ?? 0;
      return {
        etapaId: etapa.id,
        codigoEtapa: etapa.codigo_etapa,
        dataEtapa: etapa.data_etapa,
        inscricoes,
        arrecadadoFinal: inscricoes * VALOR_FINAL_POR_INSCRICAO,
        arrecadadoCaixinha: inscricoes * VALOR_CAIXINHA_POR_INSCRICAO,
      };
    });

    const etapaCodigoMap = new Map<number, string>();
    etapas.forEach((etapa) => {
      etapaCodigoMap.set(etapa.id, etapa.codigo_etapa);
    });

    const saidasCaixinha: SaidaCaixinhaRow[] = registros
      .filter((registro) => Number(registro.outros_custos ?? 0) > 0)
      .map((registro) => ({
        etapaId: registro.etapa_id,
        etapaCodigo: etapaCodigoMap.get(registro.etapa_id) ?? `Etapa #${registro.etapa_id}`,
        nomeJogador: jogadoresMap[registro.jogador_id] ?? `Jogador #${registro.jogador_id}`,
        valor: Number(registro.outros_custos ?? 0),
      }))
      .sort((a, b) => {
        if (a.etapaCodigo !== b.etapaCodigo) {
          return a.etapaCodigo.localeCompare(b.etapaCodigo, 'pt-BR');
        }

        if (b.valor !== a.valor) {
          return b.valor - a.valor;
        }

        return a.nomeJogador.localeCompare(b.nomeJogador, 'pt-BR');
      });

    const totalSaidasCaixinha = saidasCaixinha.reduce((sum, item) => sum + item.valor, 0);
    const saldoCaixinha = totalCaixinha - totalSaidasCaixinha;

    return {
      totalInscricoes,
      totalPremiacaoFinal,
      totalCaixinha,
      totalSaidasCaixinha,
      saldoCaixinha,
      projecaoPagamentos,
      resumoPorEtapa,
      saidasCaixinha,
    };
  }, [etapas, jogadoresMap, ranking, registros]);

  const carregando = isLoadingBase || isLoadingDados;

  return (
    <main className="min-h-screen space-y-6 bg-[radial-gradient(circle_at_top,rgba(255,94,0,0.08),transparent_24%),linear-gradient(180deg,#061019_0%,#07131d_40%,#081723_100%)] px-4 py-8 sm:px-6 lg:px-8">
      <section className="rounded-2xl border border-slate-700/60 bg-gradient-to-br from-slate-950 via-slate-900 to-slate-800 p-5 shadow-[0_10px_30px_rgba(2,6,23,0.35)]">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Temporada</p>
            <h1 className="mt-1 text-2xl font-bold text-slate-50">Premiação Final</h1>
            <p className="mt-1 hidden text-sm text-slate-300 md:block">
              Acumulado da temporada para prêmio final e caixinha com projeção do Top 5.
            </p>
          </div>

          <label className="flex w-full max-w-xs flex-col gap-1 text-sm text-slate-200">
            Filtrar temporada
            <select
              value={temporadaSelecionada}
              onChange={(event) => setTemporadaSelecionada(event.target.value)}
              disabled={isLoadingBase || temporadas.length === 0}
              className="h-11 rounded-lg border border-slate-600 bg-slate-900 px-3 text-slate-100 outline-none transition focus:border-emerald-400"
            >
              {temporadas.length === 0 ? <option value="">Sem temporadas</option> : null}
              {temporadas.map((temporada) => (
                <option key={temporada.id} value={temporada.id}>
                  {temporada.codigo_temporada} {temporada.ativa ? '(Ativa)' : ''}
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>

      {error ? <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</p> : null}

      <section className="grid gap-4 md:grid-cols-4">
        <article className="rounded-2xl border border-[#2f5f4f] bg-[#0b1a25] p-5 shadow-[0_12px_28px_rgba(2,6,23,0.3)]">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-300">Premiação Final</p>
          <p className="mt-2 text-3xl font-bold text-emerald-200">{formatCurrency(resumo.totalPremiacaoFinal)}</p>
          <p className="mt-2 text-sm text-emerald-100/85">Arrecadado com R$ 8 por inscrição de jogador.</p>
        </article>

        <article className="rounded-2xl border border-[#2d4659] bg-[#0b1a25] p-5 shadow-[0_12px_28px_rgba(2,6,23,0.3)]">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-sky-300">Caixinha do Grupo</p>
          <p className="mt-2 text-3xl font-bold text-slate-100">{formatCurrency(resumo.saldoCaixinha)}</p>
          <p className="mt-2 text-sm text-slate-300">Saldo líquido: arrecadação - saídas de Outros Custos (pode ficar negativo).</p>
        </article>

        <article className="rounded-2xl border border-[#2d4659] bg-[#0b1a25] p-5 shadow-[0_12px_28px_rgba(2,6,23,0.3)]">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-300">Inscrições / Buy-ins</p>
          <p className="mt-2 text-3xl font-bold text-slate-100">{resumo.totalInscricoes}</p>
          <p className="mt-2 text-sm text-slate-300">Total de participações de jogadores na temporada.</p>
        </article>

        <article className="rounded-2xl border border-[#5b3a3a] bg-[#0b1a25] p-5 shadow-[0_12px_28px_rgba(2,6,23,0.3)]">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-rose-300">Saídas da Caixinha</p>
          <p className="mt-2 text-3xl font-bold text-rose-200">{formatCurrency(resumo.totalSaidasCaixinha)}</p>
          <p className="mt-2 text-sm text-slate-300">Total usado para cobrir Outros Custos.</p>
        </article>
      </section>

      <section className="grid gap-6 xl:grid-cols-2">
        <article className="rounded-2xl border border-[#244357] bg-[#081723]/92 shadow-[0_18px_45px_rgba(3,8,14,0.42)]">
          <header className="flex items-center justify-between border-b border-[#244357] px-4 py-3 sm:px-6">
            <h2 className="text-lg font-semibold text-slate-50">Projeção de Pagamento (Top 5)</h2>
            {carregando ? <span className="text-sm text-slate-300">Carregando...</span> : null}
          </header>

          <div className="space-y-2 p-4 md:hidden">
            {resumo.projecaoPagamentos.map((item, index) => (
              <article key={item.colocacao} className="rounded-xl border border-[#244357] bg-[#0b1a25] p-3">
                <div className="flex items-center justify-between gap-3">
                  <span className={`inline-flex min-w-10 items-center justify-center rounded-full px-2 py-1 text-xs font-bold ring-1 ${getMedalStyle(index)}`}>
                    {formatOrdinal(item.colocacao)}
                  </span>
                  <span className="text-xs text-slate-300">{item.percentual}%</span>
                </div>
                <p className="mt-2 truncate text-sm font-semibold text-slate-100">{item.nome}</p>
                <p className="mt-1 text-sm text-emerald-300">{formatCurrency(item.valor)}</p>
              </article>
            ))}
          </div>

          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[540px] border-collapse text-sm">
              <thead className="bg-[#0f2230] text-slate-200">
                <tr>
                  <th className="px-3 py-3 text-left font-semibold">Colocação</th>
                  <th className="px-3 py-3 text-left font-semibold">Jogador Atual</th>
                  <th className="px-3 py-3 text-right font-semibold">Percentual</th>
                  <th className="px-3 py-3 text-right font-semibold">Valor Projetado</th>
                </tr>
              </thead>

              <tbody>
                {resumo.projecaoPagamentos.map((item, index) => (
                  <tr key={item.colocacao} className="border-t border-[#1f3b4d] text-slate-200">
                    <td className="px-3 py-3">
                      <span className={`inline-flex min-w-12 items-center justify-center rounded-full px-2 py-1 text-xs font-bold ring-1 ${getMedalStyle(index)}`}>
                        {formatOrdinal(item.colocacao)}
                      </span>
                    </td>
                    <td className="px-3 py-3 font-medium text-slate-100">{item.nome}</td>
                    <td className="px-3 py-3 text-right">{item.percentual}%</td>
                    <td className="px-3 py-3 text-right font-semibold text-slate-100">{formatCurrency(item.valor)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>

        <article className="rounded-2xl border border-[#244357] bg-[#081723]/92 shadow-[0_18px_45px_rgba(3,8,14,0.42)]">
          <header className="border-b border-[#244357] px-4 py-3 sm:px-6">
            <h2 className="text-lg font-semibold text-slate-50">Resumo por Etapa</h2>
            <p className="mt-1 text-sm text-slate-300">Histórico de arrecadação para prêmio final e caixinha.</p>
          </header>

          <div className="space-y-2 p-4 md:hidden">
            {resumo.resumoPorEtapa.length === 0 ? (
              <p className="rounded-xl border border-[#244357] bg-[#0b1a25] px-3 py-4 text-center text-sm text-slate-400">
                Nenhuma etapa encontrada para a temporada selecionada.
              </p>
            ) : (
              resumo.resumoPorEtapa.map((item) => (
                <article key={item.etapaId} className="rounded-xl border border-[#244357] bg-[#0b1a25] p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-slate-100">{item.codigoEtapa}</p>
                      <p className="text-xs text-slate-400">{new Date(item.dataEtapa).toLocaleDateString('pt-BR')}</p>
                    </div>
                    <span className="rounded-md border border-[#2b4758] bg-[#0e2432] px-2 py-0.5 text-xs text-slate-200">{item.inscricoes} insc.</span>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                    <div className="rounded-md border border-[#2b4758] bg-[#0e2432] px-2 py-1 text-slate-300">
                      Prêmio Final<br />
                      <span className="font-semibold text-slate-100">{formatCurrency(item.arrecadadoFinal)}</span>
                    </div>
                    <div className="rounded-md border border-[#2b4758] bg-[#0e2432] px-2 py-1 text-slate-300">
                      Caixinha<br />
                      <span className="font-semibold text-slate-100">{formatCurrency(item.arrecadadoCaixinha)}</span>
                    </div>
                  </div>
                </article>
              ))
            )}
          </div>

          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[600px] border-collapse text-sm">
              <thead className="bg-[#0f2230] text-slate-200">
                <tr>
                  <th className="px-3 py-3 text-left font-semibold">Etapa</th>
                  <th className="px-3 py-3 text-left font-semibold">Data</th>
                  <th className="px-3 py-3 text-right font-semibold">Inscrições</th>
                  <th className="px-3 py-3 text-right font-semibold">Prêmio Final</th>
                  <th className="px-3 py-3 text-right font-semibold">Caixinha</th>
                </tr>
              </thead>

              <tbody>
                {resumo.resumoPorEtapa.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-3 py-8 text-center text-slate-400">
                      Nenhuma etapa encontrada para a temporada selecionada.
                    </td>
                  </tr>
                ) : (
                  resumo.resumoPorEtapa.map((item) => (
                    <tr key={item.etapaId} className="border-t border-[#1f3b4d] text-slate-200">
                      <td className="px-3 py-3 font-medium text-slate-100">{item.codigoEtapa}</td>
                      <td className="px-3 py-3">{new Date(item.dataEtapa).toLocaleDateString('pt-BR')}</td>
                      <td className="px-3 py-3 text-right">{item.inscricoes}</td>
                      <td className="px-3 py-3 text-right font-semibold text-slate-100">{formatCurrency(item.arrecadadoFinal)}</td>
                      <td className="px-3 py-3 text-right">{formatCurrency(item.arrecadadoCaixinha)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </article>
      </section>

      <section className="rounded-2xl border border-[#244357] bg-[#081723]/92 shadow-[0_18px_45px_rgba(3,8,14,0.42)]">
        <header className="border-b border-[#244357] px-4 py-3 sm:px-6">
          <h2 className="text-lg font-semibold text-slate-50">Saídas da Caixinha por Outros Custos</h2>
          <p className="mt-1 text-sm text-slate-300">Detalhamento por etapa e jogador (Etapa, Nome e Valor).</p>
        </header>

        <div className="space-y-2 p-4 md:hidden">
          {resumo.saidasCaixinha.length === 0 ? (
            <p className="rounded-xl border border-[#244357] bg-[#0b1a25] px-3 py-4 text-center text-sm text-slate-400">
              Nenhuma saída da caixinha registrada nesta temporada.
            </p>
          ) : (
            resumo.saidasCaixinha.map((item) => (
              <article key={`${item.etapaId}-${item.nomeJogador}-${item.valor}`} className="rounded-xl border border-[#244357] bg-[#0b1a25] p-3">
                <p className="text-xs text-slate-400">{item.etapaCodigo}</p>
                <p className="mt-1 text-sm font-semibold text-slate-100">{item.nomeJogador}</p>
                <p className="mt-1 text-sm font-semibold text-rose-300">{formatCurrency(item.valor)}</p>
              </article>
            ))
          )}
        </div>

        <div className="hidden overflow-x-auto md:block">
          <table className="w-full min-w-[600px] border-collapse text-sm">
            <thead className="bg-[#0f2230] text-slate-200">
              <tr>
                <th className="px-3 py-3 text-left font-semibold">Etapa</th>
                <th className="px-3 py-3 text-left font-semibold">Nome</th>
                <th className="px-3 py-3 text-right font-semibold">Valor</th>
              </tr>
            </thead>

            <tbody>
              {resumo.saidasCaixinha.length === 0 ? (
                <tr>
                  <td colSpan={3} className="px-3 py-8 text-center text-slate-400">
                    Nenhuma saída da caixinha registrada nesta temporada.
                  </td>
                </tr>
              ) : (
                resumo.saidasCaixinha.map((item) => (
                  <tr key={`${item.etapaId}-${item.nomeJogador}-${item.valor}`} className="border-t border-[#1f3b4d] text-slate-200">
                    <td className="px-3 py-3 font-medium text-slate-100">{item.etapaCodigo}</td>
                    <td className="px-3 py-3">{item.nomeJogador}</td>
                    <td className="px-3 py-3 text-right font-semibold text-rose-300">{formatCurrency(item.valor)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
