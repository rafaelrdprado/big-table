// Utilitários de composição de imagem para a etiqueta.
// Usa fetch()+createImageBitmap() em vez de <img crossOrigin>: um ImageBitmap
// criado a partir de um Blob é sempre "origin-clean", então o canvas nunca fica
// "tainted" mesmo que o servidor da imagem não mande cabeçalhos CORS explícitos
// para leitura de pixel (só precisa permitir o fetch em si).
export async function fetchImageBitmap(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Falha ao baixar imagem (${res.status})`);
  const blob = await res.blob();
  return await createImageBitmap(blob);
}

/** Desenha `bitmap` inteiro dentro do retângulo dw×dh do canvas, sem cortar nem
 * distorcer — sobra fica como faixa branca dos lados ou em cima/embaixo. */
export function drawContain(ctx, bitmap, dw, dh) {
  const scale = Math.min(dw / bitmap.width, dh / bitmap.height);
  const w = bitmap.width * scale;
  const h = bitmap.height * scale;
  const dx = (dw - w) / 2;
  const dy = (dh - h) / 2;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, dw, dh);
  ctx.drawImage(bitmap, 0, 0, bitmap.width, bitmap.height, dx, dy, w, h);
}

export async function canvasToDataUrl(canvas) {
  return canvas.toDataURL("image/png");
}
