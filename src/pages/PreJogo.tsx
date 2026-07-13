import { useEffect, useMemo, useRef, useState } from 'react';
import supabase from '../supabaseClient';
import { isAdminAuthenticated } from '../utils/adminAuth';

type Etapa = {
  id: number;
  codigo_etapa: string;
  data_etapa: string;
};

type Jogador = {
  id: number;
  nome: string;
};

type SorteioMesas = {
  tables: number[][];
  drawnAt: string | null;
};

type PersistedPreJogoState = {
  participantIds: number[];
  tables: number[][];
  drawnAt: string | null;
};

type RemotePreJogoRow = {
  etapa_id: number;
  participant_ids: number[];
  tables_json: number[][];
  drawn_at: string | null;
  updated_at?: string;
};

const STORAGE_PREFIX = 'poker_prejogo_state_v1';
const MAX_JOGADORES = 28;
const POSITIONS = ['Dealer', 'Small', 'Big', '4', '5', '6', '7', '8', '9'] as const;

const SEAT_COORDS = [
  { top: '11%', left: '50%' },
  { top: '20%', left: '71%' },
  { top: '39%', left: '83%' },
  { top: '61%', left: '75%' },
  { top: '79%', left: '62%' },
  { top: '79%', left: '38%' },
  { top: '61%', left: '25%' },
  { top: '39%', left: '17%' },
  { top: '20%', left: '29%' },
];

function tableCountForPlayers(total: number): number {
  if (total <= 0) return 0;
  if (total <= 9) return 1;
  if (total <= 18) return 2;
  return 3;
}

function shuffleArray<T>(items: T[]): T[] {
  const copy = [...items];

  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }

  return copy;
}

function distributePlayers(totalPlayers: number, tableCount: number): number[] {
  const base = Math.floor(totalPlayers / tableCount);
  const remainder = totalPlayers % tableCount;

  return Array.from({ length: tableCount }, (_, index) => base + (index < remainder ? 1 : 0));
}

function drawTables(playerIds: number[]): number[][] {
  const qtdMesas = tableCountForPlayers(playerIds.length);
  if (qtdMesas === 0) return [];

  const shuffled = shuffleArray(playerIds);
  const tableSizes = distributePlayers(playerIds.length, qtdMesas);

  const tables: number[][] = [];
  let cursor = 0;

  tableSizes.forEach((size) => {
    tables.push(shuffled.slice(cursor, cursor + size));
    cursor += size;
  });

  return tables;
}

function addLatePlayerToLeastCrowdedTable(tables: number[][], playerId: number): number[][] {
  const updated = tables.map((table) => [...table]);

  const sizes = updated.map((table) => table.length);
  const minSize = Math.min(...sizes);
  const candidates = sizes
    .map((size, index) => ({ size, index }))
    .filter((item) => item.size === minSize)
    .map((item) => item.index);

  const randomIndex = candidates[Math.floor(Math.random() * candidates.length)];
  updated[randomIndex].push(playerId);

  return updated;
}

function uniqueNumberList(values: number[]): number[] {
  return Array.from(new Set(values));
}

function normalizeSelectionRows(values: string[]): string[] {
  const cleaned = values.map((item) => item.trim());
  const withoutTrailingEmpty = [...cleaned];

  while (withoutTrailingEmpty.length > 0 && withoutTrailingEmpty[withoutTrailingEmpty.length - 1] === '') {
    withoutTrailingEmpty.pop();
  }

  return [...withoutTrailingEmpty, ''];
}

function getStorageKeyForEtapa(etapaId: string): string {
  return `${STORAGE_PREFIX}:${etapaId}`;
}

function parsePersistedState(payload: PersistedPreJogoState | null | undefined): PersistedPreJogoState {
  const participantIds = uniqueNumberList((payload?.participantIds ?? []).filter((id) => Number.isFinite(id) && id > 0));
  const tables = (payload?.tables ?? []).map((table) => table.filter((id) => Number.isFinite(id) && id > 0));

  return {
    participantIds,
    tables,
    drawnAt: payload?.drawnAt ?? null,
  };
}

