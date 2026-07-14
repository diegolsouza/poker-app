import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import supabase from '../supabaseClient';
import { isAdminAuthenticated } from '../utils/adminAuth';

type EtapaStatus = 'pendente' | 'em_andamento' | 'finalizada';
type TabKey = 'admin' | 'mesa1' | 'mesa2' | 'mesa3';

type Etapa = {
  id: number;
  codigo_etapa: string;
  data_etapa: string;
  status: EtapaStatus;
};

type Jogador = {
  id: number;
  nome: string;
};

type RegistroMesaTemp = {
  etapa_id: number;
  jogador_id: number;
  numero_mesa: number;
  rebuys: number | null;
  fez_addon: boolean | null;
};

type MesaPlayerRow = {
  jogadorId: number;
  nome: string;
  rebuys: number;
  fezAddon: boolean;
};

type MesaRowsState = Record<1 | 2 | 3, MesaPlayerRow[]>;

type MesaPinState = Record<1 | 2 | 3, string>;

type RecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: any) => void) | null;
  onerror: ((event: any) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

type RecognitionCtor = new () => RecognitionLike;

const TAB_LABELS: Record<TabKey, string> = {
  admin: 'Controle do Admin',
  mesa1: 'Mesa 1',
  mesa2: 'Mesa 2',
  mesa3: 'Mesa 3',
};

const PUBLIC_TABS: TabKey[] = ['mesa1', 'mesa2', 'mesa3'];
const ADMIN_TABS: TabKey[] = ['admin', 'mesa1', 'mesa2', 'mesa3'];
const ENABLE_SPEECH_TO_TEXT = false;

const EMPTY_MESAS: MesaRowsState = {
  1: [],
  2: [],
  3: [],
};

function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function toEtapaStatus(value: unknown): EtapaStatus {
  if (value === 'pendente' || value === 'em_andamento' || value === 'finalizada') {
    return value;
  }

  return 'pendente';
}

function emptyMesasState(): MesaRowsState {
  return {
    1: [],
    2: [],
    3: [],
  };
}

function parseMesaFromTab(tab: TabKey): 1 | 2 | 3 | null {
  if (tab === 'mesa1') return 1;
  if (tab === 'mesa2') return 2;
  if (tab === 'mesa3') return 3;
  return null;
}

function buildMesasFromSources(
  jogadoresMap: Map<number, Jogador>,
  preJogoTables: number[][],
  tempRows: RegistroMesaTemp[],
): MesaRowsState {
  const base = emptyMesasState();
  const seenByMesa: Record<1 | 2 | 3, Set<number>> = {
    1: new Set<number>(),
    2: new Set<number>(),
    3: new Set<number>(),
  };

  preJogoTables.slice(0, 3).forEach((table, index) => {
    const mesa = (index + 1) as 1 | 2 | 3;

    table.forEach((jogadorId) => {
      if (seenByMesa[mesa].has(jogadorId)) return;
      const jogador = jogadoresMap.get(jogadorId);
      if (!jogador) return;

      base[mesa].push({
        jogadorId,
        nome: jogador.nome,
        rebuys: 0,
        fezAddon: false,
      });

      seenByMesa[mesa].add(jogadorId);
    });
  });

  tempRows.forEach((row) => {
    if (row.numero_mesa < 1 || row.numero_mesa > 3) return;
    const mesa = row.numero_mesa as 1 | 2 | 3;
    const jogador = jogadoresMap.get(row.jogador_id);
    if (!jogador) return;

    const existing = base[mesa].find((item) => item.jogadorId === row.jogador_id);
    if (existing) {
      existing.rebuys = Math.max(0, Number(row.rebuys ?? 0));
      existing.fezAddon = Boolean(row.fez_addon);
      return;
    }

    base[mesa].push({
      jogadorId: row.jogador_id,
      nome: jogador.nome,
      rebuys: Math.max(0, Number(row.rebuys ?? 0)),
      fezAddon: Boolean(row.fez_addon),
    });
  });

  return {
    1: [...base[1]].sort((a, b) => a.nome.localeCompare(b.nome)),
    2: [...base[2]].sort((a, b) => a.nome.localeCompare(b.nome)),
    3: [...base[3]].sort((a, b) => a.nome.localeCompare(b.nome)),
  };
}

export default function DiaDePoker() {
  const location = useLocation();
  const adminLoggedIn = isAdminAuthenticated();
  const isAdminArea = location.pathname.startsWith('/admin');
  const canViewAdminTab = isAdminArea && adminLoggedIn;
  const [tab, setTab] = useState<TabKey>('admin');
  const [etapas, setEtapas] = useState<Etapa[]>([]);
  const [jogadores, setJogadores] = useState<Jogador[]>([]);
  const [selectedEtapaId, setSelectedEtapaId] = useState<string>('');
  const [mesas, setMesas] = useState<MesaRowsState>(EMPTY_MESAS);
  const [novoJogadorByMesa, setNovoJogadorByMesa] = useState<Record<1 | 2 | 3, string>>({
    1: '',
    2: '',
    3: '',
  });
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [speechSupported, setSpeechSupported] = useState<boolean>(false);
  const [listeningMesa, setListeningMesa] = useState<1 | 2 | 3 | null>(null);
  const [mesaPins, setMesaPins] = useState<MesaPinState>({ 1: '', 2: '', 3: '' });
  const [pinInputByMesa, setPinInputByMesa] = useState<MesaPinState>({ 1: '', 2: '', 3: '' });
  const [mesaUnlocked, setMesaUnlocked] = useState<Record<1 | 2 | 3, boolean>>({
    1: false,
    2: false,
    3: false,
  });
  const [lastVoiceTextByMesa, setLastVoiceTextByMesa] = useState<Record<1 | 2 | 3, string>>({
    1: '',
    2: '',
    3: '',
  });
  const [flashByMesa, setFlashByMesa] = useState<Record<number, number | null>>({
    1: null,
    2: null,
    3: null,
  });

  const recognitionRef = useRef<RecognitionLike | null>(null);
  const keepListeningRef = useRef<boolean>(false);
  const activeMesaRef = useRef<1 | 2 | 3 | null>(null);
  const mountedRef = useRef<boolean>(true);
  const mesasRef = useRef<MesaRowsState>(EMPTY_MESAS);
  const selectedEtapaRef = useRef<Etapa | null>(null);
  const etapaEmAndamentoRef = useRef<boolean>(false);
  const flashTimersRef = useRef<Record<number, ReturnType<typeof setTimeout> | null>>({
    1: null,
    2: null,
    3: null,
  });

  const selectedEtapa = useMemo(
    () => etapas.find((item) => String(item.id) === selectedEtapaId) ?? null,
    [etapas, selectedEtapaId],
  );

  const etapaEmAndamento = selectedEtapa?.status === 'em_andamento';

  const jogadoresMap = useMemo(() => {
    const map = new Map<number, Jogador>();
    jogadores.forEach((item) => map.set(item.id, item));
    return map;
  }, [jogadores]);

  const jogadorMesaAtualMap = useMemo(() => {
    const map = new Map<number, 1 | 2 | 3>();

    (Object.keys(mesas) as Array<'1' | '2' | '3'>).forEach((mesaKey) => {
      const mesa = Number(mesaKey) as 1 | 2 | 3;
      mesas[mesa].forEach((row) => {
        map.set(row.jogadorId, mesa);
      });
    });

    return map;
  }, [mesas]);

  const filteredEtapas = useMemo(
    () => etapas.filter((item) => item.status === 'pendente' || item.status === 'em_andamento'),
    [etapas],
  );

  const visibleTabs = canViewAdminTab ? ADMIN_TABS : PUBLIC_TABS;

  useEffect(() => {
    if (!canViewAdminTab && tab === 'admin') {
      setTab('mesa1');
    }
  }, [canViewAdminTab, tab]);

  useEffect(() => {
    if (canViewAdminTab && tab !== 'admin' && !ADMIN_TABS.includes(tab)) {
      setTab('admin');
    }
  }, [canViewAdminTab, tab]);

  useEffect(() => {
    if (!canViewAdminTab && tab === 'admin') {
      setTab('mesa1');
    }
  }, [canViewAdminTab, selectedEtapaId, tab]);

  useEffect(() => {
    mesasRef.current = mesas;
  }, [mesas]);

  useEffect(() => {
    selectedEtapaRef.current = selectedEtapa;
  }, [selectedEtapa]);

  useEffect(() => {
    etapaEmAndamentoRef.current = etapaEmAndamento;
  }, [etapaEmAndamento]);

  useEffect(() => {
    mountedRef.current = true;

      const hasSupport = ENABLE_SPEECH_TO_TEXT && typeof window !== 'undefined' && (
      typeof (window as unknown as { SpeechRecognition?: RecognitionCtor }).SpeechRecognition !== 'undefined' ||
      typeof (window as unknown as { webkitSpeechRecognition?: RecognitionCtor }).webkitSpeechRecognition !== 'undefined'
    );

    setSpeechSupported(hasSupport);

    return () => {
      mountedRef.current = false;
      keepListeningRef.current = false;
      recognitionRef.current?.stop();

      (Object.keys(flashTimersRef.current) as Array<'1' | '2' | '3'>).forEach((mesaKey) => {
        const mesa = Number(mesaKey) as 1 | 2 | 3;
        const timer = flashTimersRef.current[mesa];
        if (timer) {
          clearTimeout(timer);
          flashTimersRef.current[mesa] = null;
        }
      });
    };
  }, []);

  useEffect(() => {
    const bootstrap = async () => {
      setIsLoading(true);
      setError(null);

      const [jogadoresResp, etapasResp] = await Promise.all([
        supabase.from('jogadores').select('id, nome').eq('ativo', true).order('nome', { ascending: true }),
        supabase.from('etapas').select('id, codigo_etapa, data_etapa, status').order('data_etapa', { ascending: false }),
      ]);

      if (jogadoresResp.error) {
        setError(`Erro ao carregar jogadores: ${jogadoresResp.error.message}`);
        setIsLoading(false);
        return;
      }

      if (etapasResp.error) {
        setError(`Erro ao carregar etapas: ${etapasResp.error.message}`);
        setIsLoading(false);
        return;
      }

      const etapasData = (etapasResp.data ?? []).map((row: any) => ({
        id: Number(row.id),
        codigo_etapa: String(row.codigo_etapa),
        data_etapa: String(row.data_etapa),
        status: toEtapaStatus(row.status),
      })) as Etapa[];

      setJogadores((jogadoresResp.data ?? []) as Jogador[]);
      setEtapas(etapasData);

      if (etapasData.length > 0) {
        const firstAvailable = etapasData.find((item) => item.status === 'pendente' || item.status === 'em_andamento');
        setSelectedEtapaId(firstAvailable ? String(firstAvailable.id) : '');
      }

      setIsLoading(false);
    };

    void bootstrap();
  }, []);

  useEffect(() => {
    const stopVoice = () => {
      keepListeningRef.current = false;
      activeMesaRef.current = null;
      setListeningMesa(null);
      recognitionRef.current?.stop();
    };

    const loadEtapaData = async () => {
      setError(null);
      setMessage(null);
      stopVoice();

      if (!selectedEtapaId) {
        setMesas(emptyMesasState());
        setMesaPins({ 1: '', 2: '', 3: '' });
        setMesaUnlocked({ 1: false, 2: false, 3: false });
        setPinInputByMesa({ 1: '', 2: '', 3: '' });
        return;
      }

      const etapaIdNum = Number(selectedEtapaId);

      const [preJogoResp, tempResp, pinsResp] = await Promise.all([
        supabase.from('pre_jogo_etapa').select('tables_json').eq('etapa_id', etapaIdNum).maybeSingle(),
        supabase
          .from('registros_mesas_temp')
          .select('etapa_id, jogador_id, numero_mesa, rebuys, fez_addon')
          .eq('etapa_id', etapaIdNum),
        supabase.from('etapa_mesa_pins').select('numero_mesa, pin_codigo').eq('etapa_id', etapaIdNum),
      ]);

      if (preJogoResp.error) {
        setError(`Erro ao carregar pré-jogo da etapa: ${preJogoResp.error.message}`);
        setMesas(emptyMesasState());
        return;
      }

      if (tempResp.error) {
        setError(`Erro ao carregar registros temporários: ${tempResp.error.message}`);
        setMesas(emptyMesasState());
        return;
      }

      if (pinsResp.error) {
        setError(`Erro ao carregar PINs das mesas: ${pinsResp.error.message}`);
        setMesas(emptyMesasState());
        return;
      }

      const tables = (preJogoResp.data?.tables_json ?? []) as number[][];
      const tempRows = (tempResp.data ?? []) as RegistroMesaTemp[];
      setMesas(buildMesasFromSources(jogadoresMap, tables, tempRows));

      const loadedPins: MesaPinState = { 1: '', 2: '', 3: '' };
      (pinsResp.data ?? []).forEach((row: any) => {
        const mesa = Number(row.numero_mesa) as 1 | 2 | 3;
        if (mesa < 1 || mesa > 3) return;
        loadedPins[mesa] = String(row.pin_codigo ?? '');
      });

      setMesaPins(loadedPins);
      setPinInputByMesa({ 1: '', 2: '', 3: '' });

      if (canViewAdminTab) {
        setMesaUnlocked({ 1: true, 2: true, 3: true });
      } else {
        const etapaKey = String(etapaIdNum);
        const unlockState: Record<1 | 2 | 3, boolean> = { 1: false, 2: false, 3: false };

        ([1, 2, 3] as Array<1 | 2 | 3>).forEach((mesa) => {
          const key = `poker_mesa_unlock:${etapaKey}:${mesa}`;
          unlockState[mesa] = sessionStorage.getItem(key) === '1';
        });

        setMesaUnlocked(unlockState);
      }
    };

    void loadEtapaData();
  }, [selectedEtapaId, jogadoresMap, canViewAdminTab]);

  const generateMesaPin = (): string => String(1000 + Math.floor(Math.random() * 9000));

  const unlockMesaWithPin = (mesa: 1 | 2 | 3) => {
    if (!selectedEtapaId) {
      setError('Selecione uma etapa válida para liberar a mesa.');
      return;
    }

    if (canViewAdminTab) {
      setMesaUnlocked((current) => ({ ...current, [mesa]: true }));
      return;
    }

    const typedPin = pinInputByMesa[mesa].trim();
    const expectedPin = mesaPins[mesa].trim();

    if (!expectedPin) {
      setError(`PIN da Mesa ${mesa} ainda não foi gerado pelo administrador.`);
      return;
    }

    if (typedPin !== expectedPin) {
      setError(`PIN inválido para a Mesa ${mesa}.`);
      return;
    }

    const etapaKey = String(selectedEtapaId);
    sessionStorage.setItem(`poker_mesa_unlock:${etapaKey}:${mesa}`, '1');
    setMesaUnlocked((current) => ({ ...current, [mesa]: true }));
    setPinInputByMesa((current) => ({ ...current, [mesa]: '' }));
    setError(null);
    setMessage(`Mesa ${mesa} liberada para registro.`);
  };

  const upsertMesaRegistro = async (
    etapaId: number,
    jogadorId: number,
    numeroMesa: 1 | 2 | 3,
    rebuys: number,
    fezAddon: boolean,
  ): Promise<boolean> => {
    const payload = {
      etapa_id: etapaId,
      jogador_id: jogadorId,
      numero_mesa: numeroMesa,
      rebuys,
      fez_addon: fezAddon,
    };

    // Delete before upsert to avoid duplicates when moving players across tables.
    const { error: deleteError } = await supabase
      .from('registros_mesas_temp')
      .delete()
      .eq('etapa_id', etapaId)
      .eq('jogador_id', jogadorId);

    if (deleteError) {
      setError(`Erro ao preparar atualização do jogador na mesa: ${deleteError.message}`);
      return false;
    }

    const { error: insertError } = await supabase
      .from('registros_mesas_temp')
      .insert(payload);

    if (insertError) {
      setError(`Erro ao salvar registro na mesa: ${insertError.message}`);
      return false;
    }

    return true;
  };

  const flashJogador = (mesa: 1 | 2 | 3, jogadorId: number) => {
    const currentTimer = flashTimersRef.current[mesa];
    if (currentTimer) {
      clearTimeout(currentTimer);
      flashTimersRef.current[mesa] = null;
    }

    setFlashByMesa((current) => ({ ...current, [mesa]: jogadorId }));

    flashTimersRef.current[mesa] = setTimeout(() => {
      if (!mountedRef.current) return;
      setFlashByMesa((current) => ({ ...current, [mesa]: null }));
      flashTimersRef.current[mesa] = null;
    }, 1300);
  };

  const updateMesaPlayerState = (
    mesa: 1 | 2 | 3,
    jogadorId: number,
    updater: (current: MesaPlayerRow) => MesaPlayerRow,
  ) => {
    setMesas((current) => {
      const row = current[mesa].find((item) => item.jogadorId === jogadorId);
      if (!row) return current;

      return {
        ...current,
        [mesa]: current[mesa].map((item) => (item.jogadorId === jogadorId ? updater(item) : item)),
      };
    });
  };

  const handleRebuyChange = async (mesa: 1 | 2 | 3, jogadorId: number, delta: 1 | -1) => {
    if (!selectedEtapa || !etapaEmAndamento) {
      setError('Registros estão bloqueados. A etapa precisa estar em andamento.');
      return;
    }

    const currentRow = mesas[mesa].find((item) => item.jogadorId === jogadorId);
    if (!currentRow) return;

    const nextRebuys = Math.max(0, currentRow.rebuys + delta);
    const ok = await upsertMesaRegistro(selectedEtapa.id, jogadorId, mesa, nextRebuys, currentRow.fezAddon);

    if (!ok) return;

    updateMesaPlayerState(mesa, jogadorId, (item) => ({ ...item, rebuys: nextRebuys }));
    flashJogador(mesa, jogadorId);
    setError(null);
  };

  const handleAddonToggle = async (mesa: 1 | 2 | 3, jogadorId: number, checked: boolean) => {
    if (!selectedEtapa || !etapaEmAndamento) {
      setError('Registros estão bloqueados. A etapa precisa estar em andamento.');
      return;
    }

    const currentRow = mesas[mesa].find((item) => item.jogadorId === jogadorId);
    if (!currentRow) return;

    const ok = await upsertMesaRegistro(selectedEtapa.id, jogadorId, mesa, currentRow.rebuys, checked);

    if (!ok) return;

    updateMesaPlayerState(mesa, jogadorId, (item) => ({ ...item, fezAddon: checked }));
    flashJogador(mesa, jogadorId);
    setError(null);
  };

  const handleAddJogador = async (mesa: 1 | 2 | 3) => {
    if (!selectedEtapa || !etapaEmAndamento) {
      setError('Não é possível adicionar jogadores com etapa bloqueada.');
      return;
    }

    const jogadorId = Number(novoJogadorByMesa[mesa]);
    if (!jogadorId) return;

    const jogador = jogadoresMap.get(jogadorId);
    if (!jogador) return;

    if (jogadorMesaAtualMap.has(jogadorId)) {
      setError('Esse jogador já está alocado em outra mesa.');
      return;
    }

    const ok = await upsertMesaRegistro(selectedEtapa.id, jogadorId, mesa, 0, false);
    if (!ok) return;

    setMesas((current) => ({
      ...current,
      [mesa]: [...current[mesa], { jogadorId, nome: jogador.nome, rebuys: 0, fezAddon: false }].sort((a, b) =>
        a.nome.localeCompare(b.nome),
      ),
    }));

    setNovoJogadorByMesa((current) => ({ ...current, [mesa]: '' }));
    setError(null);
  };

  const handleRemoveJogador = async (mesa: 1 | 2 | 3, jogadorId: number) => {
    if (!selectedEtapa || !etapaEmAndamento) {
      setError('Não é possível remover jogadores com etapa bloqueada.');
      return;
    }

    const { error: deleteError } = await supabase
      .from('registros_mesas_temp')
      .delete()
      .eq('etapa_id', selectedEtapa.id)
      .eq('jogador_id', jogadorId)
      .eq('numero_mesa', mesa);

    if (deleteError) {
      setError(`Erro ao remover jogador da mesa: ${deleteError.message}`);
      return;
    }

    setMesas((current) => ({
      ...current,
      [mesa]: current[mesa].filter((item) => item.jogadorId !== jogadorId),
    }));

    setError(null);
  };

  const handleMoveJogador = async (fromMesa: 1 | 2 | 3, jogadorId: number, toMesa: 1 | 2 | 3) => {
    if (fromMesa === toMesa) return;

    if (!selectedEtapa || !etapaEmAndamento) {
      setError('Movimentação bloqueada: etapa não está em andamento.');
      return;
    }

    const row = mesas[fromMesa].find((item) => item.jogadorId === jogadorId);
    if (!row) return;

    const ok = await upsertMesaRegistro(selectedEtapa.id, jogadorId, toMesa, row.rebuys, row.fezAddon);
    if (!ok) return;

    setMesas((current) => {
      const without = current[fromMesa].filter((item) => item.jogadorId !== jogadorId);
      const nextTarget = [...current[toMesa].filter((item) => item.jogadorId !== jogadorId), row].sort((a, b) =>
        a.nome.localeCompare(b.nome),
      );

      return {
        ...current,
        [fromMesa]: without,
        [toMesa]: nextTarget,
      };
    });

    setError(null);
  };

  const findPlayerForVoice = (rows: MesaPlayerRow[], transcript: string): MesaPlayerRow | null => {
    const normalizedTranscript = normalizeText(transcript);

    if (rows.length === 0) return null;

    const exact = rows.find((item) => normalizedTranscript.includes(normalizeText(item.nome)));
    if (exact) return exact;

    const tokenSet = new Set(normalizedTranscript.split(' ').filter(Boolean));

    let best: { row: MesaPlayerRow; score: number } | null = null;

    for (const row of rows) {
      const nameTokens = normalizeText(row.nome).split(' ').filter(Boolean);
      if (nameTokens.length === 0) continue;

      const hits = nameTokens.filter((token) => tokenSet.has(token)).length;
      const score = hits / nameTokens.length;

      if (!best || score > best.score) {
        best = { row, score };
      }
    }

    if (!best) {
      return null;
    }

    if (best.score < 0.6) {
      return null;
    }

    return best.row;
  };

  const processVoiceTranscript = async (mesa: 1 | 2 | 3, rawText: string) => {
    const etapaAtual = selectedEtapaRef.current;
    const etapaAberta = etapaEmAndamentoRef.current;

    if (!etapaAtual || !etapaAberta) return;

    const transcript = normalizeText(rawText);
    if (!transcript) return;

    const rebuyMatch = transcript.match(/\b(comprou|compro[u]?|recompr[ao]|recompro)\b/);
    const addonMatch = transcript.match(/\b(adicionou|adiciono[u]?|adicionado)\b/);

    if (!rebuyMatch && !addonMatch) return;

    const actionIndex = rebuyMatch
      ? rebuyMatch.index ?? transcript.length
      : addonMatch
      ? addonMatch.index ?? transcript.length
      : transcript.length;

    const rowsMesa = mesasRef.current[mesa];
    const probableNamePart = transcript.slice(0, actionIndex).trim();
    const targetText = probableNamePart || transcript;
    const jogador = findPlayerForVoice(rowsMesa, targetText);

    if (!jogador) return;

    if (rebuyMatch) {
      const nextRebuys = jogador.rebuys + 1;
      const ok = await upsertMesaRegistro(etapaAtual.id, jogador.jogadorId, mesa, nextRebuys, jogador.fezAddon);
      if (!ok) return;

      updateMesaPlayerState(mesa, jogador.jogadorId, (item) => ({ ...item, rebuys: nextRebuys }));
      flashJogador(mesa, jogador.jogadorId);
      setMessage(`Comando de voz: ${jogador.nome} recebeu +1 rebuy.`);
      setError(null);
      return;
    }

    if (addonMatch) {
      if (jogador.fezAddon) {
        flashJogador(mesa, jogador.jogadorId);
        return;
      }

      const ok = await upsertMesaRegistro(etapaAtual.id, jogador.jogadorId, mesa, jogador.rebuys, true);
      if (!ok) return;

      updateMesaPlayerState(mesa, jogador.jogadorId, (item) => ({ ...item, fezAddon: true }));
      flashJogador(mesa, jogador.jogadorId);
      setMessage(`Comando de voz: add-on aplicado para ${jogador.nome}.`);
      setError(null);
    }
  };

  const getRecognitionCtor = (): RecognitionCtor | null => {
    const win = window as unknown as {
      SpeechRecognition?: RecognitionCtor;
      webkitSpeechRecognition?: RecognitionCtor;
    };

    return win.SpeechRecognition ?? win.webkitSpeechRecognition ?? null;
  };

  const ensureRecognition = (): RecognitionLike | null => {
    if (recognitionRef.current) {
      return recognitionRef.current;
    }

    const Recognition = getRecognitionCtor();
    if (!Recognition) {
      return null;
    }

    const instance = new Recognition();
    instance.lang = 'pt-BR';
    instance.continuous = true;
    instance.interimResults = false;

    instance.onresult = (event: any) => {
      const mesa = activeMesaRef.current;
      if (!mesa) return;

      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        if (!result?.isFinal) continue;

        const transcript = String(result[0]?.transcript ?? '').trim();
        if (!transcript) continue;

        setLastVoiceTextByMesa((current) => ({
          ...current,
          [mesa]: transcript,
        }));

        void processVoiceTranscript(mesa, transcript);
      }
    };

    instance.onerror = () => {
      setError('Falha no reconhecimento de voz desta mesa. Tente ativar novamente o microfone.');
    };

    instance.onend = () => {
      if (keepListeningRef.current && activeMesaRef.current) {
        try {
          instance.start();
        } catch {
          // Speech engines can throw when restarting too quickly.
        }
      }
    };

    recognitionRef.current = instance;
    return instance;
  };

  const toggleMesaVoice = (mesa: 1 | 2 | 3) => {
    setError(null);

    if (!etapaEmAndamento) {
      setError('Comando de voz bloqueado: a etapa precisa estar em andamento.');
      return;
    }

    const instance = ensureRecognition();
    if (!instance) {
      setError('Este navegador não suporta Web Speech API para reconhecimento de voz.');
      return;
    }

    if (listeningMesa === mesa) {
      keepListeningRef.current = false;
      activeMesaRef.current = null;
      setListeningMesa(null);
      instance.stop();
      return;
    }

    keepListeningRef.current = false;
    instance.stop();

    activeMesaRef.current = mesa;
    keepListeningRef.current = true;
    setListeningMesa(mesa);

    try {
      instance.start();
    } catch {
      setListeningMesa(null);
      keepListeningRef.current = false;
      activeMesaRef.current = null;
      setError('Não foi possível iniciar o microfone agora. Tente novamente em alguns segundos.');
    }
  };

  const refreshEtapas = async () => {
    const { data, error: etapasError } = await supabase
      .from('etapas')
      .select('id, codigo_etapa, data_etapa, status')
      .order('data_etapa', { ascending: false });

    if (etapasError) {
      setError(`Erro ao atualizar etapas: ${etapasError.message}`);
      return;
    }

    const refreshed = (data ?? []).map((row: any) => ({
      id: Number(row.id),
      codigo_etapa: String(row.codigo_etapa),
      data_etapa: String(row.data_etapa),
      status: toEtapaStatus(row.status),
    })) as Etapa[];

    setEtapas(refreshed);

    if (selectedEtapaId && refreshed.some((item) => String(item.id) === selectedEtapaId)) {
      const current = refreshed.find((item) => String(item.id) === selectedEtapaId);
      if (current?.status === 'finalizada') {
        const firstAvailable = refreshed.find((item) => item.status === 'pendente' || item.status === 'em_andamento');
        setSelectedEtapaId(firstAvailable ? String(firstAvailable.id) : '');
      }
      return;
    }

    const firstAvailable = refreshed.find((item) => item.status === 'pendente' || item.status === 'em_andamento');
    setSelectedEtapaId(firstAvailable ? String(firstAvailable.id) : '');
  };

  const handleIniciarEtapa = async () => {
    if (!selectedEtapaId) {
      setError('Selecione uma etapa para iniciar.');
      return;
    }

    setIsSaving(true);
    setError(null);
    setMessage(null);

    const etapaIdNum = Number(selectedEtapaId);

    const { error: updateError } = await supabase
      .from('etapas')
      .update({ status: 'em_andamento' })
      .eq('id', etapaIdNum);

    if (updateError) {
      setError(`Erro ao iniciar etapa: ${updateError.message}`);
      setIsSaving(false);
      return;
    }

    const generatedPins: MesaPinState = {
      1: generateMesaPin(),
      2: generateMesaPin(),
      3: generateMesaPin(),
    };

    const pinsPayload = ([1, 2, 3] as Array<1 | 2 | 3>).map((mesa) => ({
      etapa_id: etapaIdNum,
      numero_mesa: mesa,
      pin_codigo: generatedPins[mesa],
    }));

    const { error: pinError } = await supabase.from('etapa_mesa_pins').upsert(pinsPayload, {
      onConflict: 'etapa_id,numero_mesa',
    });

    if (pinError) {
      setError(`Etapa iniciada, mas houve erro ao gerar PINs das mesas: ${pinError.message}`);
      setIsSaving(false);
      return;
    }

    setMesaPins(generatedPins);
    setMesaUnlocked(canViewAdminTab ? { 1: true, 2: true, 3: true } : { 1: false, 2: false, 3: false });

    await refreshEtapas();
    setMessage(
      `Etapa iniciada. PINs: Mesa 1 = ${generatedPins[1]} | Mesa 2 = ${generatedPins[2]} | Mesa 3 = ${generatedPins[3]}`,
    );
    setIsSaving(false);
  };

  const handleFinalizarEtapa = async () => {
    if (!selectedEtapaId) {
      setError('Selecione uma etapa para finalizar.');
      return;
    }

    setIsSaving(true);
    setError(null);
    setMessage(null);

    const etapaIdNum = Number(selectedEtapaId);

    const { error: updateEtapaError } = await supabase.from('etapas').update({ status: 'finalizada' }).eq('id', etapaIdNum);

    if (updateEtapaError) {
      setError(`Erro ao finalizar status da etapa: ${updateEtapaError.message}`);
      setIsSaving(false);
      return;
    }

    keepListeningRef.current = false;
    activeMesaRef.current = null;
    setListeningMesa(null);
    recognitionRef.current?.stop();

    await refreshEtapas();
    setMessage('Etapa finalizada. Registros temporários mantidos para pré-preenchimento na tela de Resultados.');
    setIsSaving(false);
  };

  const renderAdminTab = () => {
    return (
      <div className="grid gap-5 rounded-2xl border border-[#2d4659]/70 bg-[#0d2431]/80 p-5 shadow-[0_14px_34px_rgba(0,0,0,0.35)] sm:p-6">
        <h2 className="text-lg font-semibold text-slate-100">Controle da Etapa</h2>

        <label className="grid gap-2 text-sm text-slate-300">
          Etapa para gerenciamento
          <select
            className="w-full rounded-xl border border-[#3b5c73] bg-[#0b1d2b] px-3 py-2 text-slate-100 outline-none transition focus:border-[#ff7e38]"
            value={selectedEtapaId}
            onChange={(event) => setSelectedEtapaId(event.target.value)}
          >
            <option value="">Selecione uma etapa</option>
            {filteredEtapas.map((item) => (
              <option key={item.id} value={String(item.id)}>
                {item.codigo_etapa} - {new Date(item.data_etapa).toLocaleDateString('pt-BR')} ({item.status})
              </option>
            ))}
          </select>
        </label>

        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => void handleIniciarEtapa()}
            disabled={isSaving || !selectedEtapaId}
            className="rounded-xl bg-emerald-500 px-4 py-2 text-sm font-semibold text-emerald-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Iniciar Etapa
          </button>

          <button
            type="button"
            onClick={() => void handleFinalizarEtapa()}
            disabled={isSaving || !selectedEtapaId}
            className="rounded-xl bg-[#ff5e00] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#ff7d32] disabled:cursor-not-allowed disabled:opacity-50"
          >
            Finalizar Etapa
          </button>
        </div>

        <p className="rounded-xl border border-[#264458] bg-[#0a1c2a] px-3 py-2 text-xs text-slate-300">
          Ao finalizar, os dados de <span className="font-semibold text-slate-100">registros_mesas_temp</span> ficam
          disponíveis para pré-preenchimento em <span className="font-semibold text-slate-100">Resultados</span>. O
          salvamento oficial em <span className="font-semibold text-slate-100">registros_etapa</span> ocorre apenas na
          tela de Resultados.
        </p>

        {selectedEtapa?.status === 'em_andamento' ? (
          <div className="grid gap-2 rounded-xl border border-[#2c4e65] bg-[#0a1f2d] p-3 text-sm text-slate-200 sm:grid-cols-3">
            <p className="font-semibold">Mesa 1 PIN: {mesaPins[1] || '----'}</p>
            <p className="font-semibold">Mesa 2 PIN: {mesaPins[2] || '----'}</p>
            <p className="font-semibold">Mesa 3 PIN: {mesaPins[3] || '----'}</p>
          </div>
        ) : null}
      </div>
    );
  };

  const renderMesaTab = (mesa: 1 | 2 | 3) => {
    const rows = mesas[mesa];
    const pinRequired = !canViewAdminTab;
    const unlocked = canViewAdminTab ? true : mesaUnlocked[mesa];
    const blockedByEtapa = !etapaEmAndamento;
    const blockedByPin = pinRequired && !unlocked;
    const blocked = blockedByEtapa || blockedByPin;
    const availablePlayers = jogadores.filter((item) => !jogadorMesaAtualMap.has(item.id));

    return (
      <div className="grid gap-5 rounded-2xl border border-[#2d4659]/70 bg-[#0d2431]/80 p-5 shadow-[0_14px_34px_rgba(0,0,0,0.35)] sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-slate-100">Mesa {mesa} - Tela do Mesário</h2>

          {ENABLE_SPEECH_TO_TEXT ? (
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => toggleMesaVoice(mesa)}
                disabled={!speechSupported || blocked}
                className={[
                  'rounded-xl px-4 py-2 text-sm font-semibold transition',
                  listeningMesa === mesa
                    ? 'bg-rose-500 text-white hover:bg-rose-400'
                    : 'bg-[#1b3e52] text-slate-100 hover:bg-[#255773]',
                  (!speechSupported || blocked) && 'cursor-not-allowed opacity-50',
                ].join(' ')}
              >
                {listeningMesa === mesa ? 'Parar Microfone' : 'Ativar Microfone'}
              </button>

              {listeningMesa === mesa ? (
                <span className="animate-pulse rounded-lg border border-rose-300/40 bg-rose-500/20 px-3 py-1 text-xs font-semibold text-rose-200">
                  🎙️ Ouvindo Mesa {mesa}...
                </span>
              ) : null}
            </div>
          ) : null}
        </div>

        {ENABLE_SPEECH_TO_TEXT && !speechSupported ? (
          <p className="rounded-xl border border-amber-300/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
            Seu navegador não possui suporte para Web Speech API.
          </p>
        ) : null}

        {ENABLE_SPEECH_TO_TEXT && speechSupported ? (
          <p className="rounded-xl border border-[#2c4e65] bg-[#0a1f2d] px-3 py-2 text-sm text-slate-300">
            <span className="font-semibold text-slate-100">Último áudio reconhecido:</span>{' '}
            {lastVoiceTextByMesa[mesa] ? `"${lastVoiceTextByMesa[mesa]}"` : 'aguardando fala...'}
          </p>
        ) : null}

        {pinRequired ? (
          <div className="rounded-xl border border-[#2c4e65] bg-[#0a1f2d] p-3">
            <p className="text-sm text-slate-200">
              <span className="font-semibold">Acesso da Mesa {mesa}:</span>{' '}
              {unlocked ? 'liberado.' : 'insira o PIN de 4 dígitos para começar os registros.'}
            </p>

            {!unlocked ? (
              <div className="mt-3 flex flex-wrap items-end gap-3">
                <label className="grid gap-1 text-xs text-slate-300">
                  PIN da Mesa {mesa}
                  <input
                    type="password"
                    inputMode="numeric"
                    maxLength={4}
                    value={pinInputByMesa[mesa]}
                    onChange={(event) =>
                      setPinInputByMesa((current) => ({
                        ...current,
                        [mesa]: event.target.value.replace(/\D/g, '').slice(0, 4),
                      }))
                    }
                    className="w-32 rounded-lg border border-[#3b5c73] bg-[#0b1d2b] px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-[#ff7e38]"
                    placeholder="0000"
                  />
                </label>

                <button
                  type="button"
                  onClick={() => unlockMesaWithPin(mesa)}
                  className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-emerald-950 transition hover:bg-emerald-400"
                >
                  Liberar Mesa
                </button>
              </div>
            ) : null}
          </div>
        ) : null}

        {blockedByEtapa ? (
          <p className="rounded-xl border border-amber-300/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
            Registros bloqueados para a Mesa {mesa}. Esta etapa está {selectedEtapa?.status ?? 'sem status'}.
          </p>
        ) : null}

        {blockedByPin ? (
          <p className="rounded-xl border border-amber-300/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
            Registros da Mesa {mesa} bloqueados até validação do PIN do mesário.
          </p>
        ) : null}

        <div className="flex flex-wrap items-end gap-3 rounded-xl border border-[#1e3d4f] bg-[#091c2a] p-3">
          <label className="grid min-w-[220px] flex-1 gap-2 text-sm text-slate-300">
            Adicionar jogador
            <select
              className="w-full rounded-lg border border-[#3b5c73] bg-[#0b1d2b] px-3 py-2 text-slate-100 outline-none transition focus:border-[#ff7e38]"
              value={novoJogadorByMesa[mesa]}
              onChange={(event) =>
                setNovoJogadorByMesa((current) => ({
                  ...current,
                  [mesa]: event.target.value,
                }))
              }
              disabled={blocked}
            >
              <option value="">Selecione...</option>
              {availablePlayers.map((item) => (
                <option key={item.id} value={String(item.id)}>
                  {item.nome}
                </option>
              ))}
            </select>
          </label>

          <button
            type="button"
            onClick={() => void handleAddJogador(mesa)}
            disabled={blocked || !novoJogadorByMesa[mesa]}
            className="rounded-lg bg-[#ff5e00] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#ff7d32] disabled:cursor-not-allowed disabled:opacity-50"
          >
            Adicionar
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-[#2b4b61] text-left text-xs uppercase tracking-[0.08em] text-slate-300">
                <th className="px-3 py-2">Jogador</th>
                <th className="px-3 py-2">Rebuys</th>
                <th className="px-3 py-2">Add-on</th>
                <th className="px-3 py-2">Mover</th>
                <th className="px-3 py-2">Ações</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-3 py-4 text-center text-slate-400">
                    Nenhum jogador alocado nesta mesa.
                  </td>
                </tr>
              ) : (
                rows.map((row) => {
                  const highlighted = flashByMesa[mesa] === row.jogadorId;

                  return (
                    <tr
                      key={row.jogadorId}
                      className={[
                        'border-b border-[#183244] transition duration-300',
                        highlighted && 'bg-emerald-400/18 shadow-[inset_0_0_0_1px_rgba(74,222,128,0.45)]',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                    >
                      <td className="px-3 py-2 font-medium text-slate-100">{row.nome}</td>

                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => void handleRebuyChange(mesa, row.jogadorId, -1)}
                            disabled={blocked || row.rebuys <= 0}
                            className="h-8 w-8 rounded-md border border-[#3b5c73] bg-[#0d2431] text-lg text-slate-200 transition hover:bg-[#183a4f] disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            -
                          </button>
                          <span className="inline-flex min-w-8 justify-center text-slate-100">{row.rebuys}</span>
                          <button
                            type="button"
                            onClick={() => void handleRebuyChange(mesa, row.jogadorId, 1)}
                            disabled={blocked}
                            className="h-8 w-8 rounded-md border border-[#3b5c73] bg-[#0d2431] text-lg text-slate-200 transition hover:bg-[#183a4f] disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            +
                          </button>
                        </div>
                      </td>

                      <td className="px-3 py-2">
                        <label className="inline-flex items-center gap-2 text-slate-200">
                          <input
                            type="checkbox"
                            checked={row.fezAddon}
                            onChange={(event) => void handleAddonToggle(mesa, row.jogadorId, event.target.checked)}
                            disabled={blocked}
                            className="h-4 w-4 accent-emerald-500"
                          />
                          Sim
                        </label>
                      </td>

                      <td className="px-3 py-2">
                        <select
                          className="rounded-lg border border-[#3b5c73] bg-[#0b1d2b] px-2 py-1 text-slate-100 outline-none transition focus:border-[#ff7e38]"
                          value={String(mesa)}
                          onChange={(event) =>
                            void handleMoveJogador(mesa, row.jogadorId, Number(event.target.value) as 1 | 2 | 3)
                          }
                          disabled={blocked}
                        >
                          <option value="1">Mesa 1</option>
                          <option value="2">Mesa 2</option>
                          <option value="3">Mesa 3</option>
                        </select>
                      </td>

                      <td className="px-3 py-2">
                        <button
                          type="button"
                          onClick={() => void handleRemoveJogador(mesa, row.jogadorId)}
                          disabled={blocked}
                          className="rounded-lg border border-rose-400/40 bg-rose-500/10 px-3 py-1 text-xs font-semibold text-rose-200 transition hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          Remover
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  const activeMesa = parseMesaFromTab(tab);

  return (
    <section className="grid gap-6">
      <header className="rounded-2xl border border-[#2d4659]/70 bg-[#0d2431]/80 p-5 shadow-[0_14px_34px_rgba(0,0,0,0.35)]">
        <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[#ff8d4d]">Painel em tempo real</p>
        <h1 className="mt-2 text-2xl font-semibold text-slate-100 sm:text-3xl">Dia de Poker</h1>
        <p className="mt-2 text-sm text-slate-300">
          Controle de etapa, operação dos mesários e registro incremental de rebuys/add-on por voz e manual.
        </p>
      </header>

      <div className="rounded-2xl border border-[#2d4659]/70 bg-[#0d2431]/80 p-3 shadow-[0_14px_34px_rgba(0,0,0,0.35)]">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {visibleTabs.map((tabKey) => (
            <button
              key={tabKey}
              type="button"
              onClick={() => setTab(tabKey)}
              className={[
                'rounded-xl px-3 py-2 text-sm font-semibold transition',
                tab === tabKey
                  ? 'bg-[#ff5e00] text-white shadow-[0_8px_22px_rgba(255,94,0,0.35)]'
                  : 'bg-[#123042] text-slate-200 hover:bg-[#1b4661]',
              ].join(' ')}
            >
              {TAB_LABELS[tabKey]}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? <p className="text-sm text-slate-300">Carregando dados...</p> : null}

      {error ? <p className="rounded-xl border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">{error}</p> : null}
      {message ? (
        <p className="rounded-xl border border-emerald-400/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">{message}</p>
      ) : null}

      <div className="rounded-xl border border-[#264458] bg-[#0a1c2a] px-3 py-2 text-xs text-slate-300">
        <span className="font-semibold text-slate-100">Etapa selecionada:</span>{' '}
        {selectedEtapa
          ? `${selectedEtapa.codigo_etapa} (${new Date(selectedEtapa.data_etapa).toLocaleDateString('pt-BR')}) - ${selectedEtapa.status}`
          : 'nenhuma'}
      </div>

      {canViewAdminTab && tab === 'admin' ? renderAdminTab() : null}
      {activeMesa === 1 ? renderMesaTab(1) : null}
      {activeMesa === 2 ? renderMesaTab(2) : null}
      {activeMesa === 3 ? renderMesaTab(3) : null}
    </section>
  );
}
