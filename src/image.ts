import fs from 'fs';
import path from 'path';

import sharp from 'sharp';

import { logger } from './logger.js';

// 이미지를 Claude 비전에 적합한 크기로 리사이즈
const MAX_DIMENSION = 1024;
const JPEG_QUALITY = 80;

/**
 * URL에서 인증 헤더를 사용하여 이미지를 다운로드한다.
 */
export async function downloadImage(
  url: string,
  authToken: string,
): Promise<Buffer> {
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${authToken}` },
  });
  if (!response.ok) {
    throw new Error(
      `Image download failed: ${response.status} ${response.statusText}`,
    );
  }
  return Buffer.from(await response.arrayBuffer());
}

/**
 * 이미지를 MAX_DIMENSION 이내로 리사이즈하고 JPEG으로 변환한다.
 */
export async function resizeImage(buffer: Buffer): Promise<Buffer> {
  return sharp(buffer)
    .resize(MAX_DIMENSION, MAX_DIMENSION, {
      fit: 'inside',
      withoutEnlargement: true,
    })
    .jpeg({ quality: JPEG_QUALITY })
    .toBuffer();
}

/**
 * 이미지를 다운로드, 리사이즈, 그룹 폴더에 저장한다.
 * 성공 시 파일명, 실패 시 null을 반환한다.
 */
export async function processAndSaveImage(
  url: string,
  authToken: string,
  groupDir: string,
  messageId: string,
  fileIndex: number,
): Promise<string | null> {
  try {
    const raw = await downloadImage(url, authToken);
    const resized = await resizeImage(raw);

    const imagesDir = path.join(groupDir, 'images');
    fs.mkdirSync(imagesDir, { recursive: true });

    // 메시지당 여러 이미지 가능 — 인덱스로 구분
    const safeMsgId = messageId.replace(/[^a-zA-Z0-9.-]/g, '_');
    const filename =
      fileIndex === 0 ? `${safeMsgId}.jpg` : `${safeMsgId}_${fileIndex}.jpg`;
    const filePath = path.join(imagesDir, filename);
    fs.writeFileSync(filePath, resized);

    logger.info(
      { filename, size: resized.length },
      'Processed image attachment',
    );
    return filename;
  } catch (err) {
    logger.error({ err, messageId }, 'Failed to process image attachment');
    return null;
  }
}
