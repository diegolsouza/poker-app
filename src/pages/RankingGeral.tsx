import { useEffect, useMemo, useState } from 'react';
import ModalEstatisticas from '../components/ModalEstatisticas';
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
};

type RankingRow = {
  jogadorId: number;
  nome: string;
  pontosTotais: number;
  participacoes: number;
  rebuys: number;
  melhorMao: number;
  podios: number;
  posicoes: Record<1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9, number>;
};

type RankingMovement = {
  direction: 'up' | 'down' | 'same';
  delta: number;
};

function createEmptyPositions(): Record<1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9, number> {
  return { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0, 8: 0, 9: 0 };
}

function getPosicaoBadgeClass(index: number): string {
  if (index === 0) {
    return 'bg-amber-400/20 text-amber-200 ring-1 ring-amber-400/40';
  }

  if (index === 1) {
    return 'bg-slate-300/20 text-slate-100 ring-1 ring-slate-400/40';
  }

  if (index === 2) {
    return 'bg-orange-400/20 text-orange-200 ring-1 ring-orange-400/40';
  }

  return 'bg-slate-800/70 text-slate-200 ring-1 ring-slate-700/70';
}

function getLinhaDestaqueClass(index: number): string {
  if (index === 0) {
    return 'bg-gradient-to-r from-amber-500/10 to-transparent';
  }

  if (index === 1) {
    return 'bg-gradient-to-r from-slate-400/10 to-transparent';
  }

  if (index === 2) {
    return 'bg-gradient-to-r from-orange-500/10 to-transparent';
  }

  return '';
}

function formatOrdinal(colocacao: number): string {
  return `${colocacao}º`;
}

function getPositionCountStyle(count: number): string {
  if (count === 0) return 'border-[#2b4758] bg-[#0d2230] text-slate-500';
  if (count === 1) return 'border-[#3a5b70] bg-[#123042] text-slate-200';
  if (count <= 3) return 'border-amber-500/40 bg-amber-500/15 text-amber-200';
  return 'border-orange-500/40 bg-orange-500/15 text-orange-200';
}

function buildRankingRows(
  registros: RegistroEtapa[],
  jogadoresMap: Record<number, string>,
  pointsRules: typeof DEFAULT_POINTS_RULES,
): RankingRow[] {
  const map = new Map<number, RankingRow>();

  for (const registro of registros) {
    if (registro.tipo_participante !== 'jogador') {
      continue;
    }

    if (!map.has(registro.jogador_id)) {
      map.set(registro.jogador_id, {
        jogadorId: registro.jogador_id,
        nome: jogadoresMap[registro.jogador_id] ?? `Jogador #${registro.jogador_id}`,
        pontosTotais: 0,
        participacoes: 0,
        rebuys: 0,
        melhorMao: 0,
        podios: 0,
        posicoes: createEmptyPositions(),
      });
    }

    const row = map.get(registro.jogador_id);
    if (!row) continue;

    row.participacoes += 1;
    row.rebuys += registro.rebuys ?? 0;

    if (registro.melhor_mao) {
      row.melhorMao += 1;
      row.pontosTotais += pointsRules.bonusMelhorMao;
    }

    row.pontosTotais += getPointsByPlacement(registro.colocacao, pointsRules);

    if (registro.colocacao && registro.colocacao >= 1 && registro.colocacao <= 5) {
      row.podios += 1;
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

    if (b.podios !== a.podios) {
      return b.podios - a.podios;
    }

    if (b.participacoes !== a.participacoes) {
      return b.participacoes - a.participacoes;
    }

    return a.nome.localeCompare(b.nome, 'pt-BR');
  });
}

function getMovementIndicatorClass(movement: RankingMovement): string {
  if (movement.direction === 'up') {
    return 'text-emerald-300';
  }

  if (movement.direction === 'down') {
    return 'text-rose-300';
  }

  return 'text-blue-300';
}

