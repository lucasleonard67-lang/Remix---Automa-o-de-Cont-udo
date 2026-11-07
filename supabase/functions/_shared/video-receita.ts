// _shared/video-receita.ts — render feito pelo Claude da pessoa: o produto entrega
// o vídeo e a receita, o Claude renderiza no ambiente dele e devolve o MP4.

export const deliveredPath = (id: string) => `edits/${id}/claude.mp4`;
/** Cópia final: o link de envio segue válido, mas não alcança a versão registrada. */
export const finalDeliveryPath = (id: string) => `edits/${id}/entregue.mp4`;
/** Abaixo disto o envio não é um vídeo de verdade. */
export const MIN_DELIVERY_BYTES = 200 * 1024;
/** Tempo reservado para o Claude renderizar antes de o pedido voltar à fila. */
export const RENDER_HOLD_MS = 2 * 3600 * 1000;

/** Comando do produto que mede a entrega; a URL vem assinada e entre aspas simples. */
export const deliveryProbe = (url: string) =>
  `ffprobe -v error -show_entries format=duration:stream=codec_type,width,height -of json '${url.replace(/'/g, "'\\''")}'`;

export interface DeliveryFacts { duration: number; hasAudio: boolean; width: number; height: number }

export function parseDelivery(out: string): DeliveryFacts | null {
  const duration = Number(out.match(/"duration":\s*"([\d.]+)"/)?.[1]);
  const width = Number(out.match(/"width":\s*(\d+)/)?.[1]);
  const height = Number(out.match(/"height":\s*(\d+)/)?.[1]);
  if (!(duration > 0) || !(width > 0) || !(height > 0)) return null;
  return { duration, hasAudio: /"codec_type":\s*"audio"/.test(out), width, height };
}

/** Problemas que impedem a entrega de virar a versão editada. */
/** Formato esperado da entrega: Reels é vertical; uma aula pelo plano pode ser 16:9 ou 1:1. */
export type FormatoDaEntrega = '9:16' | '16:9' | '1:1';

export function deliveryIssues(m: DeliveryFacts, sourceDuration: number, formato: FormatoDaEntrega = '9:16'): string[] {
  const proporcaoOk = formato === '9:16' ? m.height > m.width : formato === '16:9' ? m.width > m.height : Math.abs(m.width - m.height) <= 2;
  return [
    ...(m.hasAudio ? [] : ['O vídeo veio sem áudio.']),
    ...(proporcaoOk ? [] : [formato === '9:16' ? 'O vídeo precisa ser vertical.' : `O vídeo precisa sair em ${formato}, como no plano.`]),
    ...(m.duration >= sourceDuration * 0.25 ? [] : ['O vídeo ficou curto demais para ser este conteúdo.']),
  ];
}

/** MP4 e MOV trazem "ftyp" do byte 4 ao 7. */
export const isMp4Head = (head: Uint8Array) =>
  head.length >= 8 && new TextDecoder().decode(head.subarray(4, 8)) === 'ftyp';

