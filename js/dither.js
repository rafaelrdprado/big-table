// Dithering para a etiqueta térmica (1-bit: cada pixel é impresso ou não —
// não existe "cinza" de verdade). Simula tons de cinza espalhando o erro de
// quantização pelos pixels vizinhos (Floyd–Steinberg), em vez do corte seco
// em preto/branco que o driver da Niimbot faz sozinho (luminância < 128).
//
// Algoritmo clássico de difusão de erro; estrutura de implementação (kernel +
// normalização + varredura serpentina) adaptada do dither.ts do projeto
// niimblue (https://github.com/MultiMote/niimblue, MIT, © MultiMote) — ver
// vendor/niimblue-LICENSE.txt.

export function rgbToGray(r, g, b) {
  return r * 0.299 + g * 0.587 + b * 0.114;
}

function createDiffuser(denom, grid) {
  const rows = grid.length;
  const cols = grid[0].length;
  const originCol = Math.floor(cols / 2);
  const kernel = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (r === 0 && c === originCol) continue;
      const w = grid[r][c];
      if (w) kernel.push([c - originCol, r, w / denom]);
    }
  }
  const reversedKernel = kernel.map(([dx, dy, w]) => [-dx, dy, w]);

  return (imageData, { threshold = 128, serpentine = true } = {}) => {
    const { data, width, height } = imageData;
    const gray = new Float32Array(width * height);
    for (let p = 0, i = 0; i < data.length; p++, i += 4) {
      gray[p] = rgbToGray(data[i], data[i + 1], data[i + 2]);
    }

    for (let y = 0; y < height; y++) {
      const reverse = serpentine && (y & 1);
      const start = reverse ? width - 1 : 0;
      const end = reverse ? -1 : width;
      const step = reverse ? -1 : 1;
      const active = reverse ? reversedKernel : kernel;

      for (let x = start; x !== end; x += step) {
        const idx = y * width + x;
        const old = gray[idx];
        const value = old < threshold ? 0 : 255;
        const error = old - value;

        const off = idx * 4;
        data[off] = data[off + 1] = data[off + 2] = value;

        if (error !== 0) {
          for (const [dx, dy, w] of active) {
            const nx = x + dx, ny = y + dy;
            if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
              gray[ny * width + nx] += error * w;
            }
          }
        }
      }
    }
    return imageData;
  };
}

// Floyd–Steinberg: bom equilíbrio entre qualidade e nitidez, ideal para arte de carta.
export const ditherFloydSteinberg = createDiffuser(16, [
  [0, 0, 7],
  [3, 5, 1],
]);

// Atkinson: só difunde 6/8 do erro — contraste mais alto, menos "borrado".
export const ditherAtkinson = createDiffuser(8, [
  [0, 0, 0, 1, 1],
  [0, 1, 1, 1, 0],
  [0, 0, 1, 0, 0],
]);

/** Corte seco preto/branco (sem dithering) — o comportamento padrão anterior. */
export function ditherThreshold(imageData, { threshold = 128 } = {}) {
  const { data } = imageData;
  for (let i = 0; i < data.length; i += 4) {
    const value = rgbToGray(data[i], data[i + 1], data[i + 2]) < threshold ? 0 : 255;
    data[i] = data[i + 1] = data[i + 2] = value;
  }
  return imageData;
}

export const DITHER_MODES = {
  none: { label: "Preto e branco (sem dithering)", fn: ditherThreshold },
  floyd: { label: "Dithering (tons de cinza simulados)", fn: ditherFloydSteinberg },
  atkinson: { label: "Dithering de alto contraste (Atkinson)", fn: ditherAtkinson },
};

// A impressora só entende preto/branco — o driver da Niimbot já faz esse corte
// sozinho (luminância < 128) se receber uma imagem colorida. Aplicamos aqui
// também, sempre, para que o preview mostre exatamente o que sai impresso.
export function applyDitherToCanvas(canvas, mode) {
  const entry = DITHER_MODES[mode] || DITHER_MODES.none;
  const ctx = canvas.getContext("2d");
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  entry.fn(imageData);
  ctx.putImageData(imageData, 0, 0);
}