export default function RankingGeral() {
  const [temporadas, setTemporadas] = useState<Temporada[]>([]);
  const [jogadoresMap, setJogadoresMap] = useState<Record<number, string>>({});
  const [registros, setRegistros] = useState<RegistroEtapa[]>([]);
  const [etapaIdsOrdenados, setEtapaIdsOrdenados] = useState<number[]>([]);
  const [pointsRules, setPointsRules] = useState(DEFAULT_POINTS_RULES);

  const [temporadaSelecionada, setTemporadaSelecionada] = useState('');
  const [isLoadingBase, setIsLoadingBase] = useState(false);
  const [isLoadingRanking, setIsLoadingRanking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modalAberta, setModalAberta] = useState(false);
  const [idJogadorSelecionado, setIdJogadorSelecionado] = useState<string | null>(null);

  useEffect(() => {
    const loadBaseData = async () => {
      setIsLoadingBase(true);
      setError(null);

      const [temporadasResult, jogadoresResult, configResult] = await Promise.all([
        supabase.from('temporadas').select('id, codigo_temporada, ativa, data_inicio').order('data_inicio', { ascending: false }),
        supabase.from('jogadores').select('id, nome').order('nome', { ascending: true }),
        supabase.from('configuracoes').select('pontuacao_json').order('id', { ascending: false }).limit(1).maybeSingle(),
      ]);

      if (temporadasResult.error) {
        setError(`Erro ao carregar temporadas: ${temporadasResult.error.message}`);
      } else {
        const temporadasData = ((temporadasResult.data ?? []) as Temporada[]).sort((a, b) =>
          b.codigo_temporada.localeCompare(a.codigo_temporada, 'pt-BR', { numeric: true, sensitivity: 'base' }),
        );
        setTemporadas(temporadasData);

        const temporadaAtiva = temporadasData.find((item) => item.ativa);
        const temporadaInicial = temporadaAtiva ?? temporadasData[0];
        if (temporadaInicial) {
          setTemporadaSelecionada(String(temporadaInicial.id));
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
    const loadRankingData = async () => {
      if (!temporadaSelecionada) {
        setRegistros([]);
        return;
      }

      setIsLoadingRanking(true);
      setError(null);

      const { data: etapasData, error: etapasError } = await supabase
        .from('etapas')
        .select('id, data_etapa')
        .eq('temporada_id', Number(temporadaSelecionada))
        .order('data_etapa', { ascending: true });

      if (etapasError) {
        setError(`Erro ao carregar etapas da temporada: ${etapasError.message}`);
        setRegistros([]);
        setIsLoadingRanking(false);
        return;
      }

      const etapaIds = (etapasData ?? []).map((etapa) => etapa.id);
      setEtapaIdsOrdenados(etapaIds);

      if (etapaIds.length === 0) {
        setRegistros([]);
        setIsLoadingRanking(false);
        return;
      }

      const { data: registrosData, error: registrosError } = await supabase
        .from('registros_etapa')
        .select('etapa_id, jogador_id, tipo_participante, colocacao, rebuys, melhor_mao')
        .in('etapa_id', etapaIds);

      if (registrosError) {
        setError(`Erro ao carregar ranking da temporada: ${registrosError.message}`);
        setRegistros([]);
      } else {
        setRegistros((registrosData ?? []) as RegistroEtapa[]);
      }

      setIsLoadingRanking(false);
    };

    void loadRankingData();
  }, [temporadaSelecionada]);

  const ranking = useMemo(() => {
    return buildRankingRows(registros, jogadoresMap, pointsRules);
  }, [jogadoresMap, pointsRules, registros]);

  const movimentacoesRanking = useMemo(() => {
    const result = new Map<number, RankingMovement>();

    if (ranking.length === 0 || etapaIdsOrdenados.length < 2) {
      ranking.forEach((row) => {
        result.set(row.jogadorId, { direction: 'same', delta: 0 });
      });
      return result;
    }

    const ultimaEtapaId = etapaIdsOrdenados[etapaIdsOrdenados.length - 1];
    const registrosSemUltimaEtapa = registros.filter((registro) => registro.etapa_id !== ultimaEtapaId);
    const rankingAnterior = buildRankingRows(registrosSemUltimaEtapa, jogadoresMap, pointsRules);

    const posicaoAnteriorPorJogador = new Map<number, number>();
    rankingAnterior.forEach((row, index) => {
      posicaoAnteriorPorJogador.set(row.jogadorId, index + 1);
    });

    ranking.forEach((row, index) => {
      const posicaoAtual = index + 1;
      const posicaoAnterior = posicaoAnteriorPorJogador.get(row.jogadorId);

      if (!posicaoAnterior) {
        result.set(row.jogadorId, { direction: 'same', delta: 0 });
        return;
      }

      const variacao = posicaoAnterior - posicaoAtual;
      if (variacao > 0) {
        result.set(row.jogadorId, { direction: 'up', delta: variacao });
      } else if (variacao < 0) {
        result.set(row.jogadorId, { direction: 'down', delta: Math.abs(variacao) });
      } else {
        result.set(row.jogadorId, { direction: 'same', delta: 0 });
      }
    });

    return result;
  }, [etapaIdsOrdenados, jogadoresMap, pointsRules, ranking, registros]);

  const carregando = isLoadingBase || isLoadingRanking;

  const handleOpenModal = (jogadorId: number) => {
    setIdJogadorSelecionado(String(jogadorId));
    setModalAberta(true);
  };

  const handleCloseModal = () => {
    setModalAberta(false);
  };

  return (
    <main className="min-h-screen space-y-6 bg-[radial-gradient(circle_at_top,rgba(255,94,0,0.08),transparent_24%),linear-gradient(180deg,#061019_0%,#07131d_40%,#081723_100%)] px-4 py-8 sm:px-6 lg:px-8">
      <section className="rounded-2xl border border-slate-700/60 bg-gradient-to-br from-slate-900 via-slate-900 to-slate-800 p-5 shadow-[0_10px_30px_rgba(2,6,23,0.35)]">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">Classificação</p>
            <h1 className="mt-1 text-2xl font-bold text-white">Ranking Geral</h1>
            <p className="mt-1 hidden text-sm text-slate-300 md:block">Pontuação acumulada por temporada com desempate por colocações.</p>
          </div>

          <label className="flex w-full max-w-xs flex-col gap-1 text-sm text-slate-200">
            Temporada
            <select
              value={temporadaSelecionada}
              onChange={(event) => setTemporadaSelecionada(event.target.value)}
              disabled={isLoadingBase || temporadas.length === 0}
              className="h-11 rounded-lg border border-slate-600 bg-slate-900 px-3 text-slate-100 outline-none transition focus:border-amber-400"
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

      <section className="rounded-2xl border border-[#244357] bg-[#081723]/92 shadow-[0_18px_45px_rgba(3,8,14,0.42)]">
        <div className="flex items-center justify-between border-b border-[#244357] px-4 py-3 sm:px-6">
          <h2 className="text-lg font-semibold text-slate-50">Tabela de Classificação</h2>
          {carregando ? <span className="text-sm text-slate-300">Carregando...</span> : null}
        </div>

        <div className="space-y-3 p-4 md:hidden">
          {ranking.length === 0 ? (
            <p className="rounded-xl border border-[#244357] bg-[#0b1a25] px-3 py-4 text-center text-sm text-slate-400">
              Nenhum dado de ranking para a temporada selecionada.
            </p>
          ) : (
            ranking.map((row, index) => {
              const movement = movimentacoesRanking.get(row.jogadorId) ?? { direction: 'same', delta: 0 };
              const movementLabel =
                movement.direction === 'up'
                  ? `▲ ${movement.delta}`
                  : movement.direction === 'down'
                    ? `▼ ${movement.delta}`
                    : '●';

              return (
                <article key={row.jogadorId} className="rounded-xl border border-[#244357] bg-[#0b1a25] p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <span
                        className={`inline-flex min-w-9 items-center justify-center rounded-full px-2 py-0.5 text-xs font-bold ${getPosicaoBadgeClass(index)}`}
                      >
                        {formatOrdinal(index + 1)}
                      </span>
                    </div>

                    <div className="min-w-0 flex-1">
                      <button
                        type="button"
                        onClick={() => handleOpenModal(row.jogadorId)}
                        className="w-full truncate text-left text-sm font-semibold text-sky-300"
                      >
                        {row.nome}
                      </button>
                      <p className="mt-1 text-xs text-slate-400">Pontuação total: {row.pontosTotais}</p>
                    </div>

                    <span className={`text-xs font-bold ${getMovementIndicatorClass(movement)}`}>{movementLabel}</span>
                  </div>

                  <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                    <div className="rounded-lg border border-[#2b4758] bg-[#0e2432] px-2 py-1 text-center text-slate-300">
                      Part.<br />
                      <span className="font-semibold text-slate-100">{row.participacoes}</span>
                    </div>
                    <div className="rounded-lg border border-[#2b4758] bg-[#0e2432] px-2 py-1 text-center text-slate-300">
                      Pódios<br />
                      <span className="font-semibold text-slate-100">{row.podios}</span>
                    </div>
                    <div className="rounded-lg border border-[#2b4758] bg-[#0e2432] px-2 py-1 text-center text-slate-300">
                      Rebuys<br />
                      <span className="font-semibold text-slate-100">{row.rebuys}</span>
                    </div>
                  </div>
                </article>
              );
            })
          )}
        </div>

        <div className="hidden overflow-x-auto md:block">
          <table className="min-w-[1120px] border-collapse text-[11px] leading-tight">
            <thead className="bg-[#0f2230] text-slate-200">
              <tr>
                <th className="w-14 px-1 py-2 text-left font-semibold">Posição</th>
                <th className="w-14 px-1 py-2 text-center font-semibold">Mov.</th>
                <th className="px-1 py-2 text-left font-semibold">Nome</th>
                <th className="w-20 px-2 py-2 text-right font-semibold">Pontos</th>
                <th className="w-16 px-2 py-2 text-right font-semibold">Part.</th>
                <th className="w-16 px-2 py-2 text-right font-semibold">Pódios</th>
                <th className="w-16 px-2 py-2 text-right font-semibold">M. Mão</th>
                <th className="w-16 px-2 py-2 text-right font-semibold">Rebuys</th>
                {POSITION_KEYS.map((posicao) => (
                  <th key={posicao} className="w-10 px-1 py-2 text-center font-semibold whitespace-nowrap">
                    {formatOrdinal(posicao)}
                  </th>
                ))}
              </tr>
            </thead>

            <tbody>
              {ranking.length === 0 ? (
                <tr>
                  <td colSpan={17} className="px-2 py-6 text-center text-slate-500">
                    Nenhum dado de ranking para a temporada selecionada.
                  </td>
                </tr>
              ) : (
                ranking.map((row, index) => (
                  <tr key={row.jogadorId} className={`border-t border-[#1f3b4d] text-slate-200 ${getLinhaDestaqueClass(index)}`}>
                    <td className="px-1 py-2">
                      <span className={`inline-flex min-w-8 items-center justify-center rounded-full px-1 py-0.5 text-[11px] font-bold ${getPosicaoBadgeClass(index)}`}>
                        {formatOrdinal(index + 1)}
                      </span>
                    </td>
                    <td className="px-1 py-2 text-center">
                      {(() => {
                        const movement = movimentacoesRanking.get(row.jogadorId) ?? { direction: 'same', delta: 0 };

                        if (movement.direction === 'up') {
                          return <span className={`inline-flex items-center gap-1 text-xs font-bold ${getMovementIndicatorClass(movement)}`}>▲ {movement.delta}</span>;
                        }

                        if (movement.direction === 'down') {
                          return <span className={`inline-flex items-center gap-1 text-xs font-bold ${getMovementIndicatorClass(movement)}`}>▼ {movement.delta}</span>;
                        }

                        return <span className={`inline-flex items-center justify-center text-xs font-bold ${getMovementIndicatorClass(movement)}`}>●</span>;
                      })()}
                    </td>
                    <td className="px-1 py-2 font-semibold text-slate-100 whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => handleOpenModal(row.jogadorId)}
                        className="cursor-pointer font-medium text-sky-300 hover:text-sky-200 hover:underline"
                      >
                        {row.nome}
                      </button>
                    </td>
                    <td className="px-2 py-2 text-right font-bold text-slate-100">{row.pontosTotais}</td>
                    <td className="px-2 py-2 text-right">{row.participacoes}</td>
                    <td className="px-2 py-2 text-right">{row.podios}</td>
                    <td className="px-2 py-2 text-right">{row.melhorMao}</td>
                    <td className="px-2 py-2 text-right">{row.rebuys}</td>
                    {POSITION_KEYS.map((posicao) => {
                      const count = row.posicoes[posicao];

                      return (
                        <td key={`${row.jogadorId}-${posicao}`} className="px-0.5 py-2 text-center align-middle">
                          <span
                            className={`inline-flex min-w-7 items-center justify-center rounded-md border px-1 py-0.5 text-[10px] font-bold leading-none ${getPositionCountStyle(count)}`}
                          >
                            {count}
                          </span>
                        </td>
                      );
                    })}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <ModalEstatisticas
        jogadorId={idJogadorSelecionado ?? ''}
        isOpen={modalAberta}
        onClose={handleCloseModal}
      />
    </main>
  );
}
