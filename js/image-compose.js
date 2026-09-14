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

/** Desenha `bitmap` cobrindo todo o retângulo dw×dh do canvas, cortando o excesso, centralizado. */
export function drawCover(ctx, bitmap, dw, dh) {
  const scale = Math.max(dw / bitmap.width, dh / bitmap.height);
  const sw = dw / scale;
  const sh = dh / scale;
  const sx = (bitmap.width - sw) / 2;
  const sy = (bitmap.height - sh) / 2;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, dw, dh);
  ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, dw, dh);
}

export async function canvasToDataUrl(canvas) {
  return canvas.toDataURL("image/png");
}
