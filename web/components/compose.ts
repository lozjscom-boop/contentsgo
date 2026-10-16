"use client";

const FONT = '"Pretendard","Apple SD Gothic Neo","Noto Sans KR","Malgun Gothic",sans-serif';

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  let cur = "";
  for (const ch of text) {
    if (ctx.measureText(cur + ch).width > maxWidth && cur) { lines.push(cur); cur = ch; } else cur += ch;
  }
  if (cur) lines.push(cur);
  return lines;
}

/** 이미지 위에 문구를 얹은 PNG를 만든다 (AI가 한글을 직접 그리지 않으므로 앱이 합성). */
export async function composePng(imageUrl: string, caption: string, overlayLines: string[]): Promise<Blob> {
  const res = await fetch(imageUrl);
  if (!res.ok) throw new Error("이미지를 불러오지 못했어요");
  const bmp = await createImageBitmap(await res.blob());
  const canvas = document.createElement("canvas");
  canvas.width = bmp.width;
  canvas.height = bmp.height;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bmp, 0, 0);

  const pad = Math.round(canvas.width * 0.06);
  const maxW = canvas.width - pad * 2;
  const big = Math.round(canvas.width * 0.065);
  const small = Math.round(canvas.width * 0.04);
  ctx.textBaseline = "top";

  const blocks: { text: string; size: number; weight: string }[] = [{ text: caption, size: big, weight: "700" }, ...overlayLines.map((t) => ({ text: t, size: small, weight: "500" }))];
  const laid = blocks.map((b) => {
    ctx.font = `${b.weight} ${b.size}px ${FONT}`;
    return { ...b, lines: wrap(ctx, b.text, maxW) };
  });
  const lineGap = 1.3;
  const total = laid.reduce((h, b) => h + b.lines.length * b.size * lineGap + b.size * 0.3, 0);

  const top = canvas.height - total - pad;
  const grad = ctx.createLinearGradient(0, top - pad * 2, 0, canvas.height);
  grad.addColorStop(0, "rgba(0,0,0,0)");
  grad.addColorStop(1, "rgba(0,0,0,0.78)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, top - pad * 2, canvas.width, canvas.height - (top - pad * 2));

  ctx.fillStyle = "#fff";
  let y = top;
  for (const b of laid) {
    ctx.font = `${b.weight} ${b.size}px ${FONT}`;
    for (const line of b.lines) { ctx.fillText(line, pad, y); y += b.size * lineGap; }
    y += b.size * 0.3;
  }
  return await new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("PNG 변환 실패"))), "image/png"));
}

export function saveBlob(blob: Blob, filename: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
