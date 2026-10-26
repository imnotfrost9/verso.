import {
  fetchTranscript,
  YoutubeTranscriptDisabledError,
  YoutubeTranscriptInvalidLangError,
  YoutubeTranscriptInvalidVideoIdError,
  YoutubeTranscriptNotAvailableError,
  YoutubeTranscriptNotAvailableLanguageError,
  YoutubeTranscriptTooManyRequestError,
  YoutubeTranscriptVideoUnavailableError
} from "youtube-transcript-plus";

const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "*";

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
    "Content-Type": "application/json; charset=utf-8"
  };
}
function sendTranscriptError(error, res) {
  if (error instanceof YoutubeTranscriptVideoUnavailableError) {
    return res.status(404).json({ error: "Este vídeo está indisponível ou foi removido do YouTube." });
  }
  if (error instanceof YoutubeTranscriptDisabledError) {
    return res.status(422).json({ error: "A transcrição está desativada para este vídeo." });
  }
  if (error instanceof YoutubeTranscriptNotAvailableLanguageError) {
    const languages = error.availableLangs?.length ? ` Idiomas disponíveis: ${error.availableLangs.join(", ")}.` : "";
    return res.status(422).json({ error: `Não há transcrição disponível no idioma ${error.lang}.${languages}` });
  }
  if (error instanceof YoutubeTranscriptInvalidLangError) {
    return res.status(400).json({ error: "O código do idioma informado não é válido." });
  }
  if (error instanceof YoutubeTranscriptInvalidVideoIdError) {
    return res.status(400).json({ error: "O ID do vídeo do YouTube é inválido." });
  }
  if (error instanceof YoutubeTranscriptNotAvailableError) {
    return res.status(404).json({ error: "Este vídeo não tem uma transcrição acessível." });
  }
  if (error instanceof YoutubeTranscriptTooManyRequestError) {
    return res.status(502).json({ error: "O YouTube limitou o acesso às legendas. Tente novamente mais tarde." });
  }
  return res.status(502).json({ error: "Falha ao acessar o YouTube para buscar as legendas. Tente novamente mais tarde." });
}

// youtube-transcript-plus returns both offset and duration in seconds.
function toSecondsSegments(segments) {
  if (!Array.isArray(segments)) throw new Error("Resposta de transcrição inválida.");
  return segments.map((segment) => {
    const inicio = segment.offset;
    const duracao = segment.duration;
    if (!Number.isFinite(inicio) || !Number.isFinite(duracao) || inicio < 0 || duracao < 0) {
      throw new Error("A transcrição retornou marcações de tempo inválidas.");
    }
    return { inicio, duracao, texto: String(segment.text ?? "") };
  });
}

export default async function handler(req, res) {
  for (const [key, value] of Object.entries(corsHeaders())) {
    res.setHeader(key, value);
  }
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST para consultar as legendas." });

  let body;
  try {
    body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("Corpo JSON inválido.");
  } catch {
    return res.status(400).json({ error: "O corpo da solicitação precisa ser um JSON válido." });
  }

  const videoId = String(body.videoId || "").trim();
  const idioma = String(body.idioma || "pt").trim().slice(0, 20);
  const idiomaTraducao = body.idiomaTraducao ? String(body.idiomaTraducao).trim().slice(0, 20) : "";
  if (!/^[\w-]{11}$/.test(videoId)) return res.status(400).json({ error: "O ID do vídeo do YouTube é inválido." });

  try {
    const transcript = await fetchTranscript(videoId, { lang: idioma });
    const legendas = toSecondsSegments(transcript);
    let traducao = [];
    let avisoTraducao = "";

    if (idiomaTraducao && idiomaTraducao !== idioma) {
      try {
        const translated = await fetchTranscript(videoId, { lang: idiomaTraducao });
        traducao = toSecondsSegments(translated);
      } catch (error) {
        if (error instanceof YoutubeTranscriptNotAvailableLanguageError) {
          avisoTraducao = `Não há tradução disponível no idioma ${idiomaTraducao}.`;
        } else if (error?.message?.includes("marcações de tempo inválidas")) {
          throw error;
        } else {
          avisoTraducao = "Não foi possível carregar a tradução opcional.";
        }
      }
    }
    return res.status(200).json({ legendas, traducao, avisoTraducao });
  } catch (error) {
    if (error?.message?.includes("marcações de tempo inválidas")) {
      return res.status(502).json({ error: "A transcrição retornou tempos inválidos. Tente novamente mais tarde." });
    }
    return sendTranscriptError(error, res);
  }
}







