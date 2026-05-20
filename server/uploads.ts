import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { v2 as cloudinary } from 'cloudinary';
import { nanoid } from 'nanoid';
import type { UserSession } from '../src/types';

export type UploadProvider = 's3' | 'cloudinary';

export interface UploadTarget {
  provider: UploadProvider;
  uploadUrl?: string;
  publicUrl?: string;
  objectKey: string;
  fields?: Record<string, string | number>;
  expiresInSeconds: number;
}

function safeName(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 120) || 'documento';
}

export async function createDocumentUploadTarget(input: {
  user: UserSession;
  requestId: string;
  fileName: string;
  contentType: string;
  provider?: UploadProvider;
}): Promise<UploadTarget> {
  const provider = input.provider ?? (process.env.STORAGE_PROVIDER === 'cloudinary' ? 'cloudinary' : 's3');
  const objectKey = `requests/${input.requestId}/${input.user.id}/${Date.now()}-${nanoid(8)}-${safeName(input.fileName)}`;

  if (provider === 'cloudinary') {
    const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
    const apiKey = process.env.CLOUDINARY_API_KEY;
    const apiSecret = process.env.CLOUDINARY_API_SECRET;
    if (!process.env.CLOUDINARY_URL && (!cloudName || !apiKey || !apiSecret)) {
      throw new Error('Cloudinary no esta configurado.');
    }
    if (!process.env.CLOUDINARY_URL) {
      cloudinary.config({ cloud_name: cloudName, api_key: apiKey, api_secret: apiSecret });
    }
    const timestamp = Math.round(Date.now() / 1000);
    const folder = `conectapro/${input.requestId}`;
    const publicId = objectKey.replace(/\.[^.]+$/, '');
    const signature = cloudinary.utils.api_sign_request({ timestamp, folder, public_id: publicId }, cloudinary.config().api_secret!);

    return {
      provider: 'cloudinary',
      uploadUrl: `https://api.cloudinary.com/v1_1/${cloudinary.config().cloud_name}/auto/upload`,
      publicUrl: `https://res.cloudinary.com/${cloudinary.config().cloud_name}/raw/upload/${publicId}`,
      objectKey: publicId,
      fields: {
        api_key: cloudinary.config().api_key!,
        timestamp,
        folder,
        public_id: publicId,
        signature
      },
      expiresInSeconds: 3600
    };
  }

  const bucket = process.env.AWS_S3_BUCKET;
  const region = process.env.AWS_REGION;
  if (!bucket || !region) {
    throw new Error('S3 no esta configurado.');
  }
  const client = new S3Client({ region });
  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: objectKey,
    ContentType: input.contentType,
    ServerSideEncryption: 'AES256',
    Metadata: {
      requestId: input.requestId,
      userId: input.user.id
    }
  });
  const uploadUrl = await getSignedUrl(client, command, { expiresIn: 900 });
  const publicBaseUrl = process.env.AWS_S3_PUBLIC_BASE_URL ?? `https://${bucket}.s3.${region}.amazonaws.com`;

  return {
    provider: 's3',
    uploadUrl,
    publicUrl: `${publicBaseUrl}/${objectKey}`,
    objectKey,
    expiresInSeconds: 900
  };
}
