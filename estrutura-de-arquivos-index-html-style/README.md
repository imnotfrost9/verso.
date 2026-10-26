# Verso

Verso é um treino de digitação estático em português. Escolha um vídeo do YouTube, carregue legendas com marcações de tempo e digite cada linha para avançar no ritmo.

## Rodar localmente

Na pasta raiz do projeto (onde estão `index.html` e `package.json`), inicie um servidor estático, por exemplo `npx serve .`, e abra o endereço local exibido. A importação de `.lrc`, `.srt` e `.vtt` funciona no navegador sem a função serverless.

Para instalar a dependência da função, use Node.js 20 ou superior e rode `npm install` na raiz do projeto. A dependência `youtube-transcript-plus` está registrada no `package.json` e `package-lock.json`.

## Publicar

- **GitHub Pages:** publique `index.html`, `style.css` e `script.js` como site estático.
- **Vercel:** publique a raiz do projeto, mantendo `api/legendas.js` e `package.json` nessa raiz. O endpoint ficará em `/api/legendas`.
- **Conectar o site à função:** configure `CAPTIONS_API_URL` no topo de `script.js` com a URL absoluta da função, como `https://seu-projeto.vercel.app/api/legendas`.
- **CORS:** configure `ALLOWED_ORIGIN` na Vercel com a origem publicada no GitHub Pages, como `https://seu-usuario.github.io`. Sem essa variável, a função aceita qualquer origem (`*`).

A função aceita um `POST` com `videoId`, `idioma` e, opcionalmente, `idiomaTraducao`. A resposta usa `{ "legendas": [{ "inicio": 0, "duracao": 2, "texto": "..." }], "traducao": [] }`, com tempos em segundos. A busca automática depende do acesso da Vercel às transcrições do YouTube; a importação local continua disponível se ela não estiver publicada ou não encontrar legendas.
