const MAX_SIDE = 1568; // Claude's recommended longest side for image inputs

function drawToJpeg(source: CanvasImageSource, width: number, height: number): Promise<Blob | undefined> {
  const scale = Math.min(1, MAX_SIDE / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) return Promise.resolve(undefined);
  ctx.fillStyle = '#fff'; // JPEG has no alpha
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b ?? undefined), 'image/jpeg', 0.85));
}

function videoPoster(file: File): Promise<Blob | undefined> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    const done = (b?: Blob) => {
      URL.revokeObjectURL(url);
      resolve(b);
    };
    const timer = setTimeout(() => done(), 8000);
    video.muted = true;
    video.preload = 'auto';
    video.onerror = () => done();
    video.onloadeddata = () => {
      video.currentTime = Math.min(0.1, (video.duration || 1) / 2);
    };
    video.onseeked = async () => {
      clearTimeout(timer);
      done(await drawToJpeg(video, video.videoWidth, video.videoHeight));
    };
    video.src = url;
  });
}

/**
 * A downscaled JPEG used for thumbnails and as the picture Claude sees. Videos get a poster frame.
 * Returns undefined for audio or when the browser can't decode the file.
 */
export async function makePreview(file: File): Promise<Blob | undefined> {
  try {
    if (file.type.startsWith('image/')) {
      const bitmap = await createImageBitmap(file);
      const blob = await drawToJpeg(bitmap, bitmap.width, bitmap.height);
      bitmap.close();
      return blob;
    }
    if (file.type.startsWith('video/')) return await videoPoster(file);
  } catch {
    /* fall through */
  }
  return undefined;
}
