import sharp from "sharp";

// Fal.ai API for background removal
const FAL_KEY = process.env.FAL_KEY;

export async function removeBackground(imageUrl: string | Buffer): Promise<Buffer> {
  if (!FAL_KEY) throw new Error("FAL_KEY environment variable is not set.");
  
  let imageData: string;
  if (Buffer.isBuffer(imageUrl)) {
    imageData = `data:image/jpeg;base64,${imageUrl.toString("base64")}`;
  } else {
    imageData = imageUrl;
  }

  const response = await fetch("https://fal.run/briaai/bria-rmbg-1.4", {
    method: "POST",
    headers: {
      "Authorization": `Key ${FAL_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ image_url: imageData })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Fal.ai Error: ${response.status} - ${text}`);
  }

  const result = await response.json() as { image: { url: string } };
  
  if (result.image.url.startsWith("data:image")) {
    const b64 = result.image.url.split(",")[1];
    return Buffer.from(b64, "base64");
  } else {
    // Fal might return a URL to the image Instead
    const imgRes = await fetch(result.image.url);
    return Buffer.from(await imgRes.arrayBuffer());
  }
}

export async function compositeImage(
  fgBuffer: Buffer,
  customBackgroundPathOrUrl: string,
  fgScale: number = 0.8
): Promise<Buffer> {
  // 1. Get dimensions of the custom background
  let bgBuffer: Buffer;
  if (customBackgroundPathOrUrl.startsWith("http")) {
    bgBuffer = Buffer.from(await (await fetch(customBackgroundPathOrUrl)).arrayBuffer());
  } else {
    // Assuming local file
    const fs = await import("fs/promises");
    bgBuffer = await fs.readFile(customBackgroundPathOrUrl);
  }

  const bgImage = sharp(bgBuffer);
  const bgMeta = await bgImage.metadata();
  const bgWidth = bgMeta.width || 1080;
  const bgHeight = bgMeta.height || 1080;

  // 2. Load foreground and resize it to fit relative to the background
  const fgImage = sharp(fgBuffer);
  const fgMeta = await fgImage.metadata();
  
  const fgTargetWidth = Math.round(bgWidth * fgScale);
  const fgTargetHeight = Math.round(bgHeight * fgScale);

  const resizedFg = await fgImage.resize({
    width: fgTargetWidth,
    height: fgTargetHeight,
    fit: 'inside'
  }).toBuffer();

  const resizedFgMeta = await sharp(resizedFg).metadata();

  // 3. Composite centering the foreground
  const left = Math.round((bgWidth - (resizedFgMeta.width || 0)) / 2);
  const top = Math.round((bgHeight - (resizedFgMeta.height || 0)) / 2);

  return bgImage.composite([{
    input: resizedFg,
    left,
    top
  }]).jpeg({ quality: 90 }).toBuffer();
}
