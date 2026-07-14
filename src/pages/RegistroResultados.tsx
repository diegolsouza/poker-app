import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import supabase from '../supabaseClient';

type TipoRegistro = 'jogador' | 'visitante';

type Etapa = {
  id: number;
  codigo_etapa: string;
  data_etapa: string;
};

type Jogador = {
  id: number;
  nome: string;
};

type Configuracao = {
  custo_salao: number;
};

type PreJogoEtapaRow = {
  participant_ids: number[] | null;
};

type RegistroMesaTempRow = {
  jogador_id: number;
  rebuys: number | null;
  fez_addon: boolean | null;
};

type RegistroFormRow = {
  id: string;
  jogadorId: string;
  tipo: TipoRegistro;
  cozinheiro: boolean;
  jantou: boolean;
  melhorMao: boolean;
  colocacao: string;
  rebuys: string;
  fezAddon: boolean;
  pagouSalao: boolean;
  pagouJanta: string;
  outrosCustos: string;
};

type ParsedImportRow = {
  nome: string;
  tipo?: TipoRegistro;
  colocacao?: number;
  rebuys?: number;
  fezAddon?: boolean;
  jantou?: boolean;
  cozinheiro?: boolean;
  melhorMao?: boolean;
  pagouSalao?: boolean;
  pagouJanta?: number;
  outrosCustos?: number;
};

type ImportPreview = {
  rows: RegistroFormRow[];
  warnings: string[];
  encontrados: number;
};

type NameMatchResult = {
  jogadorId: string | null;
  nome: string | null;
  confidence: number;
  strategy: 'exact' | 'contains' | 'fuzzy' | 'none';
};

type OcrDebugInfo = {
  sourceName: string;
  sourceSizeKb: number;
  processingMs: number;
  confidence: number;
  wordsCount: number;
  totalNonEmptyLines: number;
  parsedCandidateLines: number;
  matchedPlayers: number;
  unmatchedPlayers: number;
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

function parseBooleanValue(value: string): boolean | undefined {
  const token = normalizeText(value);
  if (!token) return undefined;

  if (['sim', 's', 'true', 'ok', 'x', '1'].includes(token)) {
    return true;
  }

  if (['nao', 'n', 'false', '0'].includes(token)) {
    return false;
  }

  return undefined;
}

function parseMoneyValue(value: string): number | undefined {
  const cleaned = value.replace(/[^\d,.-]/g, '').trim();
  if (!cleaned) return undefined;

  const parsed = Number.parseFloat(cleaned.replace(/\./g, '').replace(',', '.'));
  if (Number.isNaN(parsed)) return undefined;

  return parsed;
}

function levenshteinDistance(a: string, b: string): number {
  if (a === b) {
    return 0;
  }

  if (a.length === 0) {
    return b.length;
  }

  if (b.length === 0) {
    return a.length;
  }

  const matrix: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));

  for (let i = 0; i <= a.length; i += 1) {
    matrix[i][0] = i;
  }

  for (let j = 0; j <= b.length; j += 1) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;

      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost,
      );
    }
  }

  return matrix[a.length][b.length];
}

function similarityScore(a: string, b: string): number {
  const maxLength = Math.max(a.length, b.length);
  if (maxLength === 0) {
    return 1;
  }

  return 1 - levenshteinDistance(a, b) / maxLength;
}

function buildOcrTemplateText(blankRows = 28): string {
  const header = [
    '# MODELO OCR - POKER',
    '# 1 linha por participante, mantendo os rótulos',
    '# Exemplo de linha preenchida:',
    '# NOME: JOAO SILVA | TIPO: jogador | COLOCACAO: 2 | REBUYS: 1 | ADDON: sim | JANTOU: sim | CHEF: nao | MELHOR MAO: nao | SALAO: nao | PAGOU JANTA: 32,50 | OUTROS: 0,00',
    '',
  ];

  const rows = Array.from({ length: blankRows }, (_, index) => {
    return `${index + 1}. NOME:  | TIPO: jogador | COLOCACAO:  | REBUYS: 0 | ADDON: nao | JANTOU: nao | CHEF: nao | MELHOR MAO: nao | SALAO: nao | PAGOU JANTA: 0,00 | OUTROS: 0,00`;
  });

  return [...header, ...rows].join('\n');
}

