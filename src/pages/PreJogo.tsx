import { useEffect, useMemo, useRef, useState } from 'react';
import html2canvas from 'html2canvas';
import supabase from '../supabaseClient';

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

const STORAGE_PREFIX = 'poker_prejogo_state_v1';
const MAX_JOGADORES = 28;
const POSITIONS = ['Dealer', 'Small', 'Big', '4', '5', '6', '7', '8', '9'] as const;

const SEAT_COORDS = [
  { top: '11%', left: '50%' },
  { top: '20%', left: '71%' },
  { top: '39%', left: '83%' },
  { top: '61%', left: '75%' },
  { top: '75%', left: '58%' },
  { top: '75%', left: '42%' },
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

export default function PreJogo() {
  const [etapas, setEtapas] = useState<Etapa[]>([]);
  const [jogadores, setJogadores] = useState<Jogador[]>([]);
  const [etapaId, setEtapaId] = useState('');
  const [rows, setRows] = useState<string[]>(['']);
  const [sorteio, setSorteio] = useState<SorteioMesas>({ tables: [], drawnAt: null });
  const [latePlayerId, setLatePlayerId] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const mesasExportRef = useRef<HTMLDivElement | null>(null);

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

      if (etapasData.length > 0) {
        setEtapaId(String(etapasData[0].id));
      }

      setIsLoading(false);
    };

    void loadData();
  }, []);

  useEffect(() => {
    if (!etapaId) {
      setRows(['']);
      setLatePlayerId('');
      setSorteio({ tables: [], drawnAt: null });
      return;
    }

    const storageKey = getStorageKeyForEtapa(etapaId);
    const persistedRaw = localStorage.getItem(storageKey);

    if (!persistedRaw) {
      setRows(['']);
      setLatePlayerId('');
      setSorteio({ tables: [], drawnAt: null });
      return;
    }

    try {
      const parsed = JSON.parse(persistedRaw) as PersistedPreJogoState;
      const validIds = uniqueNumberList((parsed.participantIds ?? []).filter((id) => Number.isFinite(id)));
      const validTables = (parsed.tables ?? []).map((table) => table.filter((id) => Number.isFinite(id)));

      setRows(validIds.length > 0 ? normalizeSelectionRows(validIds.map(String)) : ['']);
      setLatePlayerId('');
      setSorteio({
        tables: validTables,
        drawnAt: parsed.drawnAt ?? null,
      });
      setError(null);
      setSuccess(null);
    } catch {
      localStorage.removeItem(storageKey);
      setRows(['']);
      setLatePlayerId('');
      setSorteio({ tables: [], drawnAt: null });
    }
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

    if (payload.participantIds.length === 0 && payload.tables.length === 0) {
      localStorage.removeItem(storageKey);
      return;
    }

    localStorage.setItem(storageKey, JSON.stringify(payload));
  }, [confirmedPlayerIds, etapaId, sorteio]);

  const updateRowValue = (index: number, value: string) => {
    setRows((prev) => {
      const next = [...prev];
      next[index] = value;
      return normalizeSelectionRows(next);
    });
  };

  const addConfirmedPlayerToRows = (playerId: number) => {
    setRows((prev) => {
      const filled = prev.filter((item) => item.trim() !== '');
      const playerIdText = String(playerId);
      if (filled.includes(playerIdText)) {
        return normalizeSelectionRows(prev);
      }

      return normalizeSelectionRows([...filled, playerIdText]);
    });
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

    setSuccess(`Sorteio concluído: ${confirmedPlayerIds.length} jogador(es) em ${tables.length} mesa(s).`);
  };

  const handleResetSorteio = () => {
    if (etapaId) {
      localStorage.removeItem(getStorageKeyForEtapa(etapaId));
    }

    setRows(['']);
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

  const captureMesasCanvas = async () => {
    if (!mesasExportRef.current) {
      throw new Error('Área das mesas não encontrada para exportação.');
    }

    return html2canvas(mesasExportRef.current, {
      backgroundColor: '#07131d',
      scale: 2,
      useCORS: true,
      logging: false,
    });
  };

  const handleExportarImagem = async () => {
    setError(null);
    setSuccess(null);

    if (sorteio.tables.length === 0) {
      setError('Faça o sorteio antes de exportar.');
      return;
    }

    setIsExporting(true);

    try {
      const canvas = await captureMesasCanvas();
      const dataUrl = canvas.toDataURL('image/png');
      const link = document.createElement('a');
      link.href = dataUrl;
      link.download = `pre-jogo-${etapaSelecionadaLabel}.png`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setSuccess('Imagem exportada com sucesso.');
    } catch {
      setError('Não foi possível exportar imagem das mesas.');
    } finally {
      setIsExporting(false);
    }
  };

  const handleExportarPdf = async () => {
    setError(null);
    setSuccess(null);

    if (sorteio.tables.length === 0) {
      setError('Faça o sorteio antes de exportar.');
      return;
    }

    setIsExporting(true);

    try {
      const canvas = await captureMesasCanvas();
      const dataUrl = canvas.toDataURL('image/png');
      const popup = window.open('', '_blank', 'noopener,noreferrer,width=1400,height=1000');

      if (!popup) {
        throw new Error('Popup bloqueado');
      }

      popup.document.write(`
        <html>
          <head>
            <title>Pré-jogo ${etapaSelecionadaLabel}</title>
            <style>
              @page { size: A4 landscape; margin: 10mm; }
              body { margin: 0; font-family: Arial, sans-serif; background: #07131d; color: #fff; }
              .wrap { padding: 12px; }
              h1 { font-size: 18px; margin: 0 0 10px; }
              img { width: 100%; height: auto; border: 1px solid #244357; border-radius: 10px; }
            </style>
          </head>
          <body>
            <div class="wrap">
              <h1>Pré-jogo - ${etapaSelecionadaLabel}</h1>
              <img src="${dataUrl}" alt="Mesas sorteadas" />
            </div>
            <script>window.onload = () => window.print();</script>
          </body>
        </html>
      `);
      popup.document.close();
      setSuccess('PDF pronto para impressão/exportação.');
    } catch {
      setError('Não foi possível abrir a exportação em PDF. Verifique bloqueio de pop-up.');
    } finally {
      setIsExporting(false);
    }
  };

  const handleImprimirFichaMesa = () => {
    setError(null);
    setSuccess(null);

    if (sorteio.tables.length === 0) {
      setError('Faça o sorteio antes de imprimir as fichas de anotação por mesa.');
      return;
    }

    const etapaLabel = etapaSelecionadaLabel;
    const popup = window.open('', '_blank', 'noopener,noreferrer,width=1400,height=1000');

    if (!popup) {
      setError('Não foi possível abrir a impressão. Verifique bloqueio de pop-up.');
      return;
    }

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

    popup.document.write(`
      <html>
        <head>
          <title>Fichas de Mesa - ${etapaLabel}</title>
          <style>
            @page { size: A4 landscape; margin: 10mm; }
            * { box-sizing: border-box; }
            body { margin: 0; font-family: Arial, sans-serif; color: #111; }
            .print-page {
              page-break-after: always;
              min-height: 180mm;
            }
            .print-page:last-child { page-break-after: auto; }
            .header {
              display: flex;
              justify-content: space-between;
              align-items: flex-start;
              gap: 10px;
              margin-bottom: 8px;
            }
            h1 { margin: 0 0 4px 0; font-size: 16px; }
            p { margin: 2px 0; font-size: 10px; }
            .meta { text-align: right; }
            table { width: 100%; border-collapse: collapse; table-layout: fixed; }
            th, td {
              border: 1px solid #333;
              padding: 3px;
              font-size: 9px;
              text-align: center;
              height: 24px;
              vertical-align: middle;
            }
            th { background: #f0f0f0; font-size: 8px; }
            .num-col { width: 30px; font-weight: 700; }
            .mark-col { width: 34px; }
            .name-col { width: 220px; text-align: left; font-weight: 700; }
            .rebuy-col { width: 220px; }
            .money-col { width: 78px; }
            .place-col { width: 58px; }
            .circle {
              display: inline-block;
              width: 13px;
              height: 13px;
              border: 1.5px solid #111;
              border-radius: 999px;
            }
            .circle.small {
              width: 11px;
              height: 11px;
            }
            .rebuy-grid {
              display: grid;
              grid-template-columns: repeat(10, 1fr);
              gap: 2px;
              align-items: center;
            }
            .hint {
              margin-top: 6px;
              font-size: 9px;
              color: #444;
            }
          </style>
        </head>
        <body>
          ${pagesHtml}
          <script>window.onload = () => window.print();</script>
        </body>
      </html>
    `);
    popup.document.close();
    setSuccess('Fichas por mesa abertas para impressão.');
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
      <section className="mx-auto w-full max-w-7xl space-y-6">
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

        <section className="rounded-3xl border border-[#244357] bg-[#081723]/92 p-5 shadow-[0_18px_45px_rgba(3,8,14,0.42)]">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold text-slate-50">Jogadores Confirmados</h2>
            <span className="rounded-full border border-[#315770] bg-[#102536] px-3 py-1 text-xs font-semibold text-slate-200">
              {confirmedPlayerIds.length} confirmado(s)
            </span>
          </div>

          <div className="max-h-[340px] space-y-2 overflow-y-auto pr-1">
            {rows.map((value, index) => {
              const usedByOthers = new Set(rows.filter((_, rowIndex) => rowIndex !== index).filter((item) => item !== ''));

              return (
                <label key={`${index}-${value}`} className="block text-xs text-slate-300">
                  Jogador #{index + 1}
                  <select
                    value={value}
                    onChange={(event) => updateRowValue(index, event.target.value)}
                    disabled={isLoading}
                    className="mt-1 h-10 w-full rounded-lg border border-[#244357] bg-[#0b1a25] px-3 text-sm text-slate-100 outline-none transition focus:border-[#ff5e00]"
                  >
                    <option value="">Selecione um jogador</option>
                    {jogadores.map((jogador) => {
                      const optionValue = String(jogador.id);
                      const disabled = usedByOthers.has(optionValue);
                      return (
                        <option key={jogador.id} value={optionValue} disabled={disabled}>
                          {jogador.nome}
                        </option>
                      );
                    })}
                  </select>
                </label>
              );
            })}
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleSortear}
              disabled={isLoading || confirmedPlayerIds.length === 0}
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

        {sorteio.tables.length > 0 ? (
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

        {sorteio.tables.length > 0 ? (
          <section ref={mesasExportRef} className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold text-slate-50">Mesas Sorteadas</h2>
              <div className="flex items-center gap-2">
                <span className="text-sm text-slate-300">{currentDrawPlayerIds.length} jogadores</span>
                <button
                  type="button"
                  onClick={handleExportarImagem}
                  disabled={isExporting}
                  className="inline-flex h-9 items-center justify-center rounded-lg border border-[#315770] bg-[#102536] px-3 text-xs font-semibold text-slate-200 transition hover:border-[#ff9a63] hover:text-[#ffcfb2] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Exportar imagem
                </button>
                <button
                  type="button"
                  onClick={handleExportarPdf}
                  disabled={isExporting}
                  className="inline-flex h-9 items-center justify-center rounded-lg border border-[#315770] bg-[#102536] px-3 text-xs font-semibold text-slate-200 transition hover:border-[#ff9a63] hover:text-[#ffcfb2] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Exportar PDF
                </button>
                <button
                  type="button"
                  onClick={handleImprimirFichaMesa}
                  disabled={isExporting}
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
