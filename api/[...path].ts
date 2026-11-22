import type { IncomingMessage, ServerResponse } from 'node:http';
import { getServerlessApp } from '../server';

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const app = await getServerlessApp();
  await new Promise<void>((resolve, reject) => {
    res.once('finish', resolve);
    res.once('close', resolve);
    res.once('error', reject);
    app(req as Parameters<typeof app>[0], res as Parameters<typeof app>[1]);
  });
}
