import { Image as TauriImage } from "@tauri-apps/api/image";

import {
  APP_ICON_CORNER_RADIUS_RATIO,
  APP_ICON_SIZE,
  APP_ICON_VISIBLE_RATIO,
} from "../config/settings";

async function loadIconImage(
  src: string,
) {
  const image =
    await new Promise<HTMLImageElement>(
      (resolve, reject) => {
        const nextImage = new Image();

        nextImage.onload = () =>
          resolve(nextImage);

        nextImage.onerror = () =>
          reject(
            new Error(
              `Failed to load icon: ${src}`,
            ),
          );

        nextImage.src = src;
      },
    );

  const width =
    image.naturalWidth || image.width;

  const height =
    image.naturalHeight || image.height;

  if (!width || !height) {
    throw new Error(
      "Selected icon has invalid dimensions",
    );
  }

  return {
    image,
    width,
    height,
  };
}

function drawRoundedIconCanvas(
  image: HTMLImageElement,
  width: number,
  height: number,
) {
  if (
    typeof window === "undefined" ||
    typeof document === "undefined"
  ) {
    return null;
  }

  const canvas =
    document.createElement("canvas");

  canvas.width = APP_ICON_SIZE;
  canvas.height = APP_ICON_SIZE;

  const ctx = canvas.getContext("2d");

  if (!ctx) {
    throw new Error(
      "Canvas 2D context is unavailable",
    );
  }

  const visibleSize =
    APP_ICON_SIZE *
    APP_ICON_VISIBLE_RATIO;

  const offset =
    (APP_ICON_SIZE - visibleSize) /
    2;

  const radius =
    visibleSize *
    APP_ICON_CORNER_RADIUS_RATIO;

  const scale = Math.max(
    visibleSize / width,
    visibleSize / height,
  );

  const drawWidth =
    width * scale;

  const drawHeight =
    height * scale;

  const drawX =
    offset +
    (visibleSize - drawWidth) / 2;

  const drawY =
    offset +
    (visibleSize - drawHeight) / 2;

  ctx.beginPath();

  ctx.roundRect(
    offset,
    offset,
    visibleSize,
    visibleSize,
    radius,
  );

  ctx.clip();

  ctx.drawImage(
    image,
    drawX,
    drawY,
    drawWidth,
    drawHeight,
  );

  return canvas;
}

export async function buildWindowIcon(
  src: string,
) {
  const {
    image,
    width,
    height,
  } = await loadIconImage(src);

  const canvas =
    drawRoundedIconCanvas(
      image,
      width,
      height,
    );

  if (!canvas) {
    return null;
  }

  const ctx =
    canvas.getContext("2d");

  if (!ctx) {
    throw new Error(
      "Canvas 2D context is unavailable",
    );
  }

  const rgba = new Uint8Array(
    ctx.getImageData(
      0,
      0,
      APP_ICON_SIZE,
      APP_ICON_SIZE,
    ).data,
  );

  return TauriImage.new(
    rgba,
    APP_ICON_SIZE,
    APP_ICON_SIZE,
  );
}

export async function loadRoundedIconBytes(
  src: string,
) {
  const {
    image,
    width,
    height,
  } = await loadIconImage(src);

  const canvas =
    drawRoundedIconCanvas(
      image,
      width,
      height,
    );

  if (!canvas) {
    return null;
  }

  const blob =
    await new Promise<Blob>(
      (resolve, reject) => {
        canvas.toBlob(
          (nextBlob) => {
            if (nextBlob) {
              resolve(nextBlob);
            } else {
              reject(
                new Error(
                  "Failed to encode rounded app icon",
                ),
              );
            }
          },
          "image/png",
        );
      },
    );

  return new Uint8Array(
    await blob.arrayBuffer(),
  );
}