export default function PreJogo() {
  const [etapas, setEtapas] = useState<Etapa[]>([]);
  const [jogadores, setJogadores] = useState<Jogador[]>([]);
  const [etapaId, setEtapaId] = useState('');
  const [rows, setRows] = useState<string[]>(['']);
  const [playerSelectValue, setPlayerSelectValue] = useState('');
  const [canResortAfterNewPlayer, setCanResortAfterNewPlayer] = useState(false);
  const [sorteio, setSorteio] = useState<SorteioMesas>({ tables: [], drawnAt: null });
  const [latePlayerId, setLatePlayerId] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [syncWarning, setSyncWarning] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const mesasExportRef = useRef<HTMLDivElement | null>(null);
  const isRemoteTableAvailableRef = useRef<boolean>(true);
  const adminLoggedIn = isAdminAuthenticated();

  useEffect(() => {
    const loadData = async () => {
      setIsLoading(true);
      setError(null);

      const [jogadoresResult, etapasResult] = await Promise.all([
        supabase
          .from('jogadores')
          .select('id, nome')
          .eq('ativo', true)
          .order('nome', { ascending: true }),
        supabase.from('etapas').select('id, codigo_etapa, data_etapa').order('data_etapa', { ascending: false }),
      ]);

      if (jogadoresResult.error) {
        setError(`Erro ao carregar jogadores: ${jogadoresResult.error.message}`);
        setIsLoading(false);
        return;
      }

      if (etapasResult.error) {
        setError(`Erro ao carregar etapas: ${etapasResult.error.message}`);
        setIsLoading(false);
        return;
      }

      const jogadoresData = (jogadoresResult.data ?? []) as Jogador[];
      const etapasData = (etapasResult.data ?? []) as Etapa[];
      setJogadores(jogadoresData);
      setEtapas(etapasData);
      setSyncWarning(null);

      if (etapasData.length > 0) {
        setEtapaId(String(etapasData[0].id));
      }

      setIsLoading(false);
    };

    void loadData();
  }, []);

  useEffect(() => {
    const restoreFromLocalStorage = () => {
      const storageKey = getStorageKeyForEtapa(etapaId);
      const persistedRaw = localStorage.getItem(storageKey);

      if (!persistedRaw) {
        setRows(['']);
        setPlayerSelectValue('');
        setCanResortAfterNewPlayer(false);
        setLatePlayerId('');
        setSorteio({ tables: [], drawnAt: null });
        return;
      }

      try {
        const parsed = JSON.parse(persistedRaw) as PersistedPreJogoState;
        const normalized = parsePersistedState(parsed);

        setRows(normalized.participantIds.length > 0 ? normalizeSelectionRows(normalized.participantIds.map(String)) : ['']);
        setPlayerSelectValue('');
        setCanResortAfterNewPlayer(false);
        setLatePlayerId('');
        setSorteio({
          tables: normalized.tables,
          drawnAt: normalized.drawnAt,
        });
        setError(null);
        setSuccess(null);
      } catch {
        localStorage.removeItem(storageKey);
        setRows(['']);
        setPlayerSelectValue('');
        setCanResortAfterNewPlayer(false);
        setLatePlayerId('');
        setSorteio({ tables: [], drawnAt: null });
      }
    };

    if (!etapaId) {
      setRows(['']);
      setPlayerSelectValue('');
      setCanResortAfterNewPlayer(false);
      setLatePlayerId('');
      setSorteio({ tables: [], drawnAt: null });
      return;
    }

    let cancelled = false;

    const restoreState = async () => {
      setIsSyncing(true);

      if (!isRemoteTableAvailableRef.current) {
        restoreFromLocalStorage();
        setIsSyncing(false);
        return;
      }

      const { data, error: remoteError } = await supabase
        .from('pre_jogo_etapa')
        .select('etapa_id, participant_ids, tables_json, drawn_at, updated_at')
        .eq('etapa_id', Number(etapaId))
        .maybeSingle();

      if (cancelled) {
        return;
      }

      if (remoteError) {
        isRemoteTableAvailableRef.current = false;
        setSyncWarning('Sincronização entre dispositivos indisponível: tabela pre_jogo_etapa não encontrada. Usando somente este dispositivo.');
        restoreFromLocalStorage();
        setIsSyncing(false);
        return;
      }

      setSyncWarning(null);

      if (!data) {
        restoreFromLocalStorage();
        setIsSyncing(false);
        return;
      }

      const remote = data as RemotePreJogoRow;
      const normalized = parsePersistedState({
        participantIds: remote.participant_ids ?? [],
        tables: remote.tables_json ?? [],
        drawnAt: remote.drawn_at ?? null,
      });

      setRows(normalized.participantIds.length > 0 ? normalizeSelectionRows(normalized.participantIds.map(String)) : ['']);
      setCanResortAfterNewPlayer(false);
      setLatePlayerId('');
      setSorteio({
        tables: normalized.tables,
        drawnAt: normalized.drawnAt,
      });

      const storageKey = getStorageKeyForEtapa(etapaId);
      localStorage.setItem(storageKey, JSON.stringify(normalized));
      setError(null);
      setSuccess(null);
      setIsSyncing(false);
    };

    void restoreState();

    return () => {
      cancelled = true;
    };
  }, [etapaId]);

  const confirmedPlayerIds = useMemo(() => {
    const ids = rows
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value) && value > 0);

    return uniqueNumberList(ids);
  }, [rows]);

  const currentDrawPlayerIds = useMemo(() => {
    return uniqueNumberList(sorteio.tables.flat());
  }, [sorteio.tables]);

  const jogadorNomeMap = useMemo(() => {
    const map = new Map<number, string>();
    jogadores.forEach((jogador) => map.set(jogador.id, jogador.nome));
    return map;
  }, [jogadores]);

  const lateCandidates = useMemo(() => {
    const selected = new Set(currentDrawPlayerIds);
    return jogadores.filter((jogador) => !selected.has(jogador.id));
  }, [currentDrawPlayerIds, jogadores]);

  useEffect(() => {
    if (!etapaId) {
      return;
    }

    const payload: PersistedPreJogoState = {
      participantIds: confirmedPlayerIds,
      tables: sorteio.tables,
      drawnAt: sorteio.drawnAt,
    };

    const storageKey = getStorageKeyForEtapa(etapaId);
    const remotePayload: RemotePreJogoRow = {
      etapa_id: Number(etapaId),
      participant_ids: payload.participantIds,
      tables_json: payload.tables,
      drawn_at: payload.drawnAt,
    };

    if (payload.participantIds.length === 0 && payload.tables.length === 0) {
      localStorage.removeItem(storageKey);

      if (isRemoteTableAvailableRef.current) {
        void supabase.from('pre_jogo_etapa').delete().eq('etapa_id', Number(etapaId));
      }

      return;
    }

    localStorage.setItem(storageKey, JSON.stringify(payload));

    if (isRemoteTableAvailableRef.current) {
      void supabase.from('pre_jogo_etapa').upsert(remotePayload, { onConflict: 'etapa_id' }).then(({ error: upsertError }) => {
        if (upsertError) {
          isRemoteTableAvailableRef.current = false;
          setSyncWarning('Falha ao sincronizar Pré-jogo entre dispositivos. Mantendo somente neste navegador.');
        }
      });
    }
  }, [confirmedPlayerIds, etapaId, sorteio]);

  const addConfirmedPlayerToRows = (playerId: number) => {
    const playerIdText = String(playerId);
    if (confirmedPlayerIds.includes(playerId)) {
      return;
    }

    setRows((prev) => {
      const filled = prev.filter((item) => item.trim() !== '');
      return normalizeSelectionRows([...filled, playerIdText]);
    });

    setCanResortAfterNewPlayer(true);
  };

  const handleSelectConfirmedPlayer = (value: string) => {
    setPlayerSelectValue(value);

    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return;
    }

    if (confirmedPlayerIds.includes(parsed)) {
      setError('Este jogador já está confirmado.');
      setPlayerSelectValue('');
      return;
    }

    if (confirmedPlayerIds.length + 1 > MAX_JOGADORES) {
      setError(`O pré-jogo suporta no máximo ${MAX_JOGADORES} jogadores.`);
      setPlayerSelectValue('');
      return;
    }

    setError(null);
    setSuccess(null);
    addConfirmedPlayerToRows(parsed);
    setPlayerSelectValue('');
  };

  const handleSortear = () => {
    setError(null);
    setSuccess(null);

    if (!etapaId) {
      setError('Selecione uma etapa antes de sortear.');
      return;
    }

    if (confirmedPlayerIds.length === 0) {
      setError('Selecione ao menos um jogador para sortear.');
      return;
    }

    if (confirmedPlayerIds.length > MAX_JOGADORES) {
      setError(`O pré-jogo suporta no máximo ${MAX_JOGADORES} jogadores.`);
      return;
    }

    const tables = drawTables(confirmedPlayerIds);
    setSorteio({
      tables,
      drawnAt: new Date().toISOString(),
    });
    setCanResortAfterNewPlayer(false);

    setSuccess(`Sorteio concluído: ${confirmedPlayerIds.length} jogador(es) em ${tables.length} mesa(s).`);
  };

  const handleResetSorteio = () => {
    if (etapaId) {
      localStorage.removeItem(getStorageKeyForEtapa(etapaId));
      if (isRemoteTableAvailableRef.current) {
        void supabase.from('pre_jogo_etapa').delete().eq('etapa_id', Number(etapaId));
      }
    }

    setRows(['']);
    setPlayerSelectValue('');
    setCanResortAfterNewPlayer(false);
    setLatePlayerId('');
    setSorteio({ tables: [], drawnAt: null });
    setError(null);
    setSuccess('Pré-jogo limpo.');
  };

  const etapaSelecionadaLabel = useMemo(() => {
    const etapa = etapas.find((item) => String(item.id) === etapaId);
    if (!etapa) return 'etapa';

    const data = new Date(etapa.data_etapa).toLocaleDateString('pt-BR');
    return `${etapa.codigo_etapa}-${data}`.replace(/\//g, '-');
  }, [etapaId, etapas]);

  const openPrintWindow = (title: string, htmlBody: string, style: string) => {
    const printFrame = document.createElement('iframe');
    printFrame.style.position = 'fixed';
    printFrame.style.right = '0';
    printFrame.style.bottom = '0';
    printFrame.style.width = '0';
    printFrame.style.height = '0';
    printFrame.style.border = '0';
    document.body.appendChild(printFrame);

    const doc = printFrame.contentDocument;
    if (!doc) {
      document.body.removeChild(printFrame);
      throw new Error('Não foi possível inicializar impressão.');
    }

    doc.open();
    doc.write(`
      <html>
        <head>
          <title>${title}</title>
          <style>${style}</style>
        </head>
        <body>${htmlBody}</body>
      </html>
    `);
    doc.close();

    window.setTimeout(() => {
      printFrame.contentWindow?.focus();
      printFrame.contentWindow?.print();
      window.setTimeout(() => {
        document.body.removeChild(printFrame);
      }, 1500);
    }, 200);
  };

  const handleImprimirFichaMesa = () => {
    setError(null);
    setSuccess(null);

    if (sorteio.tables.length === 0) {
      setError('Faça o sorteio antes de imprimir as fichas de anotação por mesa.');
      return;
    }

    const etapaLabel = etapaSelecionadaLabel;
    const pagesHtml = sorteio.tables
      .map((table, tableIndex) => {
        const rowsHtml = Array.from({ length: 9 }, (_, seatIndex) => {
          const playerId = table[seatIndex];
          const playerName = playerId ? jogadorNomeMap.get(playerId) ?? `Jogador #${playerId}` : '';

          return `
            <tr>
              <td class="num-col">${seatIndex + 1}</td>
              <td class="mark-col"><span class="circle"></span></td>
              <td class="name-col">${playerName}</td>
              <td class="mark-col"><span class="circle"></span></td>
              <td class="rebuy-col">
                <div class="rebuy-grid">
                  ${Array.from({ length: 10 }, () => '<span class="circle small"></span>').join('')}
                </div>
              </td>
              <td class="mark-col"><span class="circle"></span></td>
              <td class="money-col"></td>
              <td class="mark-col"><span class="circle"></span></td>
              <td class="money-col"></td>
              <td class="mark-col"><span class="circle"></span></td>
              <td class="mark-col"><span class="circle"></span></td>
              <td class="place-col"></td>
            </tr>
          `;
        }).join('');

        return `
          <section class="print-page">
            <div class="header">
              <div>
                <h1>Ficha de Anotação - OCR</h1>
                <p><strong>Etapa:</strong> ${etapaLabel}</p>
                <p><strong>Mesa:</strong> ${tableIndex + 1}</p>
              </div>
              <div class="meta">
                <p><strong>Data:</strong> ____/____/______</p>
                <p><strong>Início:</strong> ____:____</p>
              </div>
            </div>

            <table>
              <thead>
                <tr>
                  <th class="num-col">#</th>
                  <th class="mark-col">Janta</th>
                  <th class="name-col">Nome</th>
                  <th class="mark-col">Buy-in</th>
                  <th class="rebuy-col">Rebuys (10 círculos)</th>
                  <th class="mark-col">Add-on</th>
                  <th class="money-col">Pagou janta</th>
                  <th class="mark-col">Pagou salão</th>
                  <th class="money-col">Outros custos</th>
                  <th class="mark-col">Chef</th>
                  <th class="mark-col">Melhor mão</th>
                  <th class="place-col">Colocação</th>
                </tr>
              </thead>
              <tbody>
                ${rowsHtml}
              </tbody>
            </table>

            <p class="hint">Pinte os círculos e preencha valores em letra de forma para facilitar OCR.</p>
          </section>
        `;
      })
      .join('');

    try {
      openPrintWindow(
        `Fichas de Mesa - ${etapaLabel}`,
        pagesHtml,
        '@page { size: A4 landscape; margin: 10mm; } * { box-sizing: border-box; } body { margin: 0; font-family: Arial, sans-serif; color: #111; } .print-page { page-break-after: always; min-height: 180mm; } .print-page:last-child { page-break-after: auto; } .header { display: flex; justify-content: space-between; align-items: flex-start; gap: 10px; margin-bottom: 8px; } h1 { margin: 0 0 4px 0; font-size: 16px; } p { margin: 2px 0; font-size: 10px; } .meta { text-align: right; } table { width: 100%; border-collapse: collapse; table-layout: fixed; } th, td { border: 1px solid #333; padding: 3px; font-size: 9px; text-align: center; height: 24px; vertical-align: middle; } th { background: #f0f0f0; font-size: 8px; } .num-col { width: 30px; font-weight: 700; } .mark-col { width: 34px; } .name-col { width: 220px; text-align: left; font-weight: 700; } .rebuy-col { width: 220px; } .money-col { width: 78px; } .place-col { width: 58px; } .circle { display: inline-block; width: 13px; height: 13px; border: 1.5px solid #111; border-radius: 999px; } .circle.small { width: 11px; height: 11px; } .rebuy-grid { display: grid; grid-template-columns: repeat(10, 1fr); gap: 2px; align-items: center; } .hint { margin-top: 6px; font-size: 9px; color: #444; }',
      );
      setSuccess('Fichas por mesa abertas para impressão.');
    } catch (printError) {
      const message = printError instanceof Error ? printError.message : 'Erro desconhecido';
      setError(`Não foi possível abrir a impressão de fichas: ${message}.`);
    }
  };

  const handleRemoveConfirmedPlayer = (playerId: number) => {
    setError(null);
    setSuccess(null);

    setRows((prev) => {
      const filtered = prev.filter((value) => Number(value) !== playerId && value.trim() !== '');
      return normalizeSelectionRows(filtered);
    });

    if (sorteio.tables.length === 0) {
      setSuccess('Jogador removido da lista de confirmados.');
      return;
    }

    const nextPlayers = currentDrawPlayerIds.filter((id) => id !== playerId);
    const oldTableCount = tableCountForPlayers(currentDrawPlayerIds.length);
    const newTableCount = tableCountForPlayers(nextPlayers.length);

    if (nextPlayers.length === 0) {
      setSorteio({ tables: [], drawnAt: null });
      setSuccess('Jogador removido. Sorteio esvaziado.');
      return;
    }

    if (newTableCount < oldTableCount) {
      const redrawnTables = drawTables(nextPlayers);
      setSorteio({ tables: redrawnTables, drawnAt: new Date().toISOString() });
      setSuccess('Jogador removido. Novo sorteio realizado por redução no número de mesas.');
      return;
    }

    const sourceTableIndex = sorteio.tables.findIndex((table) => table.includes(playerId));
    const sourceTableSizeAfterRemoval =
      sourceTableIndex >= 0 ? sorteio.tables[sourceTableIndex].filter((id) => id !== playerId).length : null;
    const otherTables = sorteio.tables.filter((_, tableIndex) => tableIndex !== sourceTableIndex);
    const hasLargeImbalanceAfterRemoval =
      sourceTableSizeAfterRemoval !== null &&
      otherTables.length > 0 &&
      otherTables.every((table) => table.length - sourceTableSizeAfterRemoval >= 2);

    if (hasLargeImbalanceAfterRemoval) {
      const shouldRedraw = window.confirm(
        'A mesa desse jogador ficou com pelo menos 2 jogadores a menos que as outras. Deseja realizar um novo sorteio?',
      );

      if (shouldRedraw) {
        const redrawnTables = drawTables(nextPlayers);
        setSorteio({ tables: redrawnTables, drawnAt: new Date().toISOString() });
        setSuccess('Jogador removido. Novo sorteio realizado após confirmação.');
        return;
      }
    }

    const updatedTables = sorteio.tables
      .map((table) => table.filter((id) => id !== playerId))
      .filter((table) => table.length > 0);

    setSorteio({ tables: updatedTables, drawnAt: new Date().toISOString() });
    setSuccess('Jogador removido do sorteio.');
  };

  const handleAddLatePlayer = () => {
    setError(null);
    setSuccess(null);

    const parsed = Number(latePlayerId);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setError('Selecione um jogador atrasado para adicionar.');
      return;
    }

    if (currentDrawPlayerIds.includes(parsed)) {
      setError('Este jogador já está no sorteio atual.');
      return;
    }

    const nextPlayers = [...currentDrawPlayerIds, parsed];
    if (nextPlayers.length > MAX_JOGADORES) {
      setError(`O pré-jogo suporta no máximo ${MAX_JOGADORES} jogadores.`);
      return;
    }

    const oldTableCount = tableCountForPlayers(currentDrawPlayerIds.length);
    const newTableCount = tableCountForPlayers(nextPlayers.length);

    let nextTables: number[][];
    let message: string;

    if (newTableCount > oldTableCount) {
      nextTables = drawTables(nextPlayers);
      message = 'Jogador atrasado adicionado e novo sorteio realizado por aumento no número de mesas.';
    } else {
      nextTables = addLatePlayerToLeastCrowdedTable(sorteio.tables, parsed);
      message = 'Jogador atrasado adicionado na mesa com menos jogadores (ou sorteado entre mesas empatadas).';
    }

    setSorteio({
      tables: nextTables,
      drawnAt: new Date().toISOString(),
    });
    addConfirmedPlayerToRows(parsed);
    setLatePlayerId('');
    setSuccess(message);
  };

  const renderSeat = (playerId: number, index: number) => {
    const coord = SEAT_COORDS[index];
    const position = POSITIONS[index];

    return (
      <div
        key={`${playerId}-${position}`}
        className="absolute -translate-x-1/2 -translate-y-1/2"
        style={{ top: coord.top, left: coord.left }}
      >
        <div className="min-w-[118px] rounded-xl border border-[#315770] bg-[#102536]/95 px-2 py-1 text-center shadow-[0_6px_16px_rgba(0,0,0,0.35)]">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-[#ffb387]">{position}</p>
          <p className="truncate text-xs font-semibold text-slate-100">{jogadorNomeMap.get(playerId) ?? `Jogador #${playerId}`}</p>
        </div>
      </div>
    );
  };

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,rgba(255,94,0,0.08),transparent_24%),linear-gradient(180deg,#061019_0%,#07131d_40%,#081723_100%)] px-4 py-8 sm:px-6 lg:px-8">
      <section className="mx-auto w-full max-w-[1700px] space-y-6">
        <header className="rounded-3xl border border-[#244357] bg-[#081723]/92 p-5 shadow-[0_18px_45px_rgba(3,8,14,0.42)]">
          <h1 className="text-2xl font-bold text-slate-50">Pré-jogo</h1>
          <p className="mt-1 text-sm text-slate-300">
            Confirme presença, sorteie mesas/posições e ajuste jogadores atrasados sem perder o estado do sorteio.
          </p>

          <label className="mt-4 block max-w-sm text-sm text-slate-300">
            Etapa
            <select
              value={etapaId}
              onChange={(event) => setEtapaId(event.target.value)}
              disabled={isLoading || etapas.length === 0}
              className="mt-1 h-10 w-full rounded-lg border border-[#244357] bg-[#0b1a25] px-3 text-sm text-slate-100 outline-none transition focus:border-[#ff5e00]"
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

        {adminLoggedIn ? (
          <section className="rounded-3xl border border-[#244357] bg-[#081723]/92 p-5 shadow-[0_18px_45px_rgba(3,8,14,0.42)]">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold text-slate-50">Jogadores Confirmados</h2>
            <span className="rounded-full border border-[#315770] bg-[#102536] px-3 py-1 text-xs font-semibold text-slate-200">
              {confirmedPlayerIds.length} confirmado(s)
            </span>
          </div>

          {confirmedPlayerIds.length > 0 ? (
            <div className="mb-3 flex flex-wrap gap-2">
              {confirmedPlayerIds.map((playerId) => (
                <button
                  key={`confirmed-${playerId}`}
                  type="button"
                  onClick={() => handleRemoveConfirmedPlayer(playerId)}
                  className="inline-flex items-center gap-2 rounded-full border border-[#315770] bg-[#102536] px-3 py-1 text-xs text-slate-100 transition hover:border-rose-400/60 hover:text-rose-200"
                  title="Remover jogador confirmado"
                >
                  <span>{jogadorNomeMap.get(playerId) ?? `Jogador #${playerId}`}</span>
                  <span className="text-rose-300">✕</span>
                </button>
              ))}
            </div>
          ) : null}

          <label className="block text-xs text-slate-300">
            Selecionar jogador confirmado
            <select
              value={playerSelectValue}
              onChange={(event) => handleSelectConfirmedPlayer(event.target.value)}
              disabled={isLoading}
              className="mt-1 h-10 w-full rounded-lg border border-[#244357] bg-[#0b1a25] px-3 text-sm text-slate-100 outline-none transition focus:border-[#ff5e00]"
            >
              <option value="">Selecione um jogador</option>
              {jogadores.map((jogador) => {
                const disabled = confirmedPlayerIds.includes(jogador.id);
                return (
                  <option key={jogador.id} value={jogador.id} disabled={disabled}>
                    {jogador.nome}
                  </option>
                );
              })}
            </select>
          </label>

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleSortear}
              disabled={isLoading || confirmedPlayerIds.length === 0 || (!!sorteio.drawnAt && !canResortAfterNewPlayer)}
              className="inline-flex h-10 items-center justify-center rounded-lg bg-[#ff5e00] px-4 text-sm font-semibold text-white transition hover:bg-[#ff7a2f] disabled:cursor-not-allowed disabled:opacity-60"
            >
              Sortear
            </button>
            <button
              type="button"
              onClick={handleResetSorteio}
              disabled={isLoading}
              className="inline-flex h-10 items-center justify-center rounded-lg border border-[#315770] bg-[#102536] px-4 text-sm font-semibold text-slate-200 transition hover:border-[#ff9a63] hover:text-[#ffcfb2] disabled:cursor-not-allowed disabled:opacity-60"
            >
              Limpar pré-jogo
            </button>
          </div>
          </section>
        ) : null}

        {adminLoggedIn && sorteio.tables.length > 0 ? (
          <section className="rounded-3xl border border-[#244357] bg-[#081723]/92 p-5 shadow-[0_18px_45px_rgba(3,8,14,0.42)]">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-lg font-semibold text-slate-50">Jogador Atrasado</h2>
              <span className="text-xs text-slate-300">
                Último sorteio: {sorteio.drawnAt ? new Date(sorteio.drawnAt).toLocaleString('pt-BR') : '-'}
              </span>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <label className="flex-1 text-xs text-slate-300">
                Adicionar jogador que chegou depois
                <select
                  value={latePlayerId}
                  onChange={(event) => setLatePlayerId(event.target.value)}
                  className="mt-1 h-10 w-full rounded-lg border border-[#244357] bg-[#0b1a25] px-3 text-sm text-slate-100 outline-none transition focus:border-[#ff5e00]"
                >
                  <option value="">Selecione um jogador</option>
                  {lateCandidates.map((jogador) => (
                    <option key={jogador.id} value={jogador.id}>
                      {jogador.nome}
                    </option>
                  ))}
                </select>
              </label>

              <button
                type="button"
                onClick={handleAddLatePlayer}
                disabled={lateCandidates.length === 0 || !latePlayerId}
                className="inline-flex h-10 items-center justify-center rounded-lg bg-[#ff5e00] px-4 text-sm font-semibold text-white transition hover:bg-[#ff7a2f] disabled:cursor-not-allowed disabled:opacity-60"
              >
                Adicionar atrasado
              </button>
            </div>
          </section>
        ) : null}

        {error ? <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</p> : null}
        {success ? <p className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">{success}</p> : null}
        {syncWarning ? <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">{syncWarning}</p> : null}
        {isSyncing ? <p className="text-xs text-slate-300">Sincronizando estado da etapa...</p> : null}

        {sorteio.tables.length > 0 ? (
          <section ref={mesasExportRef} className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold text-slate-50">Mesas Sorteadas</h2>
              <div className="flex items-center gap-2">
                <span className="text-sm text-slate-300">{currentDrawPlayerIds.length} jogadores</span>
                <button
                  type="button"
                  onClick={handleImprimirFichaMesa}
                  className="inline-flex h-9 items-center justify-center rounded-lg border border-[#315770] bg-[#102536] px-3 text-xs font-semibold text-slate-200 transition hover:border-[#ff9a63] hover:text-[#ffcfb2] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Ficha por mesa
                </button>
              </div>
            </div>

            <div className="grid gap-4 xl:grid-cols-2">
              {sorteio.tables.map((table, tableIndex) => (
                <article key={`mesa-${tableIndex + 1}`} className="rounded-3xl border border-[#244357] bg-[#081723]/92 p-4 shadow-[0_18px_45px_rgba(3,8,14,0.42)]">
                  <header className="mb-3 flex items-center justify-between">
                    <h3 className="text-base font-semibold text-slate-50">Mesa {tableIndex + 1}</h3>
                    <span className="text-xs text-slate-300">{table.length} jogador(es)</span>
                  </header>

                  <div className="relative mx-auto aspect-[4/3] max-w-[460px] overflow-hidden rounded-[48%] border border-[#2f5268] bg-[radial-gradient(circle_at_center,#1f7a3a_0%,#155b2b_55%,#0f3e1f_100%)] shadow-[inset_0_0_0_2px_rgba(6,20,30,0.7),inset_0_0_36px_rgba(0,0,0,0.25)]">
                    <div className="absolute inset-[6%] rounded-[48%] border border-[#9f8d6b]/40" />
                    {table.map((playerId, seatIndex) => renderSeat(playerId, seatIndex))}
                  </div>
                </article>
              ))}
            </div>
          </section>
        ) : null}
      </section>
    </main>
  );
}