function parseParticipantLine(line: string): ParsedImportRow | null {
  const sanitized = line
    .replace(/[|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!sanitized || sanitized.length < 3) {
    return null;
  }

  const lowered = normalizeText(sanitized);
  const hasHint = /(rebuy|add on|addon|jant|chef|cozinh|melhor|salao|coloc|posicao|visitante|jogador|outros)/.test(lowered);
  if (!hasHint) {
    return null;
  }

  const nameCandidate = sanitized.split(/[-;:,]/)[0]?.trim() ?? '';
  if (!nameCandidate || /(rebuy|add on|addon|jant|chef|cozinh|melhor|salao|coloc|posicao|visitante|jogador)/i.test(nameCandidate)) {
    return null;
  }

  const row: ParsedImportRow = { nome: nameCandidate };

  const tipoMatch = sanitized.match(/\b(visitante|jogador)\b/i);
  if (tipoMatch) {
    row.tipo = normalizeText(tipoMatch[1]) === 'visitante' ? 'visitante' : 'jogador';
  }

  const colocacaoMatch = sanitized.match(/(?:coloc(?:acao)?|pos(?:icao)?|lugar)\s*[:=]?\s*(10\+?|[1-9])\b/i);
  const ordinalMatch = sanitized.match(/\b(10\+?|[1-9])\s*º/i);
  const colocacaoValue = colocacaoMatch?.[1] ?? ordinalMatch?.[1];
  if (colocacaoValue) {
    row.colocacao = colocacaoValue.startsWith('10') ? 10 : Number.parseInt(colocacaoValue, 10);
  }

  const rebuysTimesMatch = sanitized.match(/(\d+)\s*x\s*rebuys?/i);
  const rebuysDirectMatch = sanitized.match(/rebuys?\s*[:=]?\s*(\d+)/i);
  const rebuysValue = rebuysTimesMatch?.[1] ?? rebuysDirectMatch?.[1];
  if (rebuysValue) {
    row.rebuys = Number.parseInt(rebuysValue, 10);
  }

  const addonMatch = sanitized.match(/(?:add\s*on|addon)\s*[:=]?\s*(sim|nao|não|s|n|1|0|x|ok|true|false)?/i);
  if (addonMatch) {
    row.fezAddon = addonMatch[1] ? parseBooleanValue(addonMatch[1]) ?? true : true;
  }

  const jantouMatch = sanitized.match(/jantou\s*[:=]?\s*(sim|nao|não|s|n|1|0|x|ok|true|false)/i);
  if (jantouMatch) {
    row.jantou = parseBooleanValue(jantouMatch[1]);
  }

  const cozinheiroMatch = sanitized.match(/(?:cozinheiro|chef)\s*[:=]?\s*(sim|nao|não|s|n|1|0|x|ok|true|false)/i);
  if (cozinheiroMatch) {
    row.cozinheiro = parseBooleanValue(cozinheiroMatch[1]);
  }

  const melhorMaoMatch = sanitized.match(/(?:melhor\s*mao|m\.?\s*mao)\s*[:=]?\s*(sim|nao|não|s|n|1|0|x|ok|true|false)/i);
  if (melhorMaoMatch) {
    row.melhorMao = parseBooleanValue(melhorMaoMatch[1]);
  }

  const salaoMatch = sanitized.match(/(?:pagou\s*salao|salao\s*pagador|salao)\s*[:=]?\s*(sim|nao|não|s|n|1|0|x|ok|true|false)/i);
  if (salaoMatch) {
    row.pagouSalao = parseBooleanValue(salaoMatch[1]);
  }

  const pagouJantaMatch = sanitized.match(/(?:pagou\s*janta|janta\s*\(pagou\)|pagou_janta)\s*[:=]?\s*([\d.,]+)/i);
  if (pagouJantaMatch) {
    row.pagouJanta = parseMoneyValue(pagouJantaMatch[1]);
  }

  const outrosMatch = sanitized.match(/(?:outros|outros\s*custos?)\s*[:=]?\s*([\d.,]+)/i);
  if (outrosMatch) {
    row.outrosCustos = parseMoneyValue(outrosMatch[1]);
  }

  return row;
}

function parseIntOrNull(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const parsed = Number.parseInt(trimmed, 10);
  return Number.isNaN(parsed) ? null : parsed;
}

function parseFloatOrNull(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const parsed = Number.parseFloat(trimmed.replace(',', '.'));
  return Number.isNaN(parsed) ? null : parsed;
}

function createEmptyRow(): RegistroFormRow {
  return {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    jogadorId: '',
    tipo: 'jogador',
    cozinheiro: false,
    jantou: false,
    melhorMao: false,
    colocacao: '',
    rebuys: '0',
    fezAddon: false,
    pagouSalao: false,
    pagouJanta: '',
    outrosCustos: '',
  };
}

function createFilledRow(jogadorId: string): RegistroFormRow {
  return {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    jogadorId,
    tipo: 'jogador',
    cozinheiro: false,
    jantou: false,
    melhorMao: false,
    colocacao: '',
    rebuys: '0',
    fezAddon: false,
    pagouSalao: false,
    pagouJanta: '',
    outrosCustos: '',
  };
}

function ensureTrailingEmptyRow(rows: RegistroFormRow[]): RegistroFormRow[] {
  if (rows.length === 0) {
    return [createEmptyRow()];
  }

  const lastRow = rows[rows.length - 1];
  if (lastRow.jogadorId) {
    return [...rows, createEmptyRow()];
  }

  return rows;
}

const SHOW_OCR_TOOLS = false;

export default function RegistroResultados() {
  const [etapas, setEtapas] = useState<Etapa[]>([]);
  const [jogadores, setJogadores] = useState<Jogador[]>([]);

  const [etapaId, setEtapaId] = useState('');
  const [custoSalao, setCustoSalao] = useState(0);
  const [rows, setRows] = useState<RegistroFormRow[]>([createEmptyRow()]);

  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isOcrLoading, setIsOcrLoading] = useState(false);
  const [isCameraModalOpen, setIsCameraModalOpen] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [ocrRawText, setOcrRawText] = useState('');
  const [ocrError, setOcrError] = useState<string | null>(null);
  const [ocrDebugInfo, setOcrDebugInfo] = useState<OcrDebugInfo | null>(null);
  const [importPreviewRows, setImportPreviewRows] = useState<RegistroFormRow[]>([]);
  const [importWarnings, setImportWarnings] = useState<string[]>([]);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const printFrameRef = useRef<HTMLIFrameElement | null>(null);

  const etapaSelecionada = useMemo(() => {
    return etapas.find((etapa) => String(etapa.id) === etapaId) ?? null;
  }, [etapaId, etapas]);

  const stopCameraStream = () => {
    cameraStreamRef.current?.getTracks().forEach((track) => track.stop());
    cameraStreamRef.current = null;
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  };

  useEffect(() => {
    const loadData = async () => {
      setIsLoading(true);
      setError(null);

      const [etapasResult, jogadoresResult, configuracaoResult] = await Promise.all([
        supabase.from('etapas').select('id, codigo_etapa, data_etapa').order('data_etapa', { ascending: false }),
        supabase.from('jogadores').select('id, nome').eq('ativo', true).order('nome', { ascending: true }),
        supabase.from('configuracoes').select('custo_salao').eq('id', 1).maybeSingle(),
      ]);

      if (etapasResult.error) {
        setError(`Erro ao carregar etapas: ${etapasResult.error.message}`);
      } else {
        const etapasData = (etapasResult.data ?? []) as Etapa[];
        setEtapas(etapasData);

        if (etapasData.length > 0) {
          setEtapaId(String(etapasData[0].id));
        }
      }

      if (jogadoresResult.error) {
        setError(`Erro ao carregar jogadores: ${jogadoresResult.error.message}`);
      } else {
        setJogadores((jogadoresResult.data ?? []) as Jogador[]);
      }

      if (configuracaoResult.error) {
        setError(`Erro ao carregar configurações: ${configuracaoResult.error.message}`);
      } else {
        const configuracao = configuracaoResult.data as Configuracao | null;
        setCustoSalao(Number(configuracao?.custo_salao ?? 0));
      }

      setIsLoading(false);
    };

    void loadData();
  }, []);

  useEffect(() => {
    const loadPreJogoParticipants = async () => {
      if (!etapaId || jogadores.length === 0) {
        setRows([createEmptyRow()]);
        return;
      }

      const { data: tempRowsData, error: tempRowsError } = await supabase
        .from('registros_mesas_temp')
        .select('jogador_id, rebuys, fez_addon')
        .eq('etapa_id', Number(etapaId));

      if (tempRowsError) {
        setError(`Não foi possível carregar pré-registros das mesas para esta etapa: ${tempRowsError.message}`);
        setRows([createEmptyRow()]);
        return;
      }

      const tempRows = (tempRowsData ?? []) as RegistroMesaTempRow[];
      if (tempRows.length > 0) {
        const activeJogadoresSet = new Set(jogadores.map((jogador) => jogador.id));
        const uniqueByJogador = new Map<number, RegistroMesaTempRow>();

        tempRows.forEach((row) => {
          if (activeJogadoresSet.has(row.jogador_id)) {
            uniqueByJogador.set(row.jogador_id, row);
          }
        });

        const preloadedRows = Array.from(uniqueByJogador.values()).map((row) => ({
          ...createFilledRow(String(row.jogador_id)),
          rebuys: String(Math.max(0, Number(row.rebuys ?? 0))),
          fezAddon: Boolean(row.fez_addon),
        }));

        if (preloadedRows.length > 0) {
          setRows(ensureTrailingEmptyRow(preloadedRows));
          setSuccess(`Lista pré-carregada com ${preloadedRows.length} participante(s) das mesas.`);
          setError(null);
          return;
        }
      }

      const { data, error: preJogoError } = await supabase
        .from('pre_jogo_etapa')
        .select('participant_ids')
        .eq('etapa_id', Number(etapaId))
        .maybeSingle();

      if (preJogoError) {
        setError(`Não foi possível carregar participantes do Pré-jogo para esta etapa: ${preJogoError.message}`);
        setRows([createEmptyRow()]);
        return;
      }

      const participantIds = (data as PreJogoEtapaRow | null)?.participant_ids ?? [];
      const activeJogadoresSet = new Set(jogadores.map((jogador) => jogador.id));
      const availableParticipantIds = Array.from(new Set(participantIds)).filter((id) => activeJogadoresSet.has(id));

      if (availableParticipantIds.length === 0) {
        setRows([createEmptyRow()]);
        return;
      }

      const preloadedRows = availableParticipantIds.map((id) => createFilledRow(String(id)));
      setRows(ensureTrailingEmptyRow(preloadedRows));
      setSuccess(`Lista manual pré-carregada com ${availableParticipantIds.length} participante(s) do Pré-jogo.`);
      setError(null);
    };

    void loadPreJogoParticipants();
  }, [etapaId, jogadores]);

  const resetForm = () => {
    setRows([createEmptyRow()]);
  };

  const jogadoresPorNome = useMemo(() => {
    return jogadores.map((jogador) => ({
      id: String(jogador.id),
      nome: jogador.nome,
      normalized: normalizeText(jogador.nome),
    }));
  }, [jogadores]);

  const findJogadorFromName = (nome: string): NameMatchResult => {
    const normalized = normalizeText(nome);
    if (!normalized) {
      return { jogadorId: null, nome: null, confidence: 0, strategy: 'none' };
    }

    const exactMatch = jogadoresPorNome.find((item) => item.normalized === normalized);
    if (exactMatch) {
      return { jogadorId: exactMatch.id, nome: exactMatch.nome, confidence: 1, strategy: 'exact' };
    }

    const includesMatch = jogadoresPorNome.filter(
      (item) => item.normalized.includes(normalized) || normalized.includes(item.normalized),
    );

    if (includesMatch.length === 1) {
      return {
        jogadorId: includesMatch[0].id,
        nome: includesMatch[0].nome,
        confidence: 0.9,
        strategy: 'contains',
      };
    }

    const fuzzyCandidates = jogadoresPorNome
      .map((item) => ({ item, score: similarityScore(normalized, item.normalized) }))
      .sort((a, b) => b.score - a.score);

    const best = fuzzyCandidates[0];
    const second = fuzzyCandidates[1];
    const minAcceptScore = 0.72;
    const minGap = 0.08;

    if (best && best.score >= minAcceptScore && (!second || best.score - second.score >= minGap)) {
      return {
        jogadorId: best.item.id,
        nome: best.item.nome,
        confidence: Number(best.score.toFixed(2)),
        strategy: 'fuzzy',
      };
    }

    return { jogadorId: null, nome: null, confidence: 0, strategy: 'none' };
  };

  const buildImportPreview = (parsedRows: ParsedImportRow[]): ImportPreview => {
    const warnings: string[] = [];
    let pagadorSalaoDetectado = false;

    const previewRows: RegistroFormRow[] = parsedRows.flatMap((parsed) => {
      const match = findJogadorFromName(parsed.nome);
      if (!match.jogadorId) {
        warnings.push(`Jogador não encontrado automaticamente: ${parsed.nome}`);
        return [];
      }

      if (match.strategy === 'fuzzy' && match.nome) {
        warnings.push(`Nome aproximado: "${parsed.nome}" -> "${match.nome}" (${Math.round(match.confidence * 100)}%).`);
      }

      const isPagadorSalao = parsed.pagouSalao === true && !pagadorSalaoDetectado;
      if (parsed.pagouSalao === true) {
        pagadorSalaoDetectado = true;
      }

      return [
        {
          id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
          jogadorId: match.jogadorId,
          tipo: parsed.tipo ?? 'jogador',
          cozinheiro: parsed.cozinheiro ?? false,
          jantou: parsed.cozinheiro ? false : (parsed.jantou ?? false),
          melhorMao: parsed.melhorMao ?? false,
          colocacao: parsed.tipo === 'visitante' ? '' : parsed.colocacao ? String(parsed.colocacao) : '',
          rebuys: String(parsed.rebuys ?? 0),
          fezAddon: parsed.fezAddon ?? false,
          pagouSalao: isPagadorSalao,
          pagouJanta: parsed.pagouJanta !== undefined ? String(parsed.pagouJanta).replace('.', ',') : '',
          outrosCustos: parsed.outrosCustos !== undefined ? String(parsed.outrosCustos).replace('.', ',') : '',
        },
      ];
    });

    if (parsedRows.some((row) => row.pagouSalao) && !previewRows.some((row) => row.pagouSalao)) {
      warnings.push('Foi detectado pagador do salão, mas não foi possível associar o nome automaticamente.');
    }

    return {
      rows: previewRows,
      warnings,
      encontrados: previewRows.length,
    };
  };

  const handleLoadOcrTemplate = () => {
    setOcrRawText(buildOcrTemplateText());
    setImportPreviewRows([]);
    setImportWarnings([]);
    setOcrError(null);
    setOcrDebugInfo(null);
    setSuccess('Modelo OCR carregado no campo de texto.');
  };

  const processImageForImport = async (source: Blob | File, successMessage: string) => {
    setOcrError(null);
    setCameraError(null);
    setSuccess(null);
    setIsOcrLoading(true);
    const startedAt = performance.now();

    try {
      const tesseractModule = await import('tesseract.js');
      const worker = await tesseractModule.createWorker('por');

      try {
        const result = await worker.recognize(source);
        const rawText = result.data.text ?? '';
        setOcrRawText(rawText);

        const sourceName = source instanceof File ? source.name : 'captura-camera.jpg';
        const sourceSizeKb = Math.round((source.size / 1024) * 10) / 10;
        const processingMs = Math.round(performance.now() - startedAt);
        const wordsCount = rawText
          .split(/\s+/)
          .map((token) => token.trim())
          .filter((token) => token.length > 0).length;
        const confidence = Math.round((result.data.confidence ?? 0) * 10) / 10;
        const totalNonEmptyLines = rawText
          .split('\n')
          .map((line) => line.trim())
          .filter((line) => line.length > 0).length;

        setOcrDebugInfo({
          sourceName,
          sourceSizeKb,
          processingMs,
          confidence,
          wordsCount,
          totalNonEmptyLines,
          parsedCandidateLines: 0,
          matchedPlayers: 0,
          unmatchedPlayers: 0,
        });

        setSuccess(successMessage);
      } finally {
        await worker.terminate();
      }
    } catch {
      setOcrError('Não foi possível processar a imagem. Tente uma foto mais nítida e com boa iluminação.');
    } finally {
      setIsOcrLoading(false);
    }
  };

  const handlePrintOcrTemplate = () => {
    const etapaTitulo = etapaSelecionada
      ? `${etapaSelecionada.codigo_etapa} - ${new Date(etapaSelecionada.data_etapa).toLocaleDateString('pt-BR')}`
      : 'Etapa não selecionada';
    const logoUrl = `${window.location.origin}/logo.png`;

    const linhasTemplate = Array.from({ length: 28 }, (_, index) => {
      return `
        <tr>
          <td class="num-col">${index + 1}</td>
          <td class="mark-col"><span class="circle"></span></td>
          <td class="name-col"></td>
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

    const iframe = printFrameRef.current;
    if (!iframe?.contentWindow || !iframe.contentDocument) {
      setOcrError('Não foi possível preparar a impressão neste navegador.');
      return;
    }

    const html = `
      <html>
        <head>
          <title>Modelo OCR - Poker</title>
          <style>
            @page { size: A4 landscape; margin: 10mm; }
            * { box-sizing: border-box; }
            body { font-family: Arial, sans-serif; margin: 0; color: #111; }
            body { font-family: Arial, sans-serif; margin: 0; color: #111; }
            h1 { margin: 0 0 4px 0; font-size: 16px; }
            p { margin: 2px 0; font-size: 9px; }
            table { width: 100%; border-collapse: collapse; margin-top: 8px; table-layout: fixed; }
            th, td { border: 1px solid #333; padding: 2px; font-size: 8px; text-align: center; height: 20px; vertical-align: middle; }
            th { background: #f0f0f0; font-size: 7px; line-height: 1.15; }
            .small-text { font-size: 8px; color: #444; }
            .num-col { width: 28px; font-weight: 700; }
            .mark-col { width: 30px; }
            .name-col { width: 170px; text-align: left; }
            .rebuy-col { width: 190px; }
            .money-col { width: 64px; }
            .place-col { width: 48px; }
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
            .print-header {
              display: flex;
              align-items: center;
              justify-content: space-between;
              gap: 10px;
            }
            .brand {
              display: flex;
              align-items: center;
              gap: 10px;
            }
            .brand img {
              width: 58px;
              height: auto;
              object-fit: contain;
            }
            .legend {
              display: grid;
              grid-template-columns: repeat(3, minmax(0, 1fr));
              gap: 6px;
              margin-top: 6px;
            }
            .legend div {
              border: 1px solid #bbb;
              padding: 4px 6px;
              font-size: 7px;
            }
          </style>
        </head>
        <body>
          <div class="print-header">
            <div class="brand">
              <img src="${logoUrl}" alt="Logo Poker" />
              <div>
                <h1>Modelo de Anotação OCR - Poker</h1>
                <p><strong>Etapa:</strong> ${etapaTitulo}</p>
                <p><strong>Data do preenchimento:</strong> ____/____/______</p>
              </div>
            </div>
          </div>
          <p class="small-text">Folha em paisagem para anotação manual. Pinte os círculos para marcar opções e escreva os valores nos campos em branco.</p>

          <div class="legend">
            <div><strong>Janta:</strong> círculo marcado = participante jantou.</div>
            <div><strong>Buy-in:</strong> círculo marcado = jogador. Em branco = visitante.</div>
            <div><strong>Rebuy:</strong> cada círculo pintado vale 1 rebuy.</div>
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
              ${linhasTemplate}
            </tbody>
          </table>
          <p class="small-text">Depois de fotografar a folha, envie a imagem no sistema para OCR e revisão.</p>
        </body>
      </html>
    `;

    iframe.contentDocument.open();
    iframe.contentDocument.write(html);
    iframe.contentDocument.close();

    window.setTimeout(() => {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
    }, 150);
  };

  const handleImageCaptureForImport = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    await processImageForImport(file, 'Imagem lida. Revise o texto reconhecido e clique em "Analisar texto".');
    event.target.value = '';
  };

  const handleOpenCameraModal = () => {
    setCameraError(null);
    setOcrError(null);
    setIsCameraModalOpen(true);
  };

  const handleCloseCameraModal = () => {
    stopCameraStream();
    setIsCameraModalOpen(false);
  };

  const handleCaptureCameraPhoto = async () => {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0 || video.videoHeight === 0) {
      setCameraError('A câmera ainda não ficou pronta. Aguarde um instante e tente novamente.');
      return;
    }

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    const context = canvas.getContext('2d');
    if (!context) {
      setCameraError('Não foi possível capturar a imagem da câmera.');
      return;
    }

    context.drawImage(video, 0, 0, canvas.width, canvas.height);

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((generatedBlob) => resolve(generatedBlob), 'image/jpeg', 0.92);
    });

    if (!blob) {
      setCameraError('Não foi possível gerar a foto capturada.');
      return;
    }

    handleCloseCameraModal();
    await processImageForImport(blob, 'Foto capturada. Revise o texto reconhecido e clique em "Analisar texto".');
  };

  useEffect(() => {
    if (!isCameraModalOpen) {
      stopCameraStream();
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError('Este navegador não suporta câmera embutida nesta tela. Use "Enviar foto" como alternativa.');
      return;
    }

    let isActive = true;

    const startCamera = async () => {
      try {
        const preferredStream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
          audio: false,
        });

        if (!isActive) {
          preferredStream.getTracks().forEach((track) => track.stop());
          return;
        }

        cameraStreamRef.current = preferredStream;
        if (videoRef.current) {
          videoRef.current.srcObject = preferredStream;
          await videoRef.current.play().catch(() => undefined);
        }
      } catch {
        try {
          const fallbackStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });

          if (!isActive) {
            fallbackStream.getTracks().forEach((track) => track.stop());
            return;
          }

          cameraStreamRef.current = fallbackStream;
          if (videoRef.current) {
            videoRef.current.srcObject = fallbackStream;
            await videoRef.current.play().catch(() => undefined);
          }
        } catch {
          setCameraError('Não foi possível acessar a câmera. Se a prévia ficar preta ou houver bloqueio, use "Enviar foto".');
        }
      }
    };

    void startCamera();

    return () => {
      isActive = false;
      stopCameraStream();
    };
  }, [isCameraModalOpen]);

  const handleAnalyzeImportText = () => {
    setOcrError(null);
    setSuccess(null);

    if (!ocrRawText.trim()) {
      setOcrError('Cole ou capture um texto antes de analisar.');
      setImportPreviewRows([]);
      setImportWarnings([]);
      setOcrDebugInfo((prev) =>
        prev
          ? {
              ...prev,
              totalNonEmptyLines: 0,
              parsedCandidateLines: 0,
              matchedPlayers: 0,
              unmatchedPlayers: 0,
            }
          : null,
      );
      return;
    }

    const nonEmptyLines = ocrRawText
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    const parsedRows = nonEmptyLines.map(parseParticipantLine).filter((item): item is ParsedImportRow => item !== null);

    const unmatchedPlayers = parsedRows.filter((item) => !findJogadorFromName(item.nome).jogadorId).length;

    setOcrDebugInfo((prev) =>
      prev
        ? {
            ...prev,
            totalNonEmptyLines: nonEmptyLines.length,
            parsedCandidateLines: parsedRows.length,
            matchedPlayers: parsedRows.length - unmatchedPlayers,
            unmatchedPlayers,
          }
        : {
            sourceName: 'texto-manual',
            sourceSizeKb: 0,
            processingMs: 0,
            confidence: 0,
            wordsCount: 0,
            totalNonEmptyLines: nonEmptyLines.length,
            parsedCandidateLines: parsedRows.length,
            matchedPlayers: parsedRows.length - unmatchedPlayers,
            unmatchedPlayers,
          },
    );

    if (parsedRows.length === 0) {
      setOcrError('Não consegui identificar linhas de participantes. Ajuste o texto e tente novamente.');
      setImportPreviewRows([]);
      setImportWarnings([]);
      return;
    }

    const preview = buildImportPreview(parsedRows);
    setImportPreviewRows(preview.rows);
    setImportWarnings(preview.warnings);

    if (preview.encontrados === 0) {
      setOcrError('Nenhum participante foi associado automaticamente. Revise os nomes no texto.');
      return;
    }

    setSuccess(`Importação pronta: ${preview.encontrados} participante(s) reconhecido(s).`);
  };

  const handleApplyImport = () => {
    if (importPreviewRows.length === 0) {
      setOcrError('Faça a análise do texto antes de aplicar.');
      return;
    }

    setRows(ensureTrailingEmptyRow(importPreviewRows));
    setSuccess(`Dados aplicados ao formulário: ${importPreviewRows.length} participante(s). Revise e salve.`);
  };

  const updateRow = (rowId: string, updater: (row: RegistroFormRow) => RegistroFormRow) => {
    setRows((prev) => {
      const updatedRows = prev.map((row) => (row.id === rowId ? updater(row) : row));
      return ensureTrailingEmptyRow(updatedRows);
    });
  };

  const handleJogadorChange = (rowId: string, jogadorId: string) => {
    updateRow(rowId, (row) => ({ ...row, jogadorId }));
  };

  const handleTipoChange = (rowId: string, tipo: TipoRegistro) => {
    updateRow(rowId, (row) => ({
      ...row,
      tipo,
      colocacao: tipo === 'visitante' ? '' : row.colocacao,
    }));
  };

  const handleCozinheiroChange = (rowId: string, checked: boolean) => {
    updateRow(rowId, (row) => ({
      ...row,
      cozinheiro: checked,
      jantou: checked ? false : row.jantou,
    }));
  };

  const handlePagouSalaoChange = (rowId: string, checked: boolean) => {
    setRows((prev) => {
      const updatedRows = prev.map((row) => {
        if (row.id === rowId) {
          return { ...row, pagouSalao: checked };
        }

        if (checked) {
          return { ...row, pagouSalao: false };
        }

        return row;
      });

      return ensureTrailingEmptyRow(updatedRows);
    });
  };

  const handleRemoveRow = (rowId: string) => {
    setRows((prev) => {
      const filtered = prev.filter((row) => row.id !== rowId);
      if (filtered.length === 0) {
        return [createEmptyRow()];
      }

      return ensureTrailingEmptyRow(filtered);
    });
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setSuccess(null);

    if (!etapaId) {
      setError('Selecione a etapa antes de registrar.');
      return;
    }

    const validRows = rows.filter((row) => row.jogadorId);

    if (validRows.length === 0) {
      setError('Preencha ao menos um participante para registrar.');
      return;
    }

    const jogadorIds = validRows.map((row) => row.jogadorId);
    const hasDuplicateJogador = new Set(jogadorIds).size !== jogadorIds.length;
    if (hasDuplicateJogador) {
      setError('Há participantes repetidos na lista. Ajuste antes de salvar.');
      return;
    }

    const qtdPagadoresSalao = validRows.filter((row) => row.pagouSalao).length;
    if (qtdPagadoresSalao > 1) {
      setError('Somente uma pessoa pode pagar o salão por etapa.');
      return;
    }

    setIsSaving(true);

    if (qtdPagadoresSalao === 1) {
      const { data: existentes, error: consultaSalaoError } = await supabase
        .from('registros_etapa')
        .select('id')
        .eq('etapa_id', Number(etapaId))
        .gt('pagou_salao', 0)
        .limit(1);

      if (consultaSalaoError) {
        setError(`Erro ao validar pagamento do salão: ${consultaSalaoError.message}`);
        setIsSaving(false);
        return;
      }

      if ((existentes ?? []).length > 0) {
        setError('Esta etapa já possui um participante marcado como pagador do salão.');
        setIsSaving(false);
        return;
      }
    }

    const payload = validRows.map((row) => ({
      etapa_id: Number(etapaId),
      jogador_id: Number(row.jogadorId),
      tipo_participante: row.tipo,
      jantou: row.cozinheiro ? false : row.jantou,
      cozinheiro: row.cozinheiro,
      melhor_mao: row.melhorMao,
      fez_addon: row.fezAddon,
      colocacao: row.tipo === 'visitante' ? null : parseIntOrNull(row.colocacao),
      rebuys: parseIntOrNull(row.rebuys) ?? 0,
      pagou_salao: row.pagouSalao ? custoSalao : null,
      pagou_janta: parseFloatOrNull(row.pagouJanta),
      outros_custos: parseFloatOrNull(row.outrosCustos),
    }));

    const { error: insertError } = await supabase.from('registros_etapa').insert(payload);

    if (insertError) {
      setError(`Erro ao registrar resultado: ${insertError.message}`);
      setIsSaving(false);
      return;
    }

    setSuccess('Resultado registrado com sucesso.');
    resetForm();
    setIsSaving(false);
  };

  const isDisabled = isLoading || isSaving;

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,rgba(255,94,0,0.08),transparent_24%),linear-gradient(180deg,#061019_0%,#07131d_40%,#081723_100%)] py-10 px-4 sm:px-6 lg:px-8">
      <section className="mx-auto w-full max-w-[1700px] rounded-3xl border border-[#244357] bg-[#081723]/92 p-6 shadow-[0_18px_45px_rgba(3,8,14,0.42)] sm:p-8">
        <header className="mb-6 flex flex-col gap-4 rounded-2xl border border-[#244357] bg-[#0c1f2c] px-5 py-4 shadow-[0_8px_22px_rgba(1,4,8,0.28)] lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-50">Registro de Resultados de Etapas</h1>
            <p className="mt-1 text-sm text-slate-300">Preencha os dados dos participantes e registre no Supabase.</p>
          </div>

          <label className="flex w-full max-w-sm flex-col gap-1 text-sm text-slate-200">
            Etapa
            <select
              value={etapaId}
              onChange={(event) => setEtapaId(event.target.value)}
              disabled={isDisabled}
              className="h-11 rounded-lg border border-[#244357] bg-[#0b1a25] px-3 text-slate-50 outline-none transition focus:border-[#ff5e00]"
              required
            >
              <option value="">Selecione uma etapa</option>
              {etapas.map((etapa) => (
                <option key={etapa.id} value={etapa.id}>
                  {etapa.codigo_etapa} - {new Date(etapa.data_etapa).toLocaleDateString('pt-BR')}
                </option>
              ))}
            </select>
          </label>
        </header>

        <form onSubmit={handleSubmit} className="space-y-6">
          {SHOW_OCR_TOOLS ? (
            <div className="rounded-2xl border border-[#244357] bg-[#0b1a25] p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-sm font-semibold text-slate-100">Importar por foto (OCR)</h2>
                <p className="text-xs text-slate-300">
                  Tire uma foto do papel no celular e pré-carregue os dados automaticamente para revisão.
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={handlePrintOcrTemplate}
                  disabled={isDisabled}
                  className="inline-flex h-9 items-center justify-center rounded-lg border border-[#315770] bg-[#102536] px-3 text-xs font-semibold text-slate-200 transition hover:border-[#ff9a63] hover:text-[#ffcfb2] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Imprimir modelo
                </button>

                <button
                  type="button"
                  onClick={handleLoadOcrTemplate}
                  disabled={isDisabled || isOcrLoading}
                  className="inline-flex h-9 items-center justify-center rounded-lg border border-[#315770] bg-[#102536] px-3 text-xs font-semibold text-slate-200 transition hover:border-[#ff9a63] hover:text-[#ffcfb2] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Carregar modelo no texto
                </button>

                <button
                  type="button"
                  onClick={handleOpenCameraModal}
                  disabled={isDisabled || isOcrLoading}
                  className="inline-flex h-9 items-center justify-center rounded-lg border border-[#315770] bg-[#102536] px-3 text-xs font-semibold text-slate-200 transition hover:border-[#ff9a63] hover:text-[#ffcfb2] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Usar câmera
                </button>

                <label className="inline-flex cursor-pointer items-center justify-center rounded-lg border border-[#315770] bg-[#102536] px-3 py-2 text-xs font-semibold text-slate-200 transition hover:border-[#ff9a63] hover:text-[#ffcfb2]">
                  {isOcrLoading ? 'Lendo imagem...' : 'Enviar foto'}
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleImageCaptureForImport}
                    disabled={isDisabled || isOcrLoading}
                  />
                </label>
              </div>
            </div>

            <p className="mt-2 text-[11px] text-slate-400">
              Dica OCR: use o modelo impresso, letra de forma, boa iluminação e foto tirada de cima.
            </p>

            <div className="mt-3 grid gap-3 lg:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-300">Texto reconhecido</label>
                <textarea
                  value={ocrRawText}
                  onChange={(event) => setOcrRawText(event.target.value)}
                  disabled={isDisabled || isOcrLoading}
                  className="h-44 w-full rounded-lg border border-[#244357] bg-[#081723] px-3 py-2 text-xs text-slate-100 outline-none transition focus:border-[#ff5e00]"
                  placeholder="Exemplo por linha: João - jogador - colocacao 2 - rebuys 1 - addon sim - jantou sim - pagou salao sim"
                />
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={handleAnalyzeImportText}
                    disabled={isDisabled || isOcrLoading}
                    className="inline-flex h-9 items-center justify-center rounded-lg border border-[#315770] bg-[#102536] px-3 text-xs font-semibold text-slate-200 transition hover:border-[#ff9a63] hover:text-[#ffcfb2] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Analisar texto
                  </button>
                  <button
                    type="button"
                    onClick={handleApplyImport}
                    disabled={isDisabled || importPreviewRows.length === 0}
                    className="inline-flex h-9 items-center justify-center rounded-lg bg-[#ff5e00] px-3 text-xs font-semibold text-white transition hover:bg-[#ff7a2f] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Aplicar no formulário
                  </button>
                </div>
              </div>

              <div className="rounded-lg border border-[#244357] bg-[#081723] p-3">
                <p className="text-xs font-semibold text-slate-200">Prévia da importação</p>
                {importPreviewRows.length === 0 ? (
                  <p className="mt-2 text-xs text-slate-400">Nenhum participante analisado ainda.</p>
                ) : (
                  <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto text-xs text-slate-300">
                    {importPreviewRows.map((row) => {
                      const nome = jogadores.find((jogador) => String(jogador.id) === row.jogadorId)?.nome ?? `ID ${row.jogadorId}`;
                      return (
                        <li key={row.id} className="rounded-md border border-[#2f5268] bg-[#102536] px-2 py-1">
                          {nome} | {row.tipo} | {row.colocacao || '-'}º | Rb {row.rebuys} | Add-on {row.fezAddon ? 'sim' : 'não'}
                        </li>
                      );
                    })}
                  </ul>
                )}

                {importWarnings.length > 0 ? (
                  <ul className="mt-3 space-y-1 text-xs text-amber-300">
                    {importWarnings.map((warning) => (
                      <li key={warning}>• {warning}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </div>

            {ocrDebugInfo ? (
              <details className="mt-3 rounded-lg border border-[#244357] bg-[#081723] p-3 text-xs text-slate-300">
                <summary className="cursor-pointer font-semibold text-[#ffb387]">Debug OCR</summary>
                <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                  <p>Arquivo: {ocrDebugInfo.sourceName}</p>
                  <p>Tamanho: {ocrDebugInfo.sourceSizeKb.toLocaleString('pt-BR')} KB</p>
                  <p>Tempo OCR: {ocrDebugInfo.processingMs.toLocaleString('pt-BR')} ms</p>
                  <p>Confiança OCR: {ocrDebugInfo.confidence.toLocaleString('pt-BR')}%</p>
                  <p>Palavras reconhecidas: {ocrDebugInfo.wordsCount.toLocaleString('pt-BR')}</p>
                  <p>Linhas não vazias: {ocrDebugInfo.totalNonEmptyLines.toLocaleString('pt-BR')}</p>
                  <p>Linhas candidatas: {ocrDebugInfo.parsedCandidateLines.toLocaleString('pt-BR')}</p>
                  <p>Nomes sem match: {ocrDebugInfo.unmatchedPlayers.toLocaleString('pt-BR')}</p>
                </div>
              </details>
            ) : null}

            {ocrError ? <p className="mt-3 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">{ocrError}</p> : null}
            </div>
          ) : null}

          <div className="rounded-2xl border border-[#244357] bg-[#0b1a25] p-4">
            <div className="mb-3 flex items-center justify-between gap-4">
              <p className="text-sm text-slate-300">Preencha uma linha por participante. Ao selecionar um nome, uma nova linha vazia é criada automaticamente abaixo.</p>
              <span className="text-xs font-medium text-[#ff9a63]">Salão por pagador: R$ {custoSalao.toFixed(2)}</span>
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-[1140px] w-full border-collapse text-[11px] leading-tight text-slate-200">
                <thead className="bg-[#102536] text-slate-100">
                  <tr>
                    <th className="w-[56px] px-1 py-1.5 text-center font-semibold">Janta</th>
                    <th className="w-[140px] px-1 py-1.5 text-left font-semibold">Nome</th>
                    <th className="w-[58px] px-1 py-1.5 text-left font-semibold">Tipo</th>
                    <th className="w-[56px] px-1 py-1.5 text-left font-semibold">Rebuys</th>
                    <th className="w-[56px] px-1 py-1.5 text-center font-semibold">Add On</th>
                    <th className="w-[74px] px-1 py-1.5 text-left font-semibold">Pagou Janta</th>
                    <th className="w-[56px] px-1 py-1.5 text-center font-semibold">Salão</th>
                    <th className="w-[74px] px-1 py-1.5 text-left font-semibold">Outros Custos</th>
                    <th className="w-[56px] px-1 py-1.5 text-center font-semibold">Chef</th>
                    <th className="w-[62px] px-1 py-1.5 text-center font-semibold">Melhor Mão</th>
                    <th className="w-[58px] px-1 py-1.5 text-left font-semibold">Colocação</th>
                    <th className="w-[46px] px-1 py-1.5 text-center font-semibold">Rem.</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id} className="border-t border-[#244357]">
                      <td className="px-1 py-1.5 text-center">
                        <input
                          type="checkbox"
                          checked={row.jantou}
                          onChange={(event) => updateRow(row.id, (current) => ({ ...current, jantou: event.target.checked }))}
                          disabled={isDisabled || !row.jogadorId || row.cozinheiro}
                          className="h-4 w-4 rounded border-slate-500 bg-[#0b1a25]"
                        />
                      </td>
                      <td className="px-1 py-1.5">
                        <select
                          value={row.jogadorId}
                          onChange={(event) => handleJogadorChange(row.id, event.target.value)}
                          disabled={isDisabled}
                          className="h-9 w-full rounded-lg border border-[#244357] bg-[#081723] px-1.5 text-[10px] text-slate-50 outline-none transition focus:border-[#ff5e00]"
                        >
                          <option value="">Selecione</option>
                          {jogadores.map((jogador) => (
                            <option key={jogador.id} value={jogador.id}>
                              {jogador.nome}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-1 py-1.5">
                        <select
                          value={row.tipo}
                          onChange={(event) => handleTipoChange(row.id, event.target.value as TipoRegistro)}
                          disabled={isDisabled}
                          className="h-9 w-full rounded-lg border border-[#244357] bg-[#081723] px-1.5 text-[10px] text-slate-50 outline-none transition focus:border-[#ff5e00]"
                        >
                          <option value="jogador">🎯</option>
                          <option value="visitante">👀</option>
                        </select>
                      </td>
                      <td className="px-1 py-1.5">
                        <input
                          type="number"
                          min={0}
                          step={1}
                          value={row.rebuys}
                          onChange={(event) => updateRow(row.id, (current) => ({ ...current, rebuys: event.target.value }))}
                          disabled={isDisabled || !row.jogadorId}
                          className="h-9 w-full rounded-lg border border-[#244357] bg-[#081723] px-1.5 text-[10px] text-slate-50 outline-none transition focus:border-[#ff5e00]"
                        />
                      </td>
                      <td className="px-1 py-1.5 text-center">
                        <input
                          type="checkbox"
                          checked={row.fezAddon}
                          onChange={(event) => updateRow(row.id, (current) => ({ ...current, fezAddon: event.target.checked }))}
                          disabled={isDisabled || !row.jogadorId}
                          className="h-4 w-4 rounded border-slate-500 bg-[#0b1a25]"
                        />
                      </td>
                      <td className="px-1 py-1.5">
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          value={row.pagouJanta}
                          onChange={(event) => updateRow(row.id, (current) => ({ ...current, pagouJanta: event.target.value }))}
                          disabled={isDisabled || !row.jogadorId}
                          className="h-9 w-full rounded-lg border border-[#244357] bg-[#081723] px-1.5 text-[10px] text-slate-50 outline-none transition focus:border-[#ff5e00]"
                          placeholder="0,00"
                        />
                      </td>
                      <td className="px-1 py-1.5 text-center">
                        <input
                          type="checkbox"
                          checked={row.pagouSalao}
                          onChange={(event) => handlePagouSalaoChange(row.id, event.target.checked)}
                          disabled={isDisabled || !row.jogadorId}
                          className="h-4 w-4 rounded border-slate-500 bg-[#0b1a25]"
                        />
                      </td>
                      <td className="px-1 py-1.5">
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          value={row.outrosCustos}
                          onChange={(event) => updateRow(row.id, (current) => ({ ...current, outrosCustos: event.target.value }))}
                          disabled={isDisabled || !row.jogadorId}
                          className="h-9 w-full rounded-lg border border-[#244357] bg-[#081723] px-1.5 text-[10px] text-slate-50 outline-none transition focus:border-[#ff5e00]"
                          placeholder="0,00"
                        />
                      </td>
                      <td className="px-1 py-1.5 text-center">
                        <input
                          type="checkbox"
                          checked={row.cozinheiro}
                          onChange={(event) => handleCozinheiroChange(row.id, event.target.checked)}
                          disabled={isDisabled || !row.jogadorId}
                          className="h-4 w-4 rounded border-slate-500 bg-[#0b1a25]"
                        />
                      </td>
                      <td className="px-1 py-1.5 text-center">
                        <input
                          type="checkbox"
                          checked={row.melhorMao}
                          onChange={(event) => updateRow(row.id, (current) => ({ ...current, melhorMao: event.target.checked }))}
                          disabled={isDisabled || !row.jogadorId}
                          className="h-4 w-4 rounded border-slate-500 bg-[#0b1a25]"
                        />
                      </td>
                      <td className="px-1 py-1.5">
                        <select
                          value={row.colocacao}
                          onChange={(event) => updateRow(row.id, (current) => ({ ...current, colocacao: event.target.value }))}
                          disabled={isDisabled || !row.jogadorId || row.tipo === 'visitante'}
                          className="h-9 w-full rounded-lg border border-[#244357] bg-[#081723] px-1.5 text-[10px] text-slate-50 outline-none transition focus:border-[#ff5e00] disabled:opacity-50"
                        >
                          <option value="">-</option>
                          {Array.from({ length: 9 }, (_, index) => index + 1).map((posicao) => (
                            <option key={posicao} value={posicao}>
                              {posicao}º
                            </option>
                          ))}
                          <option value="10">10º+</option>
                        </select>
                      </td>
                      <td className="px-1 py-1.5 text-center">
                        <button
                          type="button"
                          onClick={() => handleRemoveRow(row.id)}
                          disabled={isDisabled || rows.length === 1}
                          className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-[#2d4659] bg-[#102536] text-xs text-slate-200 transition hover:border-rose-400/60 hover:text-rose-300 disabled:cursor-not-allowed disabled:opacity-40"
                          title="Remover linha"
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {error ? <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">{error}</p> : null}
          {success ? <p className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">{success}</p> : null}

          <button
            type="submit"
            disabled={isDisabled}
            className="inline-flex h-11 items-center justify-center rounded-lg bg-[#ff5e00] px-6 text-sm font-semibold text-white transition hover:bg-[#ff7a2f] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSaving ? 'Registrando...' : 'Registrar participantes'}
          </button>
        </form>
      </section>

      {SHOW_OCR_TOOLS && isCameraModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-[#01060c]/75 p-3 backdrop-blur-[2px] sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-label="Capturar foto da anotação">
          <button type="button" className="absolute inset-0 cursor-default" aria-label="Fechar captura" onClick={handleCloseCameraModal} />

          <section className="relative z-10 w-full max-w-2xl rounded-2xl border border-[#315770] bg-[#0b1a25] p-4 shadow-[0_24px_60px_rgba(0,0,0,0.45)] sm:p-5">
            <header className="mb-3 flex items-start justify-between gap-3 border-b border-[#244357] pb-3">
              <div>
                <h2 className="text-lg font-semibold text-slate-50">Capturar anotação</h2>
                <p className="text-sm text-slate-300">Centralize o papel e tire a foto quando a prévia estiver nítida.</p>
              </div>

              <button
                type="button"
                onClick={handleCloseCameraModal}
                className="rounded-lg border border-[#315770] bg-[#102536] px-2.5 py-1.5 text-xs font-semibold text-slate-200 transition hover:border-[#ff9a63] hover:text-[#ffcfb2]"
              >
                Fechar
              </button>
            </header>

            <div className="overflow-hidden rounded-xl border border-[#244357] bg-black">
              <video ref={videoRef} className="aspect-[3/4] w-full bg-black object-cover" autoPlay playsInline muted />
            </div>

            {cameraError ? <p className="mt-3 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">{cameraError}</p> : null}

            <p className="mt-3 text-xs text-slate-400">Se a prévia continuar preta no seu aparelho, use o botão "Enviar foto" para abrir a câmera nativa ou enviar uma imagem da galeria.</p>

            <footer className="mt-4 flex flex-wrap justify-end gap-2 border-t border-[#244357] pt-3">
              <button
                type="button"
                onClick={handleCloseCameraModal}
                className="rounded-lg border border-[#315770] bg-[#102536] px-4 py-2 text-sm font-semibold text-slate-200 transition hover:border-[#ff9a63] hover:text-[#ffcfb2]"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleCaptureCameraPhoto}
                disabled={isOcrLoading}
                className="rounded-lg bg-[#ff5e00] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#ff7a2f] disabled:cursor-not-allowed disabled:opacity-60"
              >
                Capturar foto
              </button>
            </footer>
          </section>
        </div>
      ) : null}

      {SHOW_OCR_TOOLS ? <iframe ref={printFrameRef} title="print-ocr-template" className="hidden" /> : null}
    </main>
  );
}