export const RENDER_RECIPE = `Edite este vídeo no seu ambiente de execução e devolva o MP4 pronto. Estilo Apple: pouco na tela, tipografia forte, movimento curto. Faça só os efeitos do pedido.

video_render traz source_url, anexos, marca e envio. video_ver traz transcricao (índice, palavra, início-fim em s), legenda_ja_queimada, menu.pedido e quadros. Campo nulo em marca: use o padrão daqui.

PREPARO
1. Baixe tudo com curl -fL. Bloqueou: pare e peça à pessoa para liberar o domínio do link nas configurações de rede da execução de código do Claude. Link vencido: chame video_render de novo.
2. Instale o que faltar: pip install pillow numpy imageio-ffmpeg (sem ffmpeg no PATH, use imageio_ffmpeg.get_ffmpeg_exe()). Todo texto sai do Pillow; não use drawtext nem subtitles.
3. Fonte: se marca.fonte for nula, Inter e Source Serif 4:
mkdir -p inter serif
curl -sL https://registry.npmjs.org/@fontsource/inter/-/inter-5.2.5.tgz | tar xz -C inter
curl -sL https://registry.npmjs.org/@fontsource/source-serif-4/-/source-serif-4-5.2.5.tgz | tar xz -C serif
Use inter/package/files/inter-latin-800-normal.woff (e 600, 500) e serif/package/files/source-serif-4-latin-700-normal.woff (e 800). Sem acesso, use DejaVu do sistema e avise.
4. Fora de 9:16, confira se o recorte mantém o rosto. Em HDR, avise que a cor pode mudar.

TEMPO
Título entra na primeira palavra; destaque, quando a palavra é dita; manchete, na palavra que cita a notícia; encerramento, 0,12 s após a última palavra, por 2,6 s. Um efeito sai antes do próximo. Sem 2,6 s livres, estenda: tpad=stop_mode=clone:stop_duration=2.6 no vídeo e apad=whole_dur=D no áudio.
Curvas, t de 0 a 1: entrada 1-(1-t)^4; saída t^3; varredura 4t^3 até 0,5, depois 1-(2-2t)^3/2.

COMPOSIÇÃO
Margem lateral 72 px; nada acima de y 120 nem abaixo de y 1600. Se o rosto descer abaixo de y 1000, suba título e manchete para y 150. Sem card, canto redondo, borda, brilho ou sombra colorida. Leitura: véu preto fixo, alfa 0 em y 1040 até 0,66 em y 1680, curva ^1,5.

Título, até 8 palavras: Inter 800, 118 px (até 84 se passar de 936 px de largura), tracking -0,028 em, entrelinha 1,16, 2 linhas, x 72, fim em y 1400. Cada palavra sobe de uma máscara da altura da linha: 0,7 s, entrada, 70 ms entre palavras. Destaque, uma palavra: bloco reto na cor marca.destaque varre da esquerda em 0,38 s (varredura) e o texto inverte na borda para #141414, ou branco se o destaque for escuro. Saída: 0,3 s, sobe 30 px e some.

Manchete: tira de papel #F6F3EC de ponta a ponta, y 1010 a 1440. Na tira: veículo em serif 800, 40 px, tracking 0,09 em, x 72, y 34; data em Inter 600, 26 px, cinza, até x 1008; filetes de 3 px e 1 px em y 96 e 104; título em serif 700, 72 px, y 122, entrelinha 88, até 3 linhas. Papel revela da esquerda em 0,56 s; veículo e data aos 0,16 s; filete aos 0,22 s; linhas aos 0,34 s, 90 ms entre elas, subindo de máscara; marca-texto em marca.destaque varre o trecho central aos 1,05 s em 0,5 s. Na espera, sobe 14 px devagar. Sai pela direita em 0,4 s. Veículo, título e data iguais ao publicado. Só manchete real que você abriu; nunca invente. Sem confirmação, deixe de fora e diga.

Dado: só número presente na fonte; estilo do título. Janela, tela dividida e recorte sem fundo: só com anexos; recorte pede PNG com alfa.

Legenda: linha única, Inter 600, 50 px, branca, centrada, y 1510, até 30 caracteres. Quebre em pausa e pontuação, depois no meio da frase, sem terminar em artigo ou preposição. Fade de 80 ms, posição fixa. Sombra preta neutra, desfoque 7 px, 50%. Com legenda_ja_queimada true, não crie outra e afaste título e manchete dela.

Encerramento: marca.cor sobe de baixo em 0,6 s (varredura), cobrindo tudo. Logo, ou handle em Inter 800, 136 px, centrado, y 800, sobe de máscara aos 0,28 s; filete 96x6 em marca.destaque aos 0,62 s; frase curta em Inter 500, 46 px, aos 0,8 s. Em cor clara, texto escuro. Sem logo nem handle, avise e pule.

Música (musica.wav): anexo, licença livre com fonte citada, ou gerada com numpy: Am9-F-C-G, 84 BPM, 4 tempos por acorde, senos desafinados 0,12 Hz, ataque 0,9 s, baixo em seno, piano em colcheias (decaimento 0,45 s), eco 340 ms a 0,26.

RENDER
Texto: desenhe 3x maior, letra a letra (kerning = getlength(a+b)-getlength(b)), e reduza com LANCZOS. Mova em float com Image.transform AFFINE BICUBIC em modo RGBa: posição inteira treme e RGBA direto cria franja.
Áudio: I é o valor do Summary de ebur128. GV = -16 - I da fala; GM = -21 - I da música; G = -14 - I do mix; D = duração.
ffmpeg -y -i fonte.mp4 -vn -ar 48000 -ac 2 fala.wav
ffmpeg -y -i fala.wav -stream_loop -1 -i musica.wav -filter_complex "[0:a]volume=GVdB,asplit[v][k];[1:a]aresample=48000,aformat=channel_layouts=stereo,volume=GMdB[m];[m][k]sidechaincompress=threshold=0.05:ratio=4:attack=40:release=450[d];[v][d]amix=inputs=2:normalize=0:duration=first,afade=t=out:st=D-1.5:d=1.5" mix.wav
ffmpeg -y -i mix.wav -af "volume=GdB,alimiter=limit=0.84:level=false" audio.wav
Vídeo: escreva cada quadro RGBA 1080x1920 do Python no stdin de:
ffmpeg -y -i fonte.mp4 -i audio.wav -f rawvideo -pix_fmt rgba -s 1080x1920 -r 30 -i - -filter_complex "[0:v]fps=30,scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,format=gbrp[b];[2:v]format=gbrap[o];[b][o]overlay=format=gbrp:shortest=1,scale=out_color_matrix=bt709:out_range=tv,format=yuv420p,setparams=colorspace=bt709:color_primaries=bt709:color_trc=bt709[v]" -map "[v]" -map 1:a -c:v libx264 -preset medium -crf 20 -maxrate 12M -bufsize 24M -c:a aac -b:a 192k -movflags +faststart saida.mp4

CONFERÊNCIA
Meça: 1080x1920, yuv420p, 30 fps, AAC 48 kHz, -14 LUFS (±1), pico até -1 dBFS (ebur128=peak=true). Abra 4 quadros: título, manchete, só legenda, encerramento. Rosto coberto, texto cortado ou margem invadida: corrija e renderize de novo.

ENTREGA
curl -fS -X PUT -H "content-type: video/mp4" --data-binary @saida.mp4 "<envio.url>"
Acima de 50 MB, ou com erro 413, baixe -maxrate para 380/D megabits, sem passar de 12M, e renderize de novo.
Chame video_entregar com fontes (manchetes, dados e origem da música) e ficou_de_fora (cada efeito que não saiu). Não entregue como completo se faltou algo.`